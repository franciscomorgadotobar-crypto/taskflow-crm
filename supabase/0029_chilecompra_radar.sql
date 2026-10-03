-- 0029: Radar ChileCompra / Mercado Público.
-- Requiere dos secretos creados fuera de Git:
--   chilecompra_api_ticket
--   chilecompra_radar_cron_key
-- Ambos se almacenan en Supabase Vault; sus valores nunca deben versionarse.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema extensions;

create or replace function public.internal_chilecompra_ticket()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'chilecompra_api_ticket'
  order by created_at desc
  limit 1
$$;

revoke all on function public.internal_chilecompra_ticket() from public, anon, authenticated;
grant execute on function public.internal_chilecompra_ticket() to service_role;

create or replace function public.internal_chilecompra_cron_key()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'chilecompra_radar_cron_key'
  order by created_at desc
  limit 1
$$;

revoke all on function public.internal_chilecompra_cron_key() from public, anon, authenticated;
grant execute on function public.internal_chilecompra_cron_key() to service_role;

create table if not exists public.chilecompra_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  product_scope text[] not null default '{}',
  query_terms text[] not null default '{}',
  priority text not null default 'media' check (priority in ('alta','media','baja')),
  active boolean not null default true,
  system_seed boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.chilecompra_opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  external_code text not null,
  name text not null default '',
  description text not null default '',
  buyer_name text not null default '',
  buyer_code text not null default '',
  status text not null default '',
  procurement_type text not null default 'Licitación pública',
  published_at timestamptz,
  close_at timestamptz,
  amount numeric,
  currency text not null default 'CLP',
  source_url text not null default '',
  fit_score integer not null default 0 check (fit_score between 0 and 100),
  fit_level text not null default 'bajo' check (fit_level in ('alto','parcial','bajo')),
  matched_solutions text[] not null default '{}',
  matched_capabilities text[] not null default '{}',
  match_reasons text[] not null default '{}',
  radar_state text not null default 'nuevo' check (radar_state in ('nuevo','guardado','crm','descartado')),
  lead_id uuid references public.leads(id) on delete set null,
  raw jsonb not null default '{}'::jsonb,
  detail_loaded boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, external_code)
);

create table if not exists public.chilecompra_campaign_matches (
  campaign_id uuid not null references public.chilecompra_campaigns(id) on delete cascade,
  opportunity_id uuid not null references public.chilecompra_opportunities(id) on delete cascade,
  score integer not null default 0 check (score between 0 and 100),
  matched_terms text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (campaign_id, opportunity_id)
);

create index if not exists chilecompra_opportunities_org_fit_idx
  on public.chilecompra_opportunities (organization_id, fit_level, radar_state, fit_score desc);
create index if not exists chilecompra_opportunities_close_idx
  on public.chilecompra_opportunities (organization_id, close_at);
create index if not exists chilecompra_campaigns_org_active_idx
  on public.chilecompra_campaigns (organization_id, active);

alter table public.chilecompra_campaigns enable row level security;
alter table public.chilecompra_opportunities enable row level security;
alter table public.chilecompra_campaign_matches enable row level security;

drop policy if exists chilecompra_campaigns_select on public.chilecompra_campaigns;
create policy chilecompra_campaigns_select on public.chilecompra_campaigns
for select using (organization_id = internal.my_org());

drop policy if exists chilecompra_campaigns_insert on public.chilecompra_campaigns;
create policy chilecompra_campaigns_insert on public.chilecompra_campaigns
for insert with check (
  organization_id = internal.my_org()
  and internal.my_role() in ('super','admin','comercial')
  and coalesce(created_by, auth.uid()) = auth.uid()
);

drop policy if exists chilecompra_campaigns_update on public.chilecompra_campaigns;
create policy chilecompra_campaigns_update on public.chilecompra_campaigns
for update using (
  organization_id = internal.my_org()
  and internal.my_role() in ('super','admin','comercial')
) with check (
  organization_id = internal.my_org()
  and internal.my_role() in ('super','admin','comercial')
);

drop policy if exists chilecompra_campaigns_delete on public.chilecompra_campaigns;
create policy chilecompra_campaigns_delete on public.chilecompra_campaigns
for delete using (
  organization_id = internal.my_org()
  and internal.my_role() in ('super','admin')
);

drop policy if exists chilecompra_opportunities_select on public.chilecompra_opportunities;
create policy chilecompra_opportunities_select on public.chilecompra_opportunities
for select using (organization_id = internal.my_org());

drop policy if exists chilecompra_opportunities_update on public.chilecompra_opportunities;
create policy chilecompra_opportunities_update on public.chilecompra_opportunities
for update using (
  organization_id = internal.my_org()
  and internal.my_role() in ('super','admin','comercial')
) with check (
  organization_id = internal.my_org()
  and internal.my_role() in ('super','admin','comercial')
);

drop policy if exists chilecompra_matches_select on public.chilecompra_campaign_matches;
create policy chilecompra_matches_select on public.chilecompra_campaign_matches
for select using (
  exists (
    select 1
    from public.chilecompra_campaigns c
    where c.id = campaign_id
      and c.organization_id = internal.my_org()
  )
);

insert into public.chilecompra_campaigns
  (organization_id, name, product_scope, query_terms, priority, active, system_seed, created_by)
select o.id, seed.name, seed.product_scope, seed.query_terms, seed.priority, true, true, null
from public.organizations o
cross join (
  values
    ('Telemetría e IoT',
      array['NEOFF']::text[],
      array['telemetria','telemetría','monitoreo remoto','supervisión remota','sensor','sensores','iot','internet de las cosas','m2m','scada','adquisición de datos','adquisicion de datos','variables operacionales','gateway']::text[],
      'alta'),
    ('RFID y control balístico',
      array['NEOFF']::text[],
      array['rfid','radiofrecuencia','identificación por radiofrecuencia','identificacion por radiofrecuencia','control balístico','control balistico','armamento','munición','municion','arsenal','trazabilidad de armamento','tag rfid','lector rfid','control de acceso']::text[],
      'alta'),
    ('Mantenimiento y OT',
      array['TaskFlow']::text[],
      array['orden de trabajo','órdenes de trabajo','ordenes de trabajo','mantenimiento preventivo','mantenimiento correctivo','mantenimiento','técnicos en terreno','tecnicos en terreno','checklist','inspección','inspeccion','evidencia fotográfica','evidencia fotografica','gestión de activos','gestion de activos','inventario','repuestos']::text[],
      'media'),
    ('HVAC y Facility',
      array['TaskFlow','NEOFF']::text[],
      array['hvac','climatización','climatizacion','aire acondicionado','facility','mantenimiento de infraestructura','instalaciones','equipos críticos','equipos criticos','temperatura','presión','presion']::text[],
      'media'),
    ('Telecomunicaciones',
      array['TaskFlow','NEOFF']::text[],
      array['telecomunicaciones','fibra óptica','fibra optica','torres','nodos','lte','5g','conectividad','radioenlace','redes','túneles','tuneles','antenas']::text[],
      'alta')
) as seed(name, product_scope, query_terms, priority)
on conflict (organization_id, name) do nothing;

create or replace function public.chilecompra_convert_opportunity(p_opportunity_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opp public.chilecompra_opportunities%rowtype;
  v_actor public.profiles%rowtype;
  v_lead_id uuid;
  v_notes text;
begin
  if coalesce(internal.my_role() in ('super','admin','comercial'), false) is not true then
    raise exception 'No tienes permiso para convertir oportunidades ChileCompra';
  end if;

  select * into v_opp
  from public.chilecompra_opportunities
  where id = p_opportunity_id
    and organization_id = internal.my_org()
  for update;

  if not found then raise exception 'Oportunidad ChileCompra no encontrada'; end if;
  if v_opp.lead_id is not null then return v_opp.lead_id; end if;

  select * into v_actor
  from public.profiles
  where id = auth.uid()
    and organization_id = v_opp.organization_id
    and active is true;

  if not found then raise exception 'Perfil activo no disponible'; end if;

  v_lead_id := gen_random_uuid();
  v_notes := concat(
    'Oportunidad detectada por Radar ChileCompra. Código: ', v_opp.external_code,
    case when v_opp.source_url <> '' then concat(E'\nEnlace: ', v_opp.source_url) else '' end,
    case when v_opp.description <> '' then concat(E'\n\n', v_opp.description) else '' end
  );

  insert into public.leads (
    id, organization_id, company, industry, source, stage, priority,
    probability, expected_close_date, next_action, next_date, next_type,
    owner_id, owner_name, notes, stage_history
  )
  values (
    v_lead_id,
    v_opp.organization_id,
    coalesce(nullif(v_opp.buyer_name,''), v_opp.name),
    case
      when 'Telecomunicaciones' = any(v_opp.matched_capabilities) then 'Telecomunicaciones'
      when 'HVAC' = any(v_opp.matched_capabilities) then 'HVAC'
      else ''
    end,
    'ChileCompra',
    'Contactado',
    case when v_opp.fit_level='alto' then 'Alta' else 'Media' end,
    case when v_opp.fit_level='alto' then 30 else 20 end,
    v_opp.close_at::date,
    concat('Revisar bases y estrategia para ', v_opp.external_code),
    current_date,
    'Llamada',
    auth.uid(),
    coalesce(nullif(v_actor.name,''), nullif(v_actor.email,''), 'Usuario'),
    v_notes,
    jsonb_build_array(jsonb_build_object('stage','Contactado','at',now()))
  );

  update public.chilecompra_opportunities
  set radar_state='crm', lead_id=v_lead_id, updated_at=now()
  where id=v_opp.id;

  return v_lead_id;
end;
$$;

revoke all on function public.chilecompra_convert_opportunity(uuid) from public, anon;
grant execute on function public.chilecompra_convert_opportunity(uuid) to authenticated;

-- Mantener sincronizado el radar cada dos horas. El secreto se lee en tiempo de
-- ejecución desde Vault; su valor no forma parte de esta migración.
select cron.schedule(
  'chilecompra-radar-sync',
  '0 */2 * * *',
  $$
    select net.http_post(
      url := 'https://egglrpexexcodsreumnz.supabase.co/functions/v1/chilecompra-radar',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-radar-cron',(
          select decrypted_secret
          from vault.decrypted_secrets
          where name='chilecompra_radar_cron_key'
          order by created_at desc
          limit 1
        )
      ),
      body := '{"action":"sync"}'::jsonb,
      timeout_milliseconds := 120000
    ) as request_id;
  $$
);
