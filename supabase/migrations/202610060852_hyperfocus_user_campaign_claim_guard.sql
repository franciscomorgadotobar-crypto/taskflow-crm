-- Commercial users may only claim records from their own Hyperfocus campaigns.
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
      and (internal.can_manage_all() or c.created_by = auth.uid())
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
