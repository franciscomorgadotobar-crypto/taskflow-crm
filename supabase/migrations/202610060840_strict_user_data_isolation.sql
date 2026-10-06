-- Strict per-user isolation for Comercial/Visita while Super/Admin retain team visibility.
-- Applied to Supabase on 2026-10-06.

create or replace function internal.can_see_lead(lead uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.leads l
    where l.id = lead
      and l.organization_id = internal.my_org()
      and (
        internal.my_role() = 'super'
        or (internal.my_role() = 'admin' and (not l.is_private or l.owner_id = auth.uid()))
        or (internal.my_role() in ('comercial','visita') and l.owner_id = auth.uid())
      )
  );
$$;

drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated
using (
  organization_id = internal.my_org()
  and (
    internal.my_role() = 'super'
    or (internal.my_role() = 'admin' and (not is_private or owner_id = auth.uid()))
    or (internal.my_role() in ('comercial','visita') and owner_id = auth.uid())
  )
);

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using (organization_id = internal.my_org() and (internal.can_manage_all() or id = auth.uid()));

drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities for select to authenticated
using (
  organization_id = internal.my_org()
  and (
    (lead_id is not null and internal.can_see_lead(lead_id))
    or (lead_id is null and (internal.can_manage_all() or owner_id = auth.uid()))
  )
);

drop policy if exists hyperfocus_campaigns_select on public.hyperfocus_campaigns;
create policy hyperfocus_campaigns_select on public.hyperfocus_campaigns for select to authenticated
using (organization_id = internal.my_org() and (internal.can_manage_all() or created_by = auth.uid()));

drop policy if exists hyperfocus_records_select on public.hyperfocus_records;
create policy hyperfocus_records_select on public.hyperfocus_records for select to authenticated
using (
  organization_id = internal.my_org()
  and (
    internal.can_manage_all()
    or exists (
      select 1 from public.hyperfocus_campaigns c
      where c.id = hyperfocus_records.campaign_id
        and c.organization_id = internal.my_org()
        and c.created_by = auth.uid()
    )
  )
);

drop policy if exists hyperfocus_interactions_select on public.hyperfocus_interactions;
create policy hyperfocus_interactions_select on public.hyperfocus_interactions for select to authenticated
using (
  organization_id = internal.my_org()
  and (
    internal.can_manage_all()
    or exists (
      select 1 from public.hyperfocus_campaigns c
      where c.id = hyperfocus_interactions.campaign_id
        and c.organization_id = internal.my_org()
        and c.created_by = auth.uid()
    )
  )
);

alter table public.chilecompra_campaigns
  drop constraint if exists chilecompra_campaigns_organization_id_name_key;
create unique index if not exists chilecompra_campaigns_org_creator_name_uidx
  on public.chilecompra_campaigns(organization_id, created_by, name);

drop policy if exists chilecompra_campaigns_select on public.chilecompra_campaigns;
create policy chilecompra_campaigns_select on public.chilecompra_campaigns for select to authenticated
using (organization_id = internal.my_org() and (internal.can_manage_all() or created_by = auth.uid()));

drop policy if exists chilecompra_campaigns_update on public.chilecompra_campaigns;
create policy chilecompra_campaigns_update on public.chilecompra_campaigns for update to authenticated
using (
  organization_id = internal.my_org()
  and internal.my_role() in ('super','admin','comercial')
  and (internal.can_manage_all() or created_by = auth.uid())
)
with check (
  organization_id = internal.my_org()
  and internal.my_role() in ('super','admin','comercial')
  and (internal.can_manage_all() or created_by = auth.uid())
);

drop policy if exists chilecompra_campaigns_delete on public.chilecompra_campaigns;
create policy chilecompra_campaigns_delete on public.chilecompra_campaigns for delete to authenticated
using (
  organization_id = internal.my_org()
  and internal.my_role() in ('super','admin','comercial')
  and (internal.can_manage_all() or created_by = auth.uid())
);

drop policy if exists chilecompra_matches_select on public.chilecompra_campaign_matches;
create policy chilecompra_matches_select on public.chilecompra_campaign_matches for select to authenticated
using (
  exists (
    select 1 from public.chilecompra_campaigns c
    where c.id = chilecompra_campaign_matches.campaign_id
      and c.organization_id = internal.my_org()
      and (internal.can_manage_all() or c.created_by = auth.uid())
  )
);

alter table public.chilecompra_market_profiles add column if not exists profile_id uuid;
update public.chilecompra_market_profiles mp
set profile_id = coalesce(
  mp.updated_by,
  (
    select p.id from public.profiles p
    where p.organization_id = mp.organization_id and p.active = true
    order by case when p.role='super' then 0 when p.role='admin' then 1 else 2 end, p.created_at
    limit 1
  )
)
where profile_id is null;
alter table public.chilecompra_market_profiles drop constraint if exists chilecompra_market_profiles_pkey;
alter table public.chilecompra_market_profiles alter column profile_id set not null;
alter table public.chilecompra_market_profiles
  add constraint chilecompra_market_profiles_profile_id_fkey foreign key (profile_id) references public.profiles(id) on delete cascade;
alter table public.chilecompra_market_profiles
  add constraint chilecompra_market_profiles_pkey primary key (organization_id, profile_id);

drop policy if exists chilecompra_market_profiles_select on public.chilecompra_market_profiles;
create policy chilecompra_market_profiles_select on public.chilecompra_market_profiles for select to authenticated
using (organization_id = internal.my_org() and profile_id = auth.uid());

drop policy if exists chilecompra_market_profiles_insert on public.chilecompra_market_profiles;
create policy chilecompra_market_profiles_insert on public.chilecompra_market_profiles for insert to authenticated
with check (
  organization_id = internal.my_org()
  and profile_id = auth.uid()
  and internal.my_role() in ('super','admin','comercial')
  and coalesce(updated_by, auth.uid()) = auth.uid()
);

drop policy if exists chilecompra_market_profiles_update on public.chilecompra_market_profiles;
create policy chilecompra_market_profiles_update on public.chilecompra_market_profiles for update to authenticated
using (
  organization_id = internal.my_org()
  and profile_id = auth.uid()
  and internal.my_role() in ('super','admin','comercial')
)
with check (
  organization_id = internal.my_org()
  and profile_id = auth.uid()
  and internal.my_role() in ('super','admin','comercial')
  and coalesce(updated_by, auth.uid()) = auth.uid()
);

create table if not exists public.chilecompra_user_states (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  opportunity_id uuid not null references public.chilecompra_opportunities(id) on delete cascade,
  radar_state text not null default 'nuevo' check (radar_state in ('nuevo','guardado','crm','descartado')),
  lead_id uuid references public.leads(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, profile_id, opportunity_id)
);
alter table public.chilecompra_user_states enable row level security;
drop policy if exists chilecompra_user_states_select on public.chilecompra_user_states;
create policy chilecompra_user_states_select on public.chilecompra_user_states for select to authenticated
using (organization_id = internal.my_org() and profile_id = auth.uid());
drop policy if exists chilecompra_user_states_insert on public.chilecompra_user_states;
create policy chilecompra_user_states_insert on public.chilecompra_user_states for insert to authenticated
with check (
  organization_id = internal.my_org()
  and profile_id = auth.uid()
  and internal.my_role() in ('super','admin','comercial')
);
drop policy if exists chilecompra_user_states_update on public.chilecompra_user_states;
create policy chilecompra_user_states_update on public.chilecompra_user_states for update to authenticated
using (
  organization_id = internal.my_org()
  and profile_id = auth.uid()
  and internal.my_role() in ('super','admin','comercial')
)
with check (
  organization_id = internal.my_org()
  and profile_id = auth.uid()
  and internal.my_role() in ('super','admin','comercial')
);
drop policy if exists chilecompra_user_states_delete on public.chilecompra_user_states;
create policy chilecompra_user_states_delete on public.chilecompra_user_states for delete to authenticated
using (
  organization_id = internal.my_org()
  and profile_id = auth.uid()
  and internal.my_role() in ('super','admin','comercial')
);

insert into public.chilecompra_user_states(organization_id, profile_id, opportunity_id, radar_state, lead_id, updated_at)
select
  o.organization_id,
  coalesce(
    l.owner_id,
    (
      select p.id from public.profiles p
      where p.organization_id=o.organization_id and p.active=true
      order by case when p.role='super' then 0 when p.role='admin' then 1 else 2 end, p.created_at
      limit 1
    )
  ),
  o.id, o.radar_state, o.lead_id, coalesce(o.updated_at, now())
from public.chilecompra_opportunities o
left join public.leads l on l.id=o.lead_id
where (o.radar_state is distinct from 'nuevo' or o.lead_id is not null)
  and coalesce(
    l.owner_id,
    (
      select p.id from public.profiles p
      where p.organization_id=o.organization_id and p.active=true
      order by case when p.role='super' then 0 when p.role='admin' then 1 else 2 end, p.created_at
      limit 1
    )
  ) is not null
on conflict (organization_id,profile_id,opportunity_id)
do update set radar_state=excluded.radar_state, lead_id=excluded.lead_id, updated_at=excluded.updated_at;

update public.chilecompra_opportunities
set radar_state='nuevo', lead_id=null
where radar_state is distinct from 'nuevo' or lead_id is not null;

drop policy if exists chilecompra_opportunities_update on public.chilecompra_opportunities;

alter table public.chilecompra_cm_states add column if not exists profile_id uuid;
update public.chilecompra_cm_states s
set profile_id = coalesce(
  s.updated_by,
  (
    select p.id from public.profiles p
    where p.organization_id=s.organization_id and p.active=true
    order by case when p.role='super' then 0 when p.role='admin' then 1 else 2 end, p.created_at
    limit 1
  )
)
where profile_id is null;
alter table public.chilecompra_cm_states drop constraint if exists chilecompra_cm_states_pkey;
alter table public.chilecompra_cm_states alter column profile_id set not null;
alter table public.chilecompra_cm_states
  add constraint chilecompra_cm_states_profile_id_fkey foreign key (profile_id) references public.profiles(id) on delete cascade;
alter table public.chilecompra_cm_states
  add constraint chilecompra_cm_states_pkey primary key (organization_id, profile_id, order_code);
drop policy if exists chilecompra_cm_states_select on public.chilecompra_cm_states;
create policy chilecompra_cm_states_select on public.chilecompra_cm_states for select to authenticated
using (organization_id = internal.my_org() and profile_id = auth.uid());
drop policy if exists chilecompra_cm_states_insert on public.chilecompra_cm_states;
create policy chilecompra_cm_states_insert on public.chilecompra_cm_states for insert to authenticated
with check (
  organization_id = internal.my_org()
  and profile_id = auth.uid()
  and internal.my_role() in ('super','admin','comercial')
  and coalesce(updated_by, auth.uid()) = auth.uid()
);
drop policy if exists chilecompra_cm_states_update on public.chilecompra_cm_states;
create policy chilecompra_cm_states_update on public.chilecompra_cm_states for update to authenticated
using (
  organization_id = internal.my_org()
  and profile_id = auth.uid()
  and internal.my_role() in ('super','admin','comercial')
)
with check (
  organization_id = internal.my_org()
  and profile_id = auth.uid()
  and internal.my_role() in ('super','admin','comercial')
  and coalesce(updated_by, auth.uid()) = auth.uid()
);

create or replace function public.chilecompra_convert_opportunity(p_opportunity_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_opp public.chilecompra_opportunities%rowtype;
  v_actor public.profiles%rowtype;
  v_existing public.chilecompra_user_states%rowtype;
  v_lead_id uuid;
  v_notes text;
begin
  if coalesce(internal.my_role() in ('super','admin','comercial'), false) is not true then
    raise exception 'No tienes permiso para convertir oportunidades ChileCompra';
  end if;
  select * into v_opp from public.chilecompra_opportunities
  where id=p_opportunity_id and organization_id=internal.my_org();
  if not found then raise exception 'Oportunidad ChileCompra no encontrada'; end if;

  select * into v_existing from public.chilecompra_user_states
  where organization_id=v_opp.organization_id and profile_id=auth.uid() and opportunity_id=v_opp.id;
  if found and v_existing.lead_id is not null then return v_existing.lead_id; end if;

  select * into v_actor from public.profiles
  where id=auth.uid() and organization_id=v_opp.organization_id and active is true;
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
  ) values (
    v_lead_id, v_opp.organization_id, coalesce(nullif(v_opp.buyer_name,''), v_opp.name),
    case when 'Telecomunicaciones'=any(v_opp.matched_capabilities) then 'Telecomunicaciones'
         when 'HVAC'=any(v_opp.matched_capabilities) then 'HVAC' else '' end,
    'ChileCompra','Contactado',
    case when v_opp.fit_level='alto' then 'Alta' else 'Media' end,
    case when v_opp.fit_level='alto' then 30 else 20 end,
    v_opp.close_at::date, concat('Revisar bases y estrategia para ',v_opp.external_code),
    current_date,'Llamada',auth.uid(),
    coalesce(nullif(v_actor.name,''),nullif(v_actor.email,''),'Usuario'),
    v_notes,jsonb_build_array(jsonb_build_object('stage','Contactado','at',now()))
  );

  insert into public.chilecompra_user_states(
    organization_id,profile_id,opportunity_id,radar_state,lead_id,updated_at
  ) values(v_opp.organization_id,auth.uid(),v_opp.id,'crm',v_lead_id,now())
  on conflict (organization_id,profile_id,opportunity_id)
  do update set radar_state='crm',lead_id=excluded.lead_id,updated_at=now();

  return v_lead_id;
end;
$$;
