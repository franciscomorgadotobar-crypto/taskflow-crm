-- Híper Foco colaborativo: una campaña, colas exclusivas por usuario y avance por ejecutivo.
-- Migración aditiva: no cambia campañas ni registros existentes.
alter table public.hyperfocus_records
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null;

create index if not exists hyperfocus_records_assigned_queue_idx
  on public.hyperfocus_records (campaign_id, assigned_to, status, row_number);

-- Evita asignaciones directas desde el navegador, incluso si el usuario
-- tiene UPDATE sobre su registro. Solo RPC verificadas (SECURITY DEFINER) pueden repartir.
create or replace function internal.hyperfocus_assignment_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user not in ('postgres', 'service_role') then
    if tg_op = 'INSERT' and new.assigned_to is not null then
      raise exception 'Usa la distribución de campaña para asignar registros';
    end if;
    if tg_op = 'UPDATE' and old.assigned_to is distinct from new.assigned_to then
      raise exception 'La asignación solo puede cambiarse desde el módulo de colaboración';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists hyperfocus_assignment_guard on public.hyperfocus_records;
create trigger hyperfocus_assignment_guard
before insert or update on public.hyperfocus_records
for each row execute function internal.hyperfocus_assignment_guard();

-- Helper SECURITY DEFINER para evitar recursión entre políticas de campañas y registros.
create or replace function internal.hyperfocus_assigned_to_me(p_campaign_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.hyperfocus_records r
    where r.campaign_id = p_campaign_id
      and r.organization_id = internal.my_org()
      and r.assigned_to = auth.uid()
  );
$$;
revoke all on function internal.hyperfocus_assigned_to_me(uuid) from public, anon;
grant execute on function internal.hyperfocus_assigned_to_me(uuid) to authenticated;

drop policy if exists hyperfocus_campaigns_select on public.hyperfocus_campaigns;
create policy hyperfocus_campaigns_select on public.hyperfocus_campaigns
for select to authenticated using (
  organization_id = internal.my_org()
  and (
    internal.can_manage_all()
    or created_by = auth.uid()
    or internal.hyperfocus_assigned_to_me(id)
  )
);

drop policy if exists hyperfocus_records_select on public.hyperfocus_records;
create policy hyperfocus_records_select on public.hyperfocus_records
for select to authenticated using (
  organization_id = internal.my_org()
  and (
    internal.can_manage_all()
    or assigned_to = auth.uid()
    or exists (
      select 1 from public.hyperfocus_campaigns c
      where c.id = hyperfocus_records.campaign_id
        and c.organization_id = internal.my_org()
        and c.created_by = auth.uid()
    )
  )
);

-- Los participantes pueden revisar el historial que generaron y el de sus registros.
drop policy if exists hyperfocus_interactions_select on public.hyperfocus_interactions;
create policy hyperfocus_interactions_select on public.hyperfocus_interactions
for select to authenticated using (
  organization_id = internal.my_org()
  and (
    internal.can_manage_all()
    or created_by = auth.uid()
    or exists (
      select 1 from public.hyperfocus_campaigns c
      where c.id = hyperfocus_interactions.campaign_id
        and c.created_by = auth.uid()
        and c.organization_id = internal.my_org()
    )
    or exists (
      select 1 from public.hyperfocus_records r
      where r.id = hyperfocus_interactions.record_id
        and r.campaign_id = hyperfocus_interactions.campaign_id
        and r.assigned_to = auth.uid()
    )
  )
);

-- Usuarios activos del mismo CRM, habilitados para Híper Foco.
create or replace function public.hyperfocus_team_members()
returns table(user_id uuid, display_name text, user_role text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(internal.my_role() in ('super','admin','comercial'), false) is not true then
    raise exception 'No tienes acceso a los integrantes de Híper Foco';
  end if;
  return query
  select p.id, coalesce(nullif(trim(p.name),''), 'Usuario CRM'), p.role
  from public.profiles p
  where p.organization_id = internal.my_org()
    and p.active is true
    and p.role in ('super','admin','comercial')
    and 'hyperfocus' = any(p.module_access)
  order by p.name, p.id;
end;
$$;
revoke all on function public.hyperfocus_team_members() from public, anon;
grant execute on function public.hyperfocus_team_members() to authenticated;

-- Distribución determinista y atómica. Preserva registros gestionados o reservados.
create or replace function public.hyperfocus_distribute_campaign(
  p_campaign_id uuid,
  p_assignees uuid[]
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := internal.my_org();
  v_owner uuid;
  v_team uuid[];
  v_valid integer;
  v_updated integer;
  v_preserved integer;
begin
  if coalesce(internal.my_role() in ('super','admin','comercial'), false) is not true then
    raise exception 'No tienes permisos para distribuir Híper Foco';
  end if;
  select c.created_by into v_owner
  from public.hyperfocus_campaigns c
  where c.id = p_campaign_id and c.organization_id = v_org
  for update;

  if not found or not (internal.can_manage_all() or v_owner = auth.uid()) then
    raise exception 'Solo el creador o administrador puede distribuir esta campaña';
  end if;

  select array_agg(id order by first_position) into v_team
  from (
    select id, min(position) as first_position
    from unnest(coalesce(p_assignees, '{}'::uuid[])) with ordinality a(id, position)
    where id is not null
    group by id
  ) members;

  if coalesce(cardinality(v_team), 0) < 1 or cardinality(v_team) > 15 then
    raise exception 'Selecciona entre 1 y 15 integrantes';
  end if;

  select count(*) into v_valid from public.profiles p
  where p.id = any(v_team)
    and p.organization_id = v_org
    and p.active is true
    and p.role in ('super','admin','comercial')
    and 'hyperfocus' = any(p.module_access);
  if v_valid <> cardinality(v_team) then
    raise exception 'La selección incluye usuarios inactivos, sin acceso o de otra organización';
  end if;

  -- No se mueve ningún registro con intentos realizados o claim vigente.
  -- Los reintentos sin intentos y los pendientes libres se reparten en bloques equilibrados.
  with locked as materialized (
    select r.id, r.row_number
    from public.hyperfocus_records r
    where r.campaign_id = p_campaign_id
      and r.organization_id = v_org
      and r.status in ('pending','retry')
      and r.attempts = 0
      and (r.claimed_by is null or r.claimed_at < now() - interval '45 minutes')
    order by r.row_number, r.id
    for update skip locked
  ),
  numbered as (
    select l.id, row_number() over (order by l.row_number, l.id) as seq
    from locked l
  )
  update public.hyperfocus_records r
  set assigned_to = v_team[1 + ((n.seq - 1) % cardinality(v_team))::integer],
      claimed_by = null,
      claimed_at = null,
      updated_at = now()
  from numbered n
  where r.id = n.id;
  get diagnostics v_updated = row_count;

  select count(*) into v_preserved
  from public.hyperfocus_records r
  where r.campaign_id = p_campaign_id and r.organization_id = v_org
    and (r.attempts > 0 or (r.claimed_by is not null and r.claimed_at >= now() - interval '45 minutes'));

  update public.hyperfocus_campaigns c
    set options = coalesce(c.options, '{}'::jsonb) || jsonb_build_object('collaborative', true),
        updated_at = now()
    where c.id = p_campaign_id;

  return jsonb_build_object(
    'campaign_id', p_campaign_id,
    'distributed', v_updated,
    'preserved', v_preserved,
    'team_size', cardinality(v_team)
  );
end;
$$;
revoke all on function public.hyperfocus_distribute_campaign(uuid, uuid[]) from public, anon;
grant execute on function public.hyperfocus_distribute_campaign(uuid, uuid[]) to authenticated;

create or replace function public.hyperfocus_assignment_overview(p_campaign_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_is_shared boolean;
  v_rows jsonb;
begin
  if coalesce(internal.my_role() in ('super','admin','comercial'), false) is not true then
    raise exception 'No tienes permiso para Híper Foco';
  end if;
  select c.created_by, coalesce((c.options->>'collaborative')::boolean, false)
    into v_owner, v_is_shared
    from public.hyperfocus_campaigns c
   where c.id = p_campaign_id and c.organization_id = internal.my_org();
  if not found or not (
    internal.can_manage_all()
    or v_owner = auth.uid()
    or internal.hyperfocus_assigned_to_me(p_campaign_id)
  ) then
    raise exception 'Campaña no disponible';
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.total desc, x.display_name), '[]'::jsonb)
  into v_rows
  from (
    select r.assigned_to as user_id,
           case when r.assigned_to is null then 'Sin asignar'
                else coalesce(nullif(p.name,''),'Usuario CRM') end as display_name,
           count(*)::integer as total,
           count(*) filter (where r.status = 'pending')::integer as pending,
           count(*) filter (where r.status = 'retry')::integer as retry,
           count(*) filter (where r.status = 'converted')::integer as converted,
           count(*) filter (where r.status = 'remarketing')::integer as remarketing,
           count(*) filter (where r.status = 'discarded')::integer as discarded,
           count(*) filter (where r.attempts > 0)::integer as touched
    from public.hyperfocus_records r
    left join public.profiles p on p.id = r.assigned_to and p.organization_id = r.organization_id
    where r.campaign_id = p_campaign_id and r.organization_id = internal.my_org()
    group by r.assigned_to,p.name
  ) x;
  return jsonb_build_object('shared',v_is_shared,'members',v_rows);
end;
$$;
revoke all on function public.hyperfocus_assignment_overview(uuid) from public, anon;
grant execute on function public.hyperfocus_assignment_overview(uuid) to authenticated;

-- El claim sigue siendo exclusivo (FOR UPDATE SKIP LOCKED), y además
-- nunca entrega a un ejecutivo registros asignados a otra persona.
create or replace function public.hyperfocus_claim_next(p_campaign_id uuid)
returns setof public.hyperfocus_records
language plpgsql security definer set search_path = '' as $$
declare
  v_record_id uuid;
  v_owner uuid;
  v_manage boolean;
begin
  if coalesce(internal.my_role() in ('super','admin','comercial'),false) is not true then
    raise exception 'No tienes permiso para gestionar Híper Foco';
  end if;
  select c.created_by into v_owner from public.hyperfocus_campaigns c
  where c.id = p_campaign_id and c.organization_id = internal.my_org();
  v_manage := internal.can_manage_all() or v_owner = auth.uid();
  if not found or not (v_manage or internal.hyperfocus_assigned_to_me(p_campaign_id)) then
    raise exception 'Campaña no disponible';
  end if;

  select r.id into v_record_id
  from public.hyperfocus_records r
  where r.campaign_id = p_campaign_id
    and r.organization_id = internal.my_org()
    and (
      r.assigned_to = auth.uid()
      or (r.assigned_to is null and v_manage)
    )
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
    case when r.status = 'retry' then coalesce(r.next_retry_at,r.created_at) else r.created_at end asc,
    r.row_number asc
  for update skip locked
  limit 1;

  if v_record_id is null then return; end if;
  update public.hyperfocus_records
     set claimed_by = auth.uid(), claimed_at = now()
   where id = v_record_id;
  return query select r.* from public.hyperfocus_records r where r.id = v_record_id;
end;
$$;
revoke all on function public.hyperfocus_claim_next(uuid) from public, anon;
grant execute on function public.hyperfocus_claim_next(uuid) to authenticated;

-- "Disponibles ahora" debe ser la cola que este usuario puede reclamar.
create or replace view public.hyperfocus_campaign_stats with (security_invoker=true) as
select campaign_id,
 count(*) as total,
 count(*) filter (where status='pending') as pending,
 count(*) filter (where status='retry') as retry,
 count(*) filter (where status='converted') as converted,
 count(*) filter (where status='remarketing') as remarketing,
 count(*) filter (where status='discarded') as discarded,
 count(*) filter (
   where (status='pending' or status='retry' and (next_retry_at is null or next_retry_at <= now()))
   and (assigned_to is null or assigned_to = auth.uid())
   and (claimed_by is null or claimed_by = auth.uid() or claimed_at < now()- interval '45 minutes')
 ) as available_now,
 count(*) filter (where attempts > 0) as touched
from public.hyperfocus_records
group by campaign_id;
grant select on public.hyperfocus_campaign_stats to authenticated;
