-- 0033: campañas ChileCompra definidas por el usuario + perfil "Mi negocio".
-- No crea campañas predefinidas ni asume productos específicos.

alter table public.chilecompra_campaign_matches
  add column if not exists reviewed_at timestamptz,
  add column if not exists last_seen_at timestamptz not null default now();

create table if not exists public.chilecompra_market_profiles (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  name text not null default 'Mi negocio',
  query_terms text[] not null default '{}',
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

alter table public.chilecompra_market_profiles enable row level security;

drop policy if exists chilecompra_market_profiles_select on public.chilecompra_market_profiles;
create policy chilecompra_market_profiles_select on public.chilecompra_market_profiles
for select to authenticated
using (organization_id = internal.my_org());

drop policy if exists chilecompra_market_profiles_insert on public.chilecompra_market_profiles;
create policy chilecompra_market_profiles_insert on public.chilecompra_market_profiles
for insert to authenticated
with check (
  organization_id = internal.my_org()
  and internal.my_role() in ('super','admin','comercial')
);

drop policy if exists chilecompra_market_profiles_update on public.chilecompra_market_profiles;
create policy chilecompra_market_profiles_update on public.chilecompra_market_profiles
for update to authenticated
using (
  organization_id = internal.my_org()
  and internal.my_role() in ('super','admin','comercial')
)
with check (
  organization_id = internal.my_org()
  and internal.my_role() in ('super','admin','comercial')
);

create index if not exists chilecompra_campaign_matches_reviewed_idx
  on public.chilecompra_campaign_matches (campaign_id, reviewed_at, updated_at desc);

update public.chilecompra_campaigns
set system_seed = false,
    product_scope = '{}'
where system_seed = true;
