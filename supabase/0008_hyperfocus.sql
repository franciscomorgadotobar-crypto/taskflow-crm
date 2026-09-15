-- 0008: Híper Foco — campañas de prospección masiva fuera del CRM.
--
-- Una base importada vive primero acá. Solo cuando una gestión califica la empresa
-- se crea/actualiza un lead del CRM. Esto evita llenar el pipeline con miles de
-- registros fríos y permite reanudar campañas grandes exactamente donde quedaron.

create table public.hyperfocus_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id),
  created_by uuid references public.profiles(id),
  name text not null,
  campaign_type text not null default 'prospecting'
    check (campaign_type in ('prospecting','reactivation','remarketing','recovery')),
  source_filename text not null default '',
  source_sheet text not null default '',
  default_industry text not null default '',
  mapping jsonb not null default '{}',
  options jsonb not null default '{}',
  source_meta jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index hyperfocus_campaigns_org_idx on public.hyperfocus_campaigns(organization_id);
create index hyperfocus_campaigns_created_by_idx on public.hyperfocus_campaigns(created_by);

create table public.hyperfocus_records (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.hyperfocus_campaigns(id) on delete cascade,
  organization_id uuid references public.organizations(id),
  row_number integer not null default 0,
  company text not null,
  rut text not null default '',
  industry text not null default '',
  region text not null default '',
  comuna text not null default '',
  city text not null default '',
  address text not null default '',
  website text not null default '',
  contacts jsonb not null default '[]',
  raw_data jsonb not null default '{}',
  existing_lead_id uuid references public.leads(id) on delete set null,
  converted_lead_id uuid references public.leads(id) on delete set null,
  claimed_by uuid references public.profiles(id) on delete set null,
  claimed_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending','retry','converted','remarketing','discarded')),
  priority integer not null default 0,
  attempts integer not null default 0,
  last_contact_at timestamptz,
  next_retry_at timestamptz,
  outcome text not null default '',
  discard_reason text not null default '',
  remarketing_reason text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index hyperfocus_records_campaign_idx on public.hyperfocus_records(campaign_id);
create index hyperfocus_records_queue_idx on public.hyperfocus_records(campaign_id, status, priority desc, row_number);
create index hyperfocus_records_retry_idx on public.hyperfocus_records(campaign_id, next_retry_at) where status = 'retry';
create index hyperfocus_records_existing_lead_idx on public.hyperfocus_records(existing_lead_id);
create index hyperfocus_records_claim_idx on public.hyperfocus_records(campaign_id, claimed_at) where claimed_by is not null;

create table public.hyperfocus_interactions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.hyperfocus_campaigns(id) on delete cascade,
  record_id uuid not null references public.hyperfocus_records(id) on delete cascade,
  organization_id uuid references public.organizations(id),
  created_by uuid references public.profiles(id),
  contact_id text not null default '',
  contact_snapshot jsonb not null default '{}',
  channel text not null default '',
  contact_result text not null default '',
  commercial_result text not null default '',
  detail text not null default '',
  created_at timestamptz not null default now()
);

create index hyperfocus_interactions_record_idx on public.hyperfocus_interactions(record_id, created_at desc);
create index hyperfocus_interactions_campaign_idx on public.hyperfocus_interactions(campaign_id, created_at desc);

create trigger set_updated_at before update on public.hyperfocus_campaigns
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.hyperfocus_records
  for each row execute function public.set_updated_at();

-- organization_id se completa en servidor igual que en leads/actividades.
create trigger set_org before insert on public.hyperfocus_campaigns
  for each row execute function internal.set_org();
create trigger set_org before insert on public.hyperfocus_records
  for each row execute function internal.set_org();
create trigger set_org before insert on public.hyperfocus_interactions
  for each row execute function internal.set_org();

alter table public.hyperfocus_campaigns enable row level security;
alter table public.hyperfocus_records enable row level security;
alter table public.hyperfocus_interactions enable row level security;

-- Toda la organización puede ver las campañas. Visita queda solo lectura.
create policy hyperfocus_campaigns_select on public.hyperfocus_campaigns for select to authenticated
  using (organization_id = internal.my_org());
create policy hyperfocus_campaigns_insert on public.hyperfocus_campaigns for insert to authenticated
  with check (
    organization_id = internal.my_org()
    and internal.my_role() in ('super','admin','comercial')
    and (created_by is null or created_by = auth.uid() or internal.can_manage_all())
  );
create policy hyperfocus_campaigns_update on public.hyperfocus_campaigns for update to authenticated
  using (
    organization_id = internal.my_org()
    and (internal.can_manage_all() or created_by = auth.uid())
  )
  with check (organization_id = internal.my_org());
create policy hyperfocus_campaigns_delete on public.hyperfocus_campaigns for delete to authenticated
  using (
    organization_id = internal.my_org()
    and (internal.can_manage_all() or created_by = auth.uid())
  );

create policy hyperfocus_records_select on public.hyperfocus_records for select to authenticated
  using (organization_id = internal.my_org());
create policy hyperfocus_records_insert on public.hyperfocus_records for insert to authenticated
  with check (
    organization_id = internal.my_org()
    and internal.my_role() in ('super','admin','comercial')
    and exists (
      select 1 from public.hyperfocus_campaigns c
      where c.id = hyperfocus_records.campaign_id and c.organization_id = internal.my_org()
    )
  );
create policy hyperfocus_records_update on public.hyperfocus_records for update to authenticated
  using (
    organization_id = internal.my_org()
    and (internal.can_manage_all() or claimed_by = auth.uid())
  )
  with check (organization_id = internal.my_org());
create policy hyperfocus_records_delete on public.hyperfocus_records for delete to authenticated
  using (
    organization_id = internal.my_org()
    and (
      internal.can_manage_all()
      or exists (
        select 1 from public.hyperfocus_campaigns c
        where c.id = hyperfocus_records.campaign_id and c.created_by = auth.uid()
      )
    )
  );

create policy hyperfocus_interactions_select on public.hyperfocus_interactions for select to authenticated
  using (organization_id = internal.my_org());
create policy hyperfocus_interactions_insert on public.hyperfocus_interactions for insert to authenticated
  with check (
    organization_id = internal.my_org()
    and internal.my_role() in ('super','admin','comercial')
    and (created_by is null or created_by = auth.uid() or internal.can_manage_all())
  );
create policy hyperfocus_interactions_update on public.hyperfocus_interactions for update to authenticated
  using (organization_id = internal.my_org() and internal.can_manage_all())
  with check (organization_id = internal.my_org());
create policy hyperfocus_interactions_delete on public.hyperfocus_interactions for delete to authenticated
  using (organization_id = internal.my_org() and internal.can_manage_all());

-- Resumen liviano: evita descargar 14.000+ registros solo para pintar las tarjetas.
create or replace view public.hyperfocus_campaign_stats
with (security_invoker = true)
as
select
  campaign_id,
  count(*)::bigint as total,
  count(*) filter (where status = 'pending')::bigint as pending,
  count(*) filter (where status = 'retry')::bigint as retry,
  count(*) filter (where status = 'converted')::bigint as converted,
  count(*) filter (where status = 'remarketing')::bigint as remarketing,
  count(*) filter (where status = 'discarded')::bigint as discarded,
  count(*) filter (
    where (status = 'pending'
       or (status = 'retry' and (next_retry_at is null or next_retry_at <= now())))
      and (claimed_by is null or claimed_by = auth.uid() or claimed_at < now() - interval '45 minutes')
  )::bigint as available_now,
  count(*) filter (where attempts > 0)::bigint as touched
from public.hyperfocus_records
group by campaign_id;

grant select on public.hyperfocus_campaign_stats to authenticated;

-- Reclamo atómico de la siguiente empresa. Evita que dos comerciales llamen al mismo
-- registro de una campaña compartida al mismo tiempo. Los reclamos abandonados vencen.
create or replace function public.hyperfocus_claim_next(p_campaign_id uuid)
returns setof public.hyperfocus_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record_id uuid;
begin
  if coalesce(internal.my_role() in ('super','admin','comercial'), false) is not true then
    raise exception 'No tienes permiso para gestionar Híper Foco';
  end if;

  if not exists (
    select 1
    from public.hyperfocus_campaigns c
    where c.id = p_campaign_id
      and c.organization_id = internal.my_org()
  ) then
    raise exception 'Campaña no disponible';
  end if;

  select r.id
    into v_record_id
  from public.hyperfocus_records r
  where r.campaign_id = p_campaign_id
    and r.organization_id = internal.my_org()
    and (
      r.status = 'pending'
      or (r.status = 'retry' and (r.next_retry_at is null or r.next_retry_at <= now()))
    )
    and (
      r.claimed_by is null
      or r.claimed_by = auth.uid()
      or r.claimed_at < now() - interval '45 minutes'
    )
  order by
    case when r.status = 'retry' then 1 else 0 end desc,
    r.priority desc,
    case when r.status = 'retry' then coalesce(r.next_retry_at, r.created_at) else r.created_at end asc,
    r.row_number asc
  for update skip locked
  limit 1;

  if v_record_id is null then
    return;
  end if;

  update public.hyperfocus_records
     set claimed_by = auth.uid(), claimed_at = now()
   where id = v_record_id;

  return query
    select r.* from public.hyperfocus_records r where r.id = v_record_id;
end;
$$;

revoke all on function public.hyperfocus_claim_next(uuid) from public, anon;
grant execute on function public.hyperfocus_claim_next(uuid) to authenticated;

-- Privilegios de tabla explícitos; RLS sigue siendo la barrera efectiva por organización/rol.
grant select, insert, update, delete on public.hyperfocus_campaigns to authenticated;
grant select, insert, update, delete on public.hyperfocus_records to authenticated;
grant select, insert, update, delete on public.hyperfocus_interactions to authenticated;
