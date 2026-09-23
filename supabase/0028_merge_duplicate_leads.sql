-- 0028: fusion transaccional de oportunidades duplicadas.
--
-- La oportunidad destino conserva su estado operativo (etapa, valor, tarea,
-- responsable y privacidad). La fuente aporta datos faltantes y sus relaciones
-- se trasladan al destino antes de eliminarla.
--
-- Relaciones preservadas:
--   * actividades
--   * levantamiento (si ambos tienen, completa solo campos vacios del destino)
--   * cotizaciones y sus versiones/items
--   * referencias Hiper Foco
--   * contactos adicionales, deduplicados por email/telefono
--
-- La funcion exige permiso de edicion sobre AMBAS oportunidades y misma
-- organizacion. Todo ocurre en una sola transaccion.

create or replace function public.merge_duplicate_leads(
  p_target_id uuid,
  p_source_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.leads%rowtype;
  v_source public.leads%rowtype;
  v_actor_name text;

  v_contacts jsonb;
  v_candidates jsonb;
  v_contact jsonb;
  v_email text;
  v_phone text;
  v_name text;
  v_primary_email text;
  v_primary_phone text;
  v_primary_name text;
  v_exists boolean;

  v_target_discovery boolean := false;
  v_source_discovery boolean := false;

  v_activities integer := 0;
  v_quotes integer := 0;
  v_hf_existing integer := 0;
  v_hf_converted integer := 0;
begin
  if p_target_id is null or p_source_id is null then
    raise exception 'Debes indicar oportunidad destino y fuente'
      using errcode = '22023';
  end if;

  if p_target_id = p_source_id then
    raise exception 'La oportunidad destino y la fuente deben ser distintas'
      using errcode = '22023';
  end if;

  if coalesce(internal.my_role() in ('super','admin','comercial'), false) is not true then
    raise exception 'No tienes permiso para fusionar oportunidades'
      using errcode = '42501';
  end if;

  -- Bloqueo determinista para evitar carreras o deadlocks entre fusiones opuestas.
  perform 1
    from public.leads
   where id in (p_target_id, p_source_id)
   order by id
   for update;

  select *
    into v_target
    from public.leads
   where id = p_target_id
     and organization_id = internal.my_org();

  if not found then
    raise exception 'Oportunidad destino no encontrada'
      using errcode = 'P0002';
  end if;

  select *
    into v_source
    from public.leads
   where id = p_source_id
     and organization_id = internal.my_org();

  if not found then
    raise exception 'Oportunidad fuente no encontrada'
      using errcode = 'P0002';
  end if;

  if v_target.organization_id is distinct from v_source.organization_id then
    raise exception 'Las oportunidades pertenecen a organizaciones distintas'
      using errcode = '42501';
  end if;

  if not internal.can_edit_lead(v_target.id) then
    raise exception 'No tienes permiso para modificar la oportunidad destino'
      using errcode = '42501';
  end if;

  if not internal.can_edit_lead(v_source.id) then
    raise exception 'No tienes permiso para modificar la oportunidad duplicada'
      using errcode = '42501';
  end if;

  select coalesce(nullif(name, ''), nullif(email, ''), 'Usuario')
    into v_actor_name
    from public.profiles
   where id = auth.uid()
     and organization_id = v_target.organization_id
     and active is true;

  if v_actor_name is null then
    raise exception 'Perfil activo no disponible'
      using errcode = '42501';
  end if;

  -- Contacto principal final: destino manda; la fuente solo completa vacios.
  v_primary_email := lower(trim(coalesce(nullif(v_target.email, ''), v_source.email, '')));
  v_primary_phone := regexp_replace(coalesce(nullif(v_target.phone, ''), v_source.phone, ''), '[^0-9]', '', 'g');
  v_primary_name := lower(trim(coalesce(nullif(v_target.contact, ''), v_source.contact, '')));

  v_contacts := coalesce(v_target.contacts, '[]'::jsonb);
  v_candidates := coalesce(v_source.contacts, '[]'::jsonb);

  if coalesce(v_source.contact, '') <> ''
     or coalesce(v_source.email, '') <> ''
     or coalesce(v_source.phone, '') <> '' then
    v_candidates :=
      jsonb_build_array(
        jsonb_build_object(
          'name', coalesce(v_source.contact, ''),
          'role', coalesce(v_source.role, ''),
          'email', coalesce(v_source.email, ''),
          'phone', coalesce(v_source.phone, '')
        )
      ) || v_candidates;
  end if;

  for v_contact in
    select value from jsonb_array_elements(v_candidates)
  loop
    v_email := lower(trim(coalesce(v_contact->>'email', '')));
    v_phone := regexp_replace(coalesce(v_contact->>'phone', ''), '[^0-9]', '', 'g');
    v_name := lower(trim(coalesce(v_contact->>'name', '')));

    -- Ignora candidatos totalmente vacios.
    if v_email = '' and v_phone = '' and v_name = '' then
      continue;
    end if;

    -- Evita duplicar el contacto principal resultante.
    v_exists :=
      (v_email <> '' and v_email = v_primary_email)
      or
      (v_phone <> '' and v_phone = v_primary_phone)
      or
      (v_email = '' and v_phone = '' and v_name <> '' and v_name = v_primary_name);

    if not v_exists then
      select exists (
        select 1
          from jsonb_array_elements(v_contacts) as current_contact(value)
         where
           (
             v_email <> ''
             and lower(trim(coalesce(value->>'email', ''))) = v_email
           )
           or
           (
             v_phone <> ''
             and regexp_replace(coalesce(value->>'phone', ''), '[^0-9]', '', 'g') = v_phone
           )
           or
           (
             v_email = ''
             and v_phone = ''
             and v_name <> ''
             and lower(trim(coalesce(value->>'name', ''))) = v_name
           )
      )
      into v_exists;
    end if;

    if not v_exists then
      if coalesce(v_contact->>'id', '') = '' then
        v_contact := v_contact || jsonb_build_object('id', gen_random_uuid()::text);
      end if;
      v_contacts := v_contacts || jsonb_build_array(v_contact);
    end if;
  end loop;

  update public.leads
     set rut = coalesce(nullif(v_target.rut, ''), v_source.rut, ''),
         industry = coalesce(nullif(v_target.industry, ''), v_source.industry, ''),
         source = coalesce(nullif(v_target.source, ''), v_source.source, ''),
         contact = coalesce(nullif(v_target.contact, ''), v_source.contact, ''),
         role = coalesce(nullif(v_target.role, ''), v_source.role, ''),
         email = coalesce(nullif(v_target.email, ''), v_source.email, ''),
         phone = coalesce(nullif(v_target.phone, ''), v_source.phone, ''),
         priority = coalesce(nullif(v_target.priority, ''), v_source.priority, ''),
         expected_close_date = coalesce(v_target.expected_close_date, v_source.expected_close_date),
         notes = case
           when coalesce(v_source.notes, '') = '' then v_target.notes
           when coalesce(v_target.notes, '') = '' then v_source.notes
           when position(v_source.notes in v_target.notes) > 0 then v_target.notes
           else v_target.notes
             || E'\n\n[Fusionado desde '
             || v_source.company
             || E']\n'
             || v_source.notes
         end,
         contacts = v_contacts
   where id = v_target.id;

  select exists(select 1 from public.discoveries where lead_id = v_target.id)
    into v_target_discovery;
  select exists(select 1 from public.discoveries where lead_id = v_source.id)
    into v_source_discovery;

  if v_source_discovery then
    if v_target_discovery then
      update public.discoveries as target
         set pain = coalesce(nullif(target.pain, ''), source.pain, ''),
             current_management = coalesce(nullif(target.current_management, ''), source.current_management, ''),
             technicians = coalesce(nullif(target.technicians, ''), source.technicians, ''),
             locations = coalesce(nullif(target.locations, ''), source.locations, ''),
             buy_trigger = coalesce(nullif(target.buy_trigger, ''), source.buy_trigger, ''),
             integrations = coalesce(nullif(target.integrations, ''), source.integrations, ''),
             success_criteria = coalesce(nullif(target.success_criteria, ''), source.success_criteria, ''),
             technical_notes = coalesce(nullif(target.technical_notes, ''), source.technical_notes, ''),
             modules = (
               select coalesce(array_agg(distinct module_name order by module_name), '{}'::text[])
                 from unnest(coalesce(target.modules, '{}'::text[]) || coalesce(source.modules, '{}'::text[]))
                   as module_name
             )
        from public.discoveries as source
       where target.lead_id = v_target.id
         and source.lead_id = v_source.id;

      delete from public.discoveries where lead_id = v_source.id;
    else
      update public.discoveries
         set lead_id = v_target.id
       where lead_id = v_source.id;
    end if;
  end if;

  update public.activities
     set lead_id = v_target.id
   where lead_id = v_source.id;
  get diagnostics v_activities = row_count;

  update public.quotes
     set lead_id = v_target.id
   where lead_id = v_source.id;
  get diagnostics v_quotes = row_count;

  update public.hyperfocus_records
     set existing_lead_id = v_target.id
   where existing_lead_id = v_source.id;
  get diagnostics v_hf_existing = row_count;

  update public.hyperfocus_records
     set converted_lead_id = v_target.id
   where converted_lead_id = v_source.id;
  get diagnostics v_hf_converted = row_count;

  insert into public.activities (
    organization_id,
    lead_id,
    company,
    type,
    date,
    owner_id,
    owner_name,
    detail,
    task,
    system
  )
  values (
    v_target.organization_id,
    v_target.id,
    v_target.company,
    'Fusion',
    now(),
    auth.uid(),
    v_actor_name,
    v_actor_name
      || ' fusiono la oportunidad "'
      || v_source.company
      || '" dentro de "'
      || v_target.company
      || '". Se conservaron las relaciones y el registro fuente fue eliminado.',
    '',
    true
  );

  delete from public.leads where id = v_source.id;

  return jsonb_build_object(
    'target_id', v_target.id,
    'source_id', v_source.id,
    'target_company', v_target.company,
    'source_company', v_source.company,
    'activities_moved', v_activities,
    'quotes_moved', v_quotes,
    'hyperfocus_links_moved', v_hf_existing + v_hf_converted,
    'discovery_moved', v_source_discovery
  );
end;
$$;

revoke all on function public.merge_duplicate_leads(uuid, uuid) from public, anon;
grant execute on function public.merge_duplicate_leads(uuid, uuid) to authenticated, service_role;
