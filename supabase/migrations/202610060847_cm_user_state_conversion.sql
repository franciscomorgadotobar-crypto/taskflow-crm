-- Convenio Marco conversion now keeps state per user.
create or replace function public.chilecompra_convert_cm_order(p_order_code text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_order public.chilecompra_cm_orders%rowtype;
  v_state public.chilecompra_cm_states%rowtype;
  v_actor public.profiles%rowtype;
  v_lead_id uuid;
  v_notes text;
  v_items text;
begin
  if coalesce(internal.my_role() in ('super','admin','comercial'), false) is not true then
    raise exception 'No tienes permiso para convertir órdenes de Convenio Marco';
  end if;

  select * into v_order from public.chilecompra_cm_orders where code = p_order_code;
  if not found then raise exception 'Orden de Convenio Marco no encontrada'; end if;

  select * into v_state
  from public.chilecompra_cm_states
  where organization_id = internal.my_org()
    and profile_id = auth.uid()
    and order_code = p_order_code;

  if found and v_state.lead_id is not null then return v_state.lead_id; end if;

  select * into v_actor
  from public.profiles
  where id = auth.uid()
    and organization_id = internal.my_org()
    and active is true;
  if not found then raise exception 'Perfil activo no disponible'; end if;

  select string_agg(
    concat(
      coalesce(nullif(category,''), nullif(product_code,''), 'Ítem'),
      ': ',
      left(coalesce(nullif(supplier_spec,''), nullif(buyer_spec,''), 'Sin descripción'), 220),
      case when quantity is not null then concat(' · ', quantity, ' ', coalesce(unit,'')) else '' end,
      case when unit_price is not null then concat(' · precio unitario ', coalesce(currency,'CLP'), ' ', round(unit_price, 0)) else '' end
    ),
    E'\n'
    order by line_no
  )
  into v_items
  from public.chilecompra_cm_order_items
  where order_code = p_order_code;

  v_lead_id := gen_random_uuid();
  v_notes := concat(
    'Compra observada por Convenio Marco. OC: ', v_order.code,
    case when v_order.agreement_code <> '' then concat(E'\nConvenio: ', v_order.agreement_code) else '' end,
    case when v_order.supplier_name <> '' then concat(E'\nProveedor adjudicado: ', v_order.supplier_name) else '' end,
    case when v_order.total is not null then concat(E'\nMonto OC: ', v_order.currency, ' ', round(v_order.total,0)) else '' end,
    case when v_order.source_url <> '' then concat(E'\nFicha: ', v_order.source_url) else '' end,
    case when v_order.description <> '' then concat(E'\n\nDescripción: ', v_order.description) else '' end,
    case when coalesce(v_items,'') <> '' then concat(E'\n\nÍtems:\n', v_items) else '' end
  );

  insert into public.leads (
    id, organization_id, company, industry, source, stage, priority,
    probability, expected_close_date, next_action, next_date, next_type,
    owner_id, owner_name, notes, stage_history
  )
  values (
    v_lead_id, internal.my_org(),
    coalesce(nullif(v_order.buyer_name,''), nullif(v_order.buyer_unit,''), v_order.name),
    '', 'ChileCompra · Convenio Marco', 'Contactado', 'Media', 20, null,
    concat('Analizar recompra / abastecimiento de ', v_order.code),
    current_date, 'Llamada', auth.uid(),
    coalesce(nullif(v_actor.name,''), nullif(v_actor.email,''), 'Usuario'),
    v_notes, jsonb_build_array(jsonb_build_object('stage','Contactado','at',now()))
  );

  insert into public.chilecompra_cm_states (
    organization_id, profile_id, order_code, radar_state, lead_id, updated_by, updated_at
  )
  values (
    internal.my_org(), auth.uid(), p_order_code, 'crm', v_lead_id, auth.uid(), now()
  )
  on conflict (organization_id, profile_id, order_code)
  do update set radar_state='crm', lead_id=excluded.lead_id, updated_by=auth.uid(), updated_at=now();

  return v_lead_id;
end;
$$;
