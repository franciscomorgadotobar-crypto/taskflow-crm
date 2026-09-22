-- 0022: cerrar la mutación directa de claims/campaña en registros Híper Foco.
--
-- 0021 dejó deliberadamente un WITH CHECK amplio para que 0016 pudiera liberar
-- claimed_by al finalizar. Eso también permitía a un cliente PostgREST modificar
-- claimed_by/campaign_id en un UPDATE directo. La solución es mover las mutaciones
-- legítimas de claim/liberación/finalización a funciones SECURITY DEFINER que
-- validan explícitamente organización, rol y claim actual, y volver estricta la RLS.

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
    select 1 from public.hyperfocus_campaigns c
    where c.id = p_campaign_id and c.organization_id = internal.my_org()
  ) then
    raise exception 'Campaña no disponible';
  end if;

  select r.id into v_record_id
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

  if v_record_id is null then return; end if;

  update public.hyperfocus_records
  set claimed_by = auth.uid(), claimed_at = now()
  where id = v_record_id;

  return query select r.* from public.hyperfocus_records r where r.id = v_record_id;
end;
$$;

create or replace function public.hyperfocus_release_claim(p_record_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(internal.my_role() in ('super','admin','comercial'), false) is not true then
    raise exception 'No tienes permiso para gestionar Híper Foco';
  end if;

  update public.hyperfocus_records
  set claimed_by = null, claimed_at = null
  where id = p_record_id
    and organization_id = internal.my_org()
    and claimed_by = auth.uid();

  return found;
end;
$$;

drop function if exists public.hyperfocus_finalize_record(uuid, jsonb, jsonb);

create function public.hyperfocus_finalize_record(
  p_record_id uuid,
  p_patch jsonb,
  p_interaction jsonb
)
returns public.hyperfocus_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.hyperfocus_records%rowtype;
begin
  if coalesce(internal.my_role() in ('super','admin','comercial'), false) is not true then
    raise exception 'No tienes permiso para gestionar Híper Foco';
  end if;

  select * into v_record
  from public.hyperfocus_records
  where id = p_record_id
    and organization_id = internal.my_org()
    and claimed_by = auth.uid()
  for update;

  if not found then
    raise exception 'Este registro ya no está reservado para tu sesión';
  end if;

  -- campaign_id y organization_id nunca se aceptan desde el cliente. El claim solo
  -- puede conservarse por el usuario actual o liberarse; jamás transferirse.
  update public.hyperfocus_records
  set
    contacts = case when p_patch ? 'contacts' then p_patch->'contacts' else contacts end,
    status = case when p_patch ? 'status' then (p_patch->>'status') else status end,
    attempts = case when p_patch ? 'attempts' then (p_patch->>'attempts')::integer else attempts end,
    last_contact_at = case when p_patch ? 'last_contact_at' and nullif(p_patch->>'last_contact_at','') is not null then (p_patch->>'last_contact_at')::timestamptz when p_patch ? 'last_contact_at' then null else last_contact_at end,
    next_retry_at = case when p_patch ? 'next_retry_at' and nullif(p_patch->>'next_retry_at','') is not null then (p_patch->>'next_retry_at')::timestamptz when p_patch ? 'next_retry_at' then null else next_retry_at end,
    outcome = case when p_patch ? 'outcome' then coalesce(p_patch->>'outcome','') else outcome end,
    discard_reason = case when p_patch ? 'discard_reason' then coalesce(p_patch->>'discard_reason','') else discard_reason end,
    remarketing_reason = case when p_patch ? 'remarketing_reason' then coalesce(p_patch->>'remarketing_reason','') else remarketing_reason end,
    notes = case when p_patch ? 'notes' then coalesce(p_patch->>'notes','') else notes end,
    converted_lead_id = case when p_patch ? 'converted_lead_id' and nullif(p_patch->>'converted_lead_id','') is not null then (p_patch->>'converted_lead_id')::uuid when p_patch ? 'converted_lead_id' then null else converted_lead_id end,
    existing_lead_id = case when p_patch ? 'existing_lead_id' and nullif(p_patch->>'existing_lead_id','') is not null then (p_patch->>'existing_lead_id')::uuid when p_patch ? 'existing_lead_id' then null else existing_lead_id end,
    claimed_by = case
      when p_patch ? 'claimed_by' and nullif(p_patch->>'claimed_by','') is null then null
      else claimed_by
    end,
    claimed_at = case
      when p_patch ? 'claimed_at' and nullif(p_patch->>'claimed_at','') is null then null
      else claimed_at
    end,
    priority = case when p_patch ? 'priority' then (p_patch->>'priority')::integer else priority end
  where id = p_record_id;

  insert into public.hyperfocus_interactions (
    id, campaign_id, record_id, organization_id, created_by,
    contact_id, contact_snapshot, channel, contact_result, commercial_result, detail
  ) values (
    coalesce(nullif(p_interaction->>'id','')::uuid, gen_random_uuid()),
    v_record.campaign_id,
    p_record_id,
    v_record.organization_id,
    auth.uid(),
    coalesce(p_interaction->>'contact_id',''),
    coalesce(p_interaction->'contact_snapshot','{}'::jsonb),
    coalesce(p_interaction->>'channel',''),
    coalesce(p_interaction->>'contact_result',''),
    coalesce(p_interaction->>'commercial_result',''),
    coalesce(p_interaction->>'detail','')
  );

  select * into v_record
  from public.hyperfocus_records
  where id = p_record_id;

  return v_record;
end;
$;

drop policy if exists hyperfocus_records_update on public.hyperfocus_records;
create policy hyperfocus_records_update on public.hyperfocus_records for update to authenticated
  using (
    organization_id = internal.my_org()
    and internal.my_role() in ('super','admin','comercial')
    and (internal.can_manage_all() or claimed_by = auth.uid())
  )
  with check (
    organization_id = internal.my_org()
    and internal.my_role() in ('super','admin','comercial')
    and (
      internal.can_manage_all()
      or claimed_by = auth.uid()
    )
  );

revoke all on function public.hyperfocus_claim_next(uuid) from public, anon;
grant execute on function public.hyperfocus_claim_next(uuid) to authenticated;

revoke all on function public.hyperfocus_release_claim(uuid) from public, anon;
grant execute on function public.hyperfocus_release_claim(uuid) to authenticated;

revoke all on function public.hyperfocus_finalize_record(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.hyperfocus_finalize_record(uuid, jsonb, jsonb) to authenticated;
