-- 0016: cierre atómico de una gestión de Híper Foco.
--
-- Actualiza el registro reclamado y crea su interacción dentro de la misma
-- transacción. Si cualquiera de las dos operaciones falla, ninguna queda
-- persistida. La función conserva RLS mediante SECURITY INVOKER.

create or replace function public.hyperfocus_finalize_record(
  p_record_id uuid,
  p_patch jsonb,
  p_interaction jsonb
)
returns public.hyperfocus_records
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_record public.hyperfocus_records%rowtype;
begin
  select *
    into v_record
    from public.hyperfocus_records
   where id = p_record_id
     and claimed_by = auth.uid()
   for update;

  if not found then
    raise exception 'Este registro ya no está reservado para tu sesión';
  end if;

  update public.hyperfocus_records
     set contacts = coalesce(p_patch->'contacts', contacts),
         status = coalesce(p_patch->>'status', status),
         attempts = coalesce((p_patch->>'attempts')::integer, attempts),
         last_contact_at = case when p_patch ? 'last_contact_at' then nullif(p_patch->>'last_contact_at','')::timestamptz else last_contact_at end,
         next_retry_at = case when p_patch ? 'next_retry_at' then nullif(p_patch->>'next_retry_at','')::timestamptz else next_retry_at end,
         outcome = coalesce(p_patch->>'outcome', outcome),
         discard_reason = coalesce(p_patch->>'discard_reason', discard_reason),
         remarketing_reason = coalesce(p_patch->>'remarketing_reason', remarketing_reason),
         notes = coalesce(p_patch->>'notes', notes),
         converted_lead_id = case when p_patch ? 'converted_lead_id' then nullif(p_patch->>'converted_lead_id','')::uuid else converted_lead_id end,
         existing_lead_id = case when p_patch ? 'existing_lead_id' then nullif(p_patch->>'existing_lead_id','')::uuid else existing_lead_id end,
         claimed_by = case when p_patch ? 'claimed_by' then nullif(p_patch->>'claimed_by','')::uuid else claimed_by end,
         claimed_at = case when p_patch ? 'claimed_at' then nullif(p_patch->>'claimed_at','')::timestamptz else claimed_at end,
         priority = coalesce((p_patch->>'priority')::integer, priority)
   where id = p_record_id
   returning * into v_record;

  insert into public.hyperfocus_interactions (
    id, campaign_id, record_id, created_by, contact_id, contact_snapshot,
    channel, contact_result, commercial_result, detail
  ) values (
    (p_interaction->>'id')::uuid,
    v_record.campaign_id,
    v_record.id,
    auth.uid(),
    coalesce(p_interaction->>'contact_id',''),
    coalesce(p_interaction->'contact_snapshot','{}'::jsonb),
    coalesce(p_interaction->>'channel',''),
    coalesce(p_interaction->>'contact_result',''),
    coalesce(p_interaction->>'commercial_result',''),
    coalesce(p_interaction->>'detail','')
  );

  return v_record;
end;
$$;

revoke all on function public.hyperfocus_finalize_record(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.hyperfocus_finalize_record(uuid, jsonb, jsonb) to authenticated;
