-- Conexión del CRM con planillas de leads (Google Sheets, p. ej. formularios de Meta Ads).
--
-- La Edge Function lead-sheet-sync lee cada 10 minutos las planillas activas de
-- lead_sheet_sources (exportación CSV por enlace, sin credenciales de Google) y
-- entrega las filas ya mapeadas a lead_sheet_import(). Esa función:
--   * crea en etapa Lead cada fila nueva, con responsable por turno rotativo
--     entre los perfiles activos de assignees;
--   * no duplica: si el correo o el teléfono ya existen en un lead de la
--     organización, vincula la fila a ese lead y deja una actividad;
--   * registra cada fila en lead_sheet_imports, así una fila ya importada nunca
--     vuelve a entrar aunque el lead se elimine después en el CRM.
-- La planilla es solo lectura: nada se escribe en ella.
--
-- Seguridad: ambas funciones son SECURITY INVOKER. Solo service_role (la Edge
-- Function) puede usarlas: anon/authenticated no tienen acceso a Vault y la RLS de
-- lead_sheet_sources / lead_sheet_imports no les permite modificar nada.

begin;

create table public.lead_sheet_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null default '',
  spreadsheet_id text not null,
  sheet_gid text not null default '0',
  lead_source text not null default 'Meta Ads',
  assignees uuid[] not null default '{}',
  next_assignee integer not null default 0 check (next_assignee >= 0),
  active boolean not null default true,
  last_sync_at timestamptz,
  last_sync_status text not null default '',
  last_sync_error text not null default '',
  last_sync_summary jsonb not null default '{}',
  last_import_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, spreadsheet_id, sheet_gid)
);

create trigger set_updated_at before update on public.lead_sheet_sources
  for each row execute function public.set_updated_at();

create table public.lead_sheet_imports (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  external_id text not null,
  source_id uuid references public.lead_sheet_sources(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  outcome text not null check (outcome in ('created', 'linked')),
  payload jsonb not null default '{}',
  imported_at timestamptz not null default now(),
  primary key (organization_id, external_id)
);

create index lead_sheet_imports_lead_idx
  on public.lead_sheet_imports(lead_id) where lead_id is not null;
create index lead_sheet_imports_source_idx
  on public.lead_sheet_imports(source_id, imported_at desc);

-- Solo lectura para administración de la organización (diagnóstico). Sin políticas
-- de escritura: los clientes no pueden crear, modificar ni borrar filas.
alter table public.lead_sheet_sources enable row level security;
alter table public.lead_sheet_imports enable row level security;

create policy lead_sheet_sources_select on public.lead_sheet_sources
for select to authenticated
using (organization_id = internal.my_org() and internal.can_manage_all());

create policy lead_sheet_imports_select on public.lead_sheet_imports
for select to authenticated
using (organization_id = internal.my_org() and internal.can_manage_all());

-- Llave interna del cron. Se genera al aplicar la migración y vive solo en Vault.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'lead_sheet_sync_cron_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'lead_sheet_sync_cron_key',
      'Llave del cron que invoca la Edge Function lead-sheet-sync'
    );
  end if;
end
$$;

-- La Edge Function la usa para validar al cron. Solo funciona para service_role:
-- anon y authenticated no tienen acceso al esquema vault.
create function public.internal_lead_sheet_cron_key()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'lead_sheet_sync_cron_key'
  order by created_at desc
  limit 1
$$;

-- Importa filas ya mapeadas por la Edge Function. Cada fila es un objeto con:
-- external_id, created_at, company, contact, role, email, phone, industry,
-- technicians, notes, summary y payload (fila original de la planilla).
create function public.lead_sheet_import(p_source_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source public.lead_sheet_sources%rowtype;
  v_row jsonb;
  v_external text;
  v_email text;
  v_phone_key text;
  v_existing public.leads%rowtype;
  v_lead_id uuid;
  v_owner uuid;
  v_owner_name text;
  v_n integer;
  v_idx integer;
  v_next integer;
  v_at timestamptz;
  v_company text;
  v_technicians text;
  v_created integer := 0;
  v_linked integer := 0;
  v_known integer := 0;
  v_invalid integer := 0;
  v_summary jsonb;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Las filas deben llegar como arreglo JSON';
  end if;

  -- Con RLS, solo service_role puede bloquear la fila de la fuente.
  select *
    into v_source
    from public.lead_sheet_sources
   where id = p_source_id
   for update;

  if not found then
    raise exception 'Fuente de leads no encontrada';
  end if;

  if not v_source.active then
    return jsonb_build_object('created', 0, 'linked', 0, 'known', 0, 'invalid', 0, 'inactive', true);
  end if;

  v_n := coalesce(array_length(v_source.assignees, 1), 0);
  v_next := case when v_n > 0 then v_source.next_assignee % v_n else 0 end;

  for v_row in
    select r.value
      from jsonb_array_elements(p_rows) with ordinality as r(value, ord)
     order by r.ord
  loop
    v_external := nullif(btrim(coalesce(v_row->>'external_id', '')), '');
    if v_external is null then
      v_invalid := v_invalid + 1;
      continue;
    end if;

    if exists (
      select 1
        from public.lead_sheet_imports i
       where i.organization_id = v_source.organization_id
         and i.external_id = v_external
    ) then
      v_known := v_known + 1;
      continue;
    end if;

    v_email := lower(nullif(btrim(coalesce(v_row->>'email', '')), ''));
    v_phone_key := right(regexp_replace(coalesce(v_row->>'phone', ''), '\D', '', 'g'), 9);
    if length(v_phone_key) < 8 then
      v_phone_key := null;
    end if;
    v_company := coalesce(
      nullif(btrim(coalesce(v_row->>'company', '')), ''),
      nullif(btrim(coalesce(v_row->>'contact', '')), '')
    );

    if v_email is null and v_phone_key is null and v_company is null then
      v_invalid := v_invalid + 1;
      continue;
    end if;

    begin
      v_at := nullif(v_row->>'created_at', '')::timestamptz;
    exception when others then
      v_at := null;
    end;
    v_at := coalesce(v_at, now());

    -- Misma persona ya registrada en el CRM (por correo o teléfono): no duplicar.
    select l.*
      into v_existing
      from public.leads l
     where l.organization_id = v_source.organization_id
       and (
         (v_email is not null and lower(btrim(l.email)) = v_email)
         or (v_phone_key is not null and right(regexp_replace(l.phone, '\D', '', 'g'), 9) = v_phone_key)
       )
     order by l.created_at
     limit 1;

    if found then
      insert into public.activities (
        organization_id, lead_id, company, type, date, owner_id, owner_name, detail, system
      )
      values (
        v_source.organization_id,
        v_existing.id,
        v_existing.company,
        'Otro',
        v_at,
        v_existing.owner_id,
        v_existing.owner_name,
        'Volvió a enviar el formulario (' || v_source.lead_source || ')'
          || coalesce('. ' || nullif(btrim(coalesce(v_row->>'summary', '')), ''), '') || '.',
        true
      );

      insert into public.lead_sheet_imports (organization_id, external_id, source_id, lead_id, outcome, payload)
      values (v_source.organization_id, v_external, v_source.id, v_existing.id, 'linked',
              coalesce(v_row->'payload', '{}'::jsonb));

      v_linked := v_linked + 1;
      continue;
    end if;

    -- Responsable por turno rotativo, saltando perfiles inactivos o de otra organización.
    v_owner := null;
    v_owner_name := null;
    if v_n > 0 then
      for i in 0 .. v_n - 1 loop
        v_idx := (v_next + i) % v_n;
        select p.id, coalesce(nullif(btrim(p.name), ''), p.email)
          into v_owner, v_owner_name
          from public.profiles p
         where p.id = v_source.assignees[v_idx + 1]
           and p.active is true
           and p.organization_id = v_source.organization_id;
        if v_owner is not null then
          v_next := (v_idx + 1) % v_n;
          exit;
        end if;
      end loop;
    end if;

    v_lead_id := gen_random_uuid();

    insert into public.leads (
      id, organization_id, company, industry, source, contact, role, email, phone,
      stage, priority, probability, owner_id, owner_name, notes, stage_history,
      created_at, updated_at
    )
    values (
      v_lead_id,
      v_source.organization_id,
      left(coalesce(v_company, 'Sin empresa'), 200),
      coalesce(v_row->>'industry', ''),
      coalesce(nullif(v_source.lead_source, ''), 'Meta Ads'),
      coalesce(v_row->>'contact', ''),
      coalesce(v_row->>'role', ''),
      coalesce(v_row->>'email', ''),
      coalesce(v_row->>'phone', ''),
      'Lead',
      'Media',
      5,
      v_owner,
      coalesce(v_owner_name, ''),
      coalesce(v_row->>'notes', ''),
      jsonb_build_array(jsonb_build_object('stage', 'Lead', 'at', v_at)),
      v_at,
      now()
    );

    v_technicians := nullif(btrim(coalesce(v_row->>'technicians', '')), '');
    if v_technicians is not null then
      insert into public.discoveries (lead_id, technicians)
      values (v_lead_id, v_technicians)
      on conflict (lead_id) do nothing;
    end if;

    insert into public.lead_sheet_imports (organization_id, external_id, source_id, lead_id, outcome, payload)
    values (v_source.organization_id, v_external, v_source.id, v_lead_id, 'created',
            coalesce(v_row->'payload', '{}'::jsonb));

    v_created := v_created + 1;
  end loop;

  v_summary := jsonb_build_object('created', v_created, 'linked', v_linked, 'known', v_known, 'invalid', v_invalid);

  update public.lead_sheet_sources
     set next_assignee = v_next,
         last_sync_at = now(),
         last_sync_status = 'ok',
         last_sync_error = '',
         last_sync_summary = v_summary,
         last_import_at = case when v_created + v_linked > 0 then now() else last_import_at end
   where id = v_source.id;

  return v_summary;
end;
$$;

-- Revisión automática cada 10 minutos (cron.schedule reemplaza el job si ya existe).
select cron.schedule(
  'lead-sheet-sync',
  '*/10 * * * *',
  $$
    select net.http_post(
      url := 'https://egglrpexexcodsreumnz.supabase.co/functions/v1/lead-sheet-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-lead-sync-cron', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'lead_sheet_sync_cron_key'
          order by created_at desc
          limit 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    ) as request_id;
  $$
);

commit;
