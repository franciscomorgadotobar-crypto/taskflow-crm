-- 0017: actividad manual que resuelve una tarea pendiente.
--
-- Conserva los datos propios de una actividad ingresada manualmente (contacto,
-- responsable, tipo y fecha) y limpia la tarea del lead en la misma transacción.
-- SECURITY INVOKER mantiene RLS del usuario que ejecuta la operación.

create or replace function public.resolve_task_with_activity(
  p_lead_id uuid,
  p_activity_id uuid,
  p_contact_key text,
  p_type text,
  p_date timestamptz,
  p_owner_id uuid,
  p_owner_name text,
  p_detail text,
  p_task text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_lead public.leads%rowtype;
begin
  select *
    into v_lead
    from public.leads
   where id = p_lead_id
   for update;

  if not found then
    raise exception 'Lead no encontrado o sin acceso';
  end if;

  if nullif(btrim(coalesce(p_detail, '')), '') is null then
    raise exception 'El detalle de la actividad es obligatorio';
  end if;

  insert into public.activities (
    id, lead_id, contact_key, company, type, date, owner_id, owner_name,
    detail, task, system
  )
  values (
    p_activity_id,
    p_lead_id,
    coalesce(p_contact_key, ''),
    v_lead.company,
    coalesce(p_type, ''),
    coalesce(p_date, now()),
    p_owner_id,
    coalesce(p_owner_name, ''),
    p_detail,
    coalesce(p_task, ''),
    false
  );

  update public.leads
     set next_type = '',
         next_action = '',
         next_date = null
   where id = p_lead_id;
end;
$$;

revoke all on function public.resolve_task_with_activity(uuid, uuid, text, text, timestamptz, uuid, text, text, text)
  from public, anon;
grant execute on function public.resolve_task_with_activity(uuid, uuid, text, text, timestamptz, uuid, text, text, text)
  to authenticated;
