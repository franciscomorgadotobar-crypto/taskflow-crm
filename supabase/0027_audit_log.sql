-- 0027: auditoría inmutable de cambios relevantes del CRM.
--
-- Registra quién creó, modificó o eliminó oportunidades, actividades,
-- levantamientos, cotizaciones, campañas Híper Foco y perfiles.
-- Los clientes no escriben directamente esta tabla: solo los triggers.
-- La lectura queda restringida a super/admin de la misma organización.

create table public.audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid,
  actor_name text not null default '',
  entity_type text not null,
  entity_id uuid,
  lead_id uuid,
  action text not null check (action in ('insert','update','delete')),
  changed_fields text[] not null default '{}',
  before_data jsonb not null default '{}',
  after_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index audit_log_org_created_idx on public.audit_log(organization_id, created_at desc);
create index audit_log_lead_created_idx on public.audit_log(lead_id, created_at desc) where lead_id is not null;
create index audit_log_entity_idx on public.audit_log(entity_type, entity_id, created_at desc);

alter table public.audit_log enable row level security;

create policy audit_log_select on public.audit_log
for select to authenticated
using (
  organization_id = internal.my_org()
  and internal.can_manage_all()
);

revoke insert, update, delete on public.audit_log from public, anon, authenticated;
grant select on public.audit_log to authenticated;

create or replace function internal.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_row jsonb;
  v_org uuid;
  v_entity uuid;
  v_lead uuid;
  v_actor uuid := auth.uid();
  v_actor_name text := '';
  v_changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    v_after := to_jsonb(new);
    v_row := v_after;
  elsif tg_op = 'DELETE' then
    v_before := to_jsonb(old);
    v_row := v_before;
  else
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
    v_row := v_after;

    select coalesce(array_agg(k order by k), '{}')
      into v_changed
      from (
        select key as k
          from jsonb_object_keys(v_before || v_after) as key
         where key not in ('updated_at')
           and (v_before -> key) is distinct from (v_after -> key)
      ) d;

    -- No generar ruido si el único cambio fue updated_at.
    if cardinality(v_changed) = 0 then
      return new;
    end if;
  end if;

  v_org := nullif(v_row ->> 'organization_id', '')::uuid;
  if v_org is null then
    v_org := internal.my_org();
  end if;

  -- Si no podemos resolver organización, fallamos cerrado: no crear un registro
  -- huérfano que pueda terminar visible para otra organización.
  if v_org is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_table_name = 'discoveries' then
    v_entity := nullif(v_row ->> 'lead_id', '')::uuid;
    v_lead := v_entity;
  else
    v_entity := nullif(v_row ->> 'id', '')::uuid;
    if tg_table_name = 'leads' then
      v_lead := v_entity;
    elsif tg_table_name in ('activities', 'quotes') then
      v_lead := nullif(v_row ->> 'lead_id', '')::uuid;
    end if;
  end if;

  if v_actor is not null then
    select coalesce(p.name, p.email, '')
      into v_actor_name
      from public.profiles p
     where p.id = v_actor;
  end if;

  insert into public.audit_log (
    organization_id,
    actor_id,
    actor_name,
    entity_type,
    entity_id,
    lead_id,
    action,
    changed_fields,
    before_data,
    after_data
  )
  values (
    v_org,
    v_actor,
    coalesce(v_actor_name, ''),
    tg_table_name,
    v_entity,
    v_lead,
    lower(tg_op),
    v_changed,
    v_before,
    v_after
  );

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function internal.write_audit_log() from public, anon, authenticated;
grant execute on function internal.write_audit_log() to service_role;

create trigger audit_leads
after insert or update or delete on public.leads
for each row execute function internal.write_audit_log();

create trigger audit_activities
after insert or update or delete on public.activities
for each row execute function internal.write_audit_log();

create trigger audit_discoveries
after insert or update or delete on public.discoveries
for each row execute function internal.write_audit_log();

create trigger audit_quotes
after insert or update or delete on public.quotes
for each row execute function internal.write_audit_log();

create trigger audit_hyperfocus_campaigns
after insert or update or delete on public.hyperfocus_campaigns
for each row execute function internal.write_audit_log();

create trigger audit_profiles
after insert or update or delete on public.profiles
for each row execute function internal.write_audit_log();
