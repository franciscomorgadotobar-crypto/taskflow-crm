-- 0010: cierre transaccional de tareas.
--
-- Registra la actividad y actualiza el próximo paso del lead dentro de una sola
-- transacción Postgres. La función usa SECURITY INVOKER: conserva las políticas RLS
-- del usuario que la llama y no eleva privilegios.

create or replace function public.complete_task(
  p_lead_id uuid,
  p_activity_id uuid,
  p_type text,
  p_date timestamptz,
  p_result text,
  p_task text,
  p_next_type text default '',
  p_next_action text default '',
  p_next_date date default null
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

  if nullif(btrim(coalesce(p_result, '')), '') is null then
    raise exception 'El resultado de la gestión es obligatorio';
  end if;

  if p_next_date is not null
     and nullif(btrim(coalesce(p_next_type, '')), '') is null
     and nullif(btrim(coalesce(p_next_action, '')), '') is null then
    raise exception 'La siguiente tarea requiere tipo o nota';
  end if;

  if (nullif(btrim(coalesce(p_next_type, '')), '') is not null
      or nullif(btrim(coalesce(p_next_action, '')), '') is not null)
     and p_next_date is null then
    raise exception 'La siguiente tarea requiere fecha';
  end if;

  insert into public.activities (
    id, lead_id, company, type, date, owner_id, owner_name,
    detail, task, system
  )
  values (
    p_activity_id,
    p_lead_id,
    v_lead.company,
    coalesce(p_type, ''),
    coalesce(p_date, now()),
    v_lead.owner_id,
    v_lead.owner_name,
    p_result,
    coalesce(p_task, ''),
    false
  );

  update public.leads
     set next_type = coalesce(p_next_type, ''),
         next_action = coalesce(p_next_action, ''),
         next_date = p_next_date
   where id = p_lead_id;
end;
$$;

revoke all on function public.complete_task(uuid, uuid, text, timestamptz, text, text, text, text, date)
  from public, anon;
grant execute on function public.complete_task(uuid, uuid, text, timestamptz, text, text, text, text, date)
  to authenticated;
