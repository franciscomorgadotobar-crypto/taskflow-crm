-- 0025: alinear la conversión atómica con el historial de etapas del CRM.
--
-- Reemplaza la función de 0024 sin cambiar su contrato. Además de la atomicidad,
-- conserva dos invariantes que antes aplicaba upsertLeadConfirmed(): registrar cada
-- cambio de etapa en stage_history y limpiar loss_reason al salir de Perdido.

-- Definición completa de reemplazo basada en 0024.
--
-- El frontend hoy confirma primero lead/actividad y recién después llama
-- hyperfocus_finalize_record(). Si esa última operación falla, el CRM queda
-- adelantado respecto del registro Híper Foco. Esta RPC agrupa las tres escrituras:
-- lead, actividad CRM y cierre/interacción Híper Foco. Cualquier excepción revierte
-- toda la función.
--
-- La función es SECURITY DEFINER porque hyperfocus_finalize_record también lo es
-- para poder liberar el claim con RLS estricta. Por eso se validan explícitamente
-- organización, rol, ownership del lead y claim actual.

create or replace function public.hyperfocus_convert_record(
  p_record_id uuid,
  p_lead_id uuid,
  p_lead jsonb,
  p_activity jsonb,
  p_patch jsonb,
  p_interaction jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.hyperfocus_records%rowtype;
  v_existing public.leads%rowtype;
  v_final public.hyperfocus_records%rowtype;
  v_actor_name text;
  v_created boolean := false;
  v_activity_id uuid;
  v_activity public.activities%rowtype;
begin
  if coalesce(internal.my_role() in ('super','admin','comercial'), false) is not true then
    raise exception 'No tienes permiso para gestionar Híper Foco';
  end if;

  if p_lead_id is null then
    raise exception 'El identificador del lead es obligatorio';
  end if;

  select *
    into v_record
    from public.hyperfocus_records
   where id = p_record_id
     and organization_id = internal.my_org()
     and claimed_by = auth.uid()
   for update;

  if not found then
    raise exception 'Este registro ya no está reservado para tu sesión';
  end if;

  -- Si la importación ya dejó un vínculo explícito al CRM, ese vínculo manda.
  -- Evita crear un duplicado si el snapshot local del navegador está desactualizado
  -- o no contiene temporalmente el lead enlazado.
  if coalesce(v_record.converted_lead_id, v_record.existing_lead_id) is not null
     and p_lead_id is distinct from coalesce(v_record.converted_lead_id, v_record.existing_lead_id) then
    raise exception 'El registro Híper Foco ya está vinculado a otra oportunidad';
  end if;

  select coalesce(nullif(name, ''), nullif(email, ''), 'Usuario')
    into v_actor_name
    from public.profiles
   where id = auth.uid()
     and organization_id = v_record.organization_id
     and active is true;

  if v_actor_name is null then
    raise exception 'Perfil activo no disponible';
  end if;

  select *
    into v_existing
    from public.leads
   where id = p_lead_id
   for update;

  if found then
    if v_existing.organization_id is distinct from v_record.organization_id then
      raise exception 'El lead pertenece a otra organización';
    end if;

    if not internal.can_edit_lead(v_existing.id) then
      raise exception 'No tienes permiso para modificar esta oportunidad';
    end if;

    -- En un lead existente solo se actualizan los mismos campos que modifica
    -- createOrUpdateCrmLead() en el frontend. Owner, privacidad, notas históricas,
    -- contacto principal y valor permanecen intactos.
    update public.leads
       set industry = coalesce(nullif(p_lead->>'industry',''), industry),
           rut = coalesce(nullif(p_lead->>'rut',''), rut),
           source = coalesce(nullif(p_lead->>'source',''), source),
           stage_history = case
             when nullif(p_lead->>'stage','') is not null
                  and (p_lead->>'stage') is distinct from stage
               then coalesce(stage_history, '[]'::jsonb)
                    || jsonb_build_array(jsonb_build_object('stage', p_lead->>'stage', 'at', now()))
             else stage_history
           end,
           stage = coalesce(nullif(p_lead->>'stage',''), stage),
           loss_reason = case
             when coalesce(nullif(p_lead->>'stage',''), stage) <> 'Perdido' then ''
             else loss_reason
           end,
           probability = case
             when p_lead ? 'probability' then coalesce((p_lead->>'probability')::numeric, probability)
             else probability
           end,
           next_type = case when p_lead ? 'next_type' then coalesce(p_lead->>'next_type','') else next_type end,
           next_action = case when p_lead ? 'next_action' then coalesce(p_lead->>'next_action','') else next_action end,
           next_date = case
             when p_lead ? 'next_date' and nullif(p_lead->>'next_date','') is not null
               then (p_lead->>'next_date')::date
             when p_lead ? 'next_date' then null
             else next_date
           end,
           contacts = case when p_lead ? 'contacts' then coalesce(p_lead->'contacts','[]'::jsonb) else contacts end,
           remarketing_reason = case
             when p_lead ? 'remarketing_reason' then coalesce(p_lead->>'remarketing_reason','')
             else remarketing_reason
           end
     where id = v_existing.id;
  else
    v_created := true;

    insert into public.leads (
      id, organization_id, company, rut, industry, source,
      contact, role, email, phone, stage, priority, value, probability,
      expected_close_date, next_action, next_date, next_type,
      owner_id, owner_name, loss_reason, remarketing_reason,
      is_private, notes, stage_history, contacts
    )
    values (
      p_lead_id,
      v_record.organization_id,
      v_record.company,
      coalesce(p_lead->>'rut', v_record.rut, ''),
      coalesce(p_lead->>'industry', v_record.industry, ''),
      coalesce(nullif(p_lead->>'source',''), 'Base de datos'),
      coalesce(p_lead->>'contact',''),
      coalesce(p_lead->>'role',''),
      coalesce(p_lead->>'email',''),
      coalesce(p_lead->>'phone',''),
      coalesce(nullif(p_lead->>'stage',''), 'Contactado'),
      coalesce(nullif(p_lead->>'priority',''), 'Media'),
      coalesce((p_lead->>'value')::numeric, 0),
      coalesce((p_lead->>'probability')::numeric, 15),
      case when nullif(p_lead->>'expected_close_date','') is not null then (p_lead->>'expected_close_date')::date else null end,
      coalesce(p_lead->>'next_action',''),
      case when nullif(p_lead->>'next_date','') is not null then (p_lead->>'next_date')::date else null end,
      coalesce(p_lead->>'next_type',''),
      auth.uid(),
      v_actor_name,
      coalesce(p_lead->>'loss_reason',''),
      coalesce(p_lead->>'remarketing_reason',''),
      false,
      coalesce(p_lead->>'notes',''),
      case
        when p_lead ? 'stage_history' then coalesce(p_lead->'stage_history','[]'::jsonb)
        else jsonb_build_array(
          jsonb_build_object(
            'stage', coalesce(nullif(p_lead->>'stage',''), 'Contactado'),
            'at', now()
          )
        )
      end,
      coalesce(p_lead->'contacts','[]'::jsonb)
    );
  end if;

  -- La actividad usa una PK determinista por registro Híper Foco. Si existe por
  -- una ejecución histórica anterior a 0024, solo se acepta si corresponde al mismo
  -- lead y organización; en ese caso se reutiliza sin duplicar.
  v_activity_id := nullif(p_activity->>'id','')::uuid;

  if v_activity_id is null then
    raise exception 'El identificador de la actividad es obligatorio';
  end if;

  select *
    into v_activity
    from public.activities
   where id = v_activity_id;

  if found then
    if v_activity.lead_id is distinct from p_lead_id
       or v_activity.organization_id is distinct from v_record.organization_id then
      raise exception 'La actividad determinista ya pertenece a otra oportunidad';
    end if;
  else
    insert into public.activities (
      id, organization_id, lead_id, contact_key, company, type, date,
      owner_id, owner_name, detail, task, system
    )
    values (
      v_activity_id,
      v_record.organization_id,
      p_lead_id,
      coalesce(p_activity->>'contact_key',''),
      v_record.company,
      coalesce(p_activity->>'type',''),
      case
        when nullif(p_activity->>'date','') is not null then (p_activity->>'date')::timestamptz
        else now()
      end,
      auth.uid(),
      v_actor_name,
      coalesce(p_activity->>'detail',''),
      '',
      false
    );
  end if;

  -- Se fuerza el vínculo al lead creado/actualizado. campaign_id, organization_id
  -- y transferencia de claim siguen protegidos por 0022/0023.
  select *
    into v_final
    from public.hyperfocus_finalize_record(
      p_record_id,
      coalesce(p_patch, '{}'::jsonb)
        || jsonb_build_object(
             'converted_lead_id', p_lead_id,
             'existing_lead_id', p_lead_id
           ),
      coalesce(p_interaction, '{}'::jsonb)
    );

  return jsonb_build_object(
    'lead_id', p_lead_id,
    'lead_created', v_created,
    'record_id', v_final.id,
    'status', v_final.status
  );
end;
$$;

revoke all on function public.hyperfocus_convert_record(uuid, uuid, jsonb, jsonb, jsonb, jsonb)
  from public, anon;
grant execute on function public.hyperfocus_convert_record(uuid, uuid, jsonb, jsonb, jsonb, jsonb)
  to authenticated;
