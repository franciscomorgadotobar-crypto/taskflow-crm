-- 0026: registrar actividades pasadas y, opcionalmente, actualizar el seguimiento
-- en una sola transacción.
--
-- Casos soportados:
-- 1) solo registrar una interacción histórica, sin tocar la tarea pendiente;
-- 2) registrar la interacción y resolver la tarea actual;
-- 3) registrar la interacción y definir el próximo paso.
--
-- SECURITY INVOKER mantiene las RLS de leads/activities. La función valida además
-- que el usuario pueda editar la oportunidad antes de realizar cualquier escritura.

create or replace function public.record_activity_with_followup(
  p_lead_id uuid,
  p_activity_id uuid,
  p_contact_key text,
  p_type text,
  p_date timestamptz,
  p_owner_id uuid,
  p_owner_name text,
  p_detail text,
  p_resolve_current_task boolean default false,
  p_set_followup boolean default false,
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
  v_closed_task text := '';
begin
  select *
    into v_lead
    from public.leads
   where id = p_lead_id
   for update;

  if not found then
    raise exception 'Lead no encontrado o sin acceso';
  end if;

  if not internal.can_edit_lead(p_lead_id) then
    raise exception 'No tienes permiso para registrar actividad en esta oportunidad';
  end if;

  if p_activity_id is null then
    raise exception 'El identificador de la actividad es obligatorio';
  end if;

  if nullif(btrim(coalesce(p_detail, '')), '') is null then
    raise exception 'El detalle de la actividad es obligatorio';
  end if;

  if p_date is null then
    raise exception 'La fecha de la actividad es obligatoria';
  end if;

  if p_owner_id is not null and not exists (
    select 1
      from public.profiles p
     where p.id = p_owner_id
       and p.organization_id = internal.my_org()
  ) then
    raise exception 'El responsable de la actividad no pertenece a esta organización';
  end if;

  if p_set_followup then
    if p_next_date is null then
      raise exception 'La siguiente tarea requiere fecha';
    end if;

    if nullif(btrim(coalesce(p_next_type, '')), '') is null
       and nullif(btrim(coalesce(p_next_action, '')), '') is null then
      raise exception 'La siguiente tarea requiere tipo o nota';
    end if;
  end if;

  if p_resolve_current_task then
    v_closed_task := concat_ws(
      ' · ',
      nullif(btrim(coalesce(v_lead.next_type, '')), ''),
      nullif(btrim(coalesce(v_lead.next_action, '')), '')
    );
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
    p_date,
    p_owner_id,
    coalesce(p_owner_name, ''),
    p_detail,
    coalesce(v_closed_task, ''),
    false
  );

  if p_set_followup then
    update public.leads
       set next_type = coalesce(p_next_type, ''),
           next_action = coalesce(p_next_action, ''),
           next_date = p_next_date
     where id = p_lead_id;
  elsif p_resolve_current_task then
    update public.leads
       set next_type = '',
           next_action = '',
           next_date = null
     where id = p_lead_id;
  end if;
end;
$$;

revoke all on function public.record_activity_with_followup(
  uuid, uuid, text, text, timestamptz, uuid, text, text,
  boolean, boolean, text, text, date
) from public, anon;

grant execute on function public.record_activity_with_followup(
  uuid, uuid, text, text, timestamptz, uuid, text, text,
  boolean, boolean, text, text, date
) to authenticated;
