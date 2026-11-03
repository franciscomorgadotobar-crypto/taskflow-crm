-- Alcance comercial editable por servicio, congelado al emitir nuevas versiones.
-- El catálogo original conserva precios, moneda y códigos.
begin;
alter table public.price_list_items
  add column if not exists description text not null default '';
alter table public.quote_items
  add column if not exists description text not null default '';

-- Carga inicial de capacidades desde la matriz de planes suministrada.
-- El plan Full tiene ítems ilimitados desde 10.000 (reemplaza la cifra 15.000 de la matriz).
update public.price_list_items
set description = case code
      WHEN 'INV_ENTRADA' THEN 'Hasta 200 ítems de inventario
1 usuario incluido
1 almacén
Equipos seriados: no incluidos
Almacenamiento: 0,5 GB
Almacenes flotantes habilitados'
      WHEN 'INV_BASICO' THEN 'Hasta 500 ítems de inventario
2 usuarios incluidos
2 almacenes
Hasta 250 equipos seriados
Almacenamiento: 2 GB
Almacenes flotantes y gestión de activos incluidos'
      WHEN 'INV_MEDIO' THEN 'Hasta 1.000 ítems de inventario
5 usuarios incluidos
3 almacenes
Hasta 1.000 equipos seriados
Almacenamiento: 5 GB
Almacenes flotantes y gestión de activos incluidos'
      WHEN 'INV_AVANZADO' THEN 'Hasta 3.500 ítems de inventario
12 usuarios incluidos
6 almacenes
Hasta 2.500 equipos seriados
Almacenamiento: 10 GB
Almacenes flotantes, gestión de activos, valorización y depreciación incluidos'
      WHEN 'INV_FULL' THEN 'Ítems de inventario ilimitados desde 10.000
Hasta 9.999 usuarios
15 almacenes
Hasta 20.000 equipos seriados
Almacenamiento: 15 GB
Almacenes flotantes, gestión de activos, valorización y depreciación incluidos'
      else description
    end
where code in ('INV_ENTRADA', 'INV_BASICO', 'INV_MEDIO', 'INV_AVANZADO', 'INV_FULL')
  and coalesce(btrim(description),'') = '';

CREATE OR REPLACE FUNCTION public.import_price_list(p_name text, p_currency text, p_items jsonb, p_source_file text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_id uuid := gen_random_uuid();
  v_x jsonb;
  v_ord bigint;
  v_per text;
  v_dup text;
begin
  if not internal.can_manage_all() then
    raise exception 'Solo un administrador puede cargar listas de precios';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'La lista necesita un nombre';
  end if;
  if coalesce(p_currency, '') not in ('UF','CLP','USD') then
    raise exception 'Moneda no válida';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El archivo no trae servicios';
  end if;
  if exists (
    select 1 from public.price_lists
     where organization_id = internal.my_org()
       and lower(btrim(name)) = lower(btrim(p_name))
  ) then
    raise exception 'Ya existe una lista llamada "%"', btrim(p_name);
  end if;

  for v_x, v_ord in
    select t.e, t.o from jsonb_array_elements(p_items) with ordinality as t(e, o)
  loop
    if nullif(btrim(coalesce(v_x->>'code', '')), '') is null then
      raise exception 'Fila %: falta el código', v_ord;
    end if;
    if nullif(btrim(coalesce(v_x->>'name', '')), '') is null then
      raise exception 'Fila %: falta el nombre', v_ord;
    end if;
    if coalesce(v_x->>'price', '') !~ '^[0-9]+(\.[0-9]+)?$' then
      raise exception 'Fila %: precio no válido', v_ord;
    end if;
    v_per := lower(btrim(coalesce(v_x->>'periodicity', '')));
    if v_per not in ('unico','único','mensual') then
      raise exception 'Fila %: periodicidad no válida (use Único o Mensual)', v_ord;
    end if;
    if v_x ? 'active' and jsonb_typeof(v_x->'active') <> 'boolean' then
      raise exception 'Fila %: el campo activo debe ser sí o no', v_ord;
    end if;
  end loop;

  select btrim(t.e->>'code') into v_dup
    from jsonb_array_elements(p_items) as t(e)
   group by btrim(t.e->>'code')
  having count(*) > 1
   limit 1;
  if v_dup is not null then
    raise exception 'Código repetido en el archivo: %', v_dup;
  end if;

  insert into public.price_lists (id, name, currency, source_file)
  values (v_id, btrim(p_name), p_currency, coalesce(p_source_file, ''));

  insert into public.price_list_items (price_list_id, code, name, description, price, periodicity, category, active, position)
  select
    v_id,
    btrim(t.e->>'code'),
    btrim(t.e->>'name'),
    left(btrim(coalesce(t.e->>'description','')), 1500),
    (t.e->>'price')::numeric,
    case when lower(btrim(t.e->>'periodicity')) = 'mensual' then 'mensual' else 'unico' end,
    btrim(coalesce(t.e->>'category', '')),
    coalesce((t.e->>'active')::boolean, true),
    (t.o - 1)::integer
  from jsonb_array_elements(p_items) with ordinality as t(e, o);

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_quote(p_quote jsonb, p_items jsonb DEFAULT '[]'::jsonb, p_discounts jsonb DEFAULT '[]'::jsonb, p_base_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_org uuid := internal.my_org();
  v_base public.quotes%rowtype;
  v_id uuid := gen_random_uuid();
  v_root uuid;
  v_version integer := 1;
  v_number text;
  v_lead uuid;
  v_owner uuid;
  v_owner_name text := '';
  v_seller_name text := nullif(btrim(coalesce(p_quote->>'seller_name', '')), '');
  v_currency text := nullif(p_quote->>'currency', '');
  v_quote_date date := coalesce(nullif(p_quote->>'quote_date', '')::date, current_date);
  v_valid_until date := nullif(p_quote->>'valid_until', '')::date;
  v_months integer := nullif(p_quote->>'contract_months', '')::integer;
  v_payment_method text := nullif(p_quote->>'payment_method', '');
  v_payment_terms text := nullif(p_quote->>'payment_terms', '');
  v_status text := coalesce(nullif(p_quote->>'status', ''), 'borrador');
  v_uf numeric := nullif(p_quote->>'uf_value', '')::numeric;
  v_usd numeric := nullif(p_quote->>'usd_value', '')::numeric;
  v_price_list uuid := nullif(p_quote->>'price_list_id', '')::uuid;
  v_iva_rate numeric := 0.19;
  v_absorb boolean := coalesce((p_quote->>'absorb_iva')::boolean, false);
  v_result jsonb;
  v_lines jsonb;
  v_calc jsonb;
  v_line jsonb;
  v_calc_line jsonb;
  v_ord bigint;
  v_item_id uuid;
  v_ids jsonb := '{}'::jsonb;
begin
  if v_uid is null or v_org is null
     or coalesce(internal.my_role() in ('super','admin','comercial'), false) is not true then
    raise exception 'No tienes permiso para guardar cotizaciones';
  end if;
  if v_payment_method is null or v_payment_method not in ('transferencia','pac','pat') then
    raise exception 'Selecciona la forma de pago';
  end if;
  if v_payment_terms is null or v_payment_terms not in ('5_dias_habiles','30_dias','60_dias') then
    raise exception 'Selecciona la condición de pago';
  end if;
  if v_valid_until is not null and v_valid_until < v_quote_date then
    raise exception 'El vencimiento no puede ser anterior a la fecha de la cotización';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agrega al menos una línea de servicio';
  end if;

  if p_base_id is not null then
    select * into v_base
      from public.quotes
     where id = p_base_id
       and organization_id = v_org
     for update;
    if not found then
      raise exception 'Cotización base no encontrada o sin acceso';
    end if;
    if not v_base.is_current then
      raise exception 'Solo se puede editar la versión vigente';
    end if;
    if (v_base.lead_id is not null and not internal.can_edit_lead(v_base.lead_id))
       or not (internal.can_manage_all() or v_base.owner_id = v_uid) then
      raise exception 'No tienes permiso para editar esta cotización';
    end if;
    v_lead := v_base.lead_id;
    v_owner := v_base.owner_id;
    v_root := coalesce(v_base.root_id, v_base.id);
    select max(q.version) + 1 into v_version
      from public.quotes q
     where coalesce(q.root_id, q.id) = v_root;
    v_number := v_base.number;
  else
    v_lead := nullif(p_quote->>'lead_id', '')::uuid;
    if v_lead is not null and not internal.can_edit_lead(v_lead) then
      raise exception 'Oportunidad no encontrada o sin permiso de edición';
    end if;
    v_owner := v_uid;
  end if;

  -- Las cotizaciones externas no requieren un lead, pero sí una empresa identificable.
  if v_lead is null and btrim(coalesce(p_quote->'client_snapshot'->>'company', '')) = '' then
    raise exception 'Ingresa el nombre o razón social de la empresa';
  end if;

  if v_absorb and v_currency <> 'USD' then
    raise exception 'La absorción de IVA solo se permite al cotizar en USD';
  end if;

  v_lines := internal.quote_resolve_lines_usd(v_price_list, v_currency, v_uf, v_usd, p_items);
  v_calc := internal.quote_compute(v_currency, v_iva_rate, v_months, v_lines, coalesce(p_discounts, '[]'::jsonb));
  if v_absorb then
    v_result := internal.quote_absorb_result(v_calc, v_lines);
    v_calc := v_result - 'items';
    v_lines := v_result->'items';
    v_iva_rate := 0;
  end if;

  if v_number is null then
    v_number := internal.next_quote_number(v_org, v_quote_date);
  end if;
  if p_base_id is not null then
    update public.quotes set is_current = false where id = p_base_id;
  end if;

  select coalesce(nullif(p.name, ''), p.email, '') into v_owner_name
    from public.profiles p
   where p.id = v_owner;

  -- El vendedor impreso es independiente del dueño interno de la cotización.
  v_seller_name := coalesce(
    v_seller_name,
    case when p_base_id is not null then nullif(btrim(v_base.seller_name), '') else null end,
    nullif(btrim(v_owner_name), ''),
    'Vendedor no indicado'
  );
  if char_length(v_seller_name) > 120 then
    raise exception 'El nombre del vendedor no puede superar 120 caracteres';
  end if;

  insert into public.quotes (
    absorb_iva, id, root_id, version, is_current, lead_id, owner_id, owner_name, seller_name, status,
    client_snapshot, subtotal_neto, iva, total, notes, valid_until, organization_id,
    number, price_list_id, currency, uf_value, uf_date, usd_value, usd_date, quote_date, contract_months,
    payment_method, payment_terms, iva_rate, totals
  ) values (
    v_absorb, v_id, v_root, v_version, true, v_lead, v_owner, coalesce(v_owner_name, ''), v_seller_name, v_status,
    coalesce(p_quote->'client_snapshot', '{}'::jsonb),
    (v_calc->'contract'->>'net')::numeric,
    (v_calc->'contract'->>'iva')::numeric,
    (v_calc->'contract'->>'total')::numeric,
    coalesce(p_quote->>'notes', ''), v_valid_until, v_org,
    v_number, v_price_list, v_currency, v_uf, nullif(p_quote->>'uf_date', '')::date,
    v_usd, nullif(p_quote->>'usd_date', '')::date,
    v_quote_date, v_months, v_payment_method, v_payment_terms, v_iva_rate,
    v_calc - 'lines'
  );

  for v_line, v_ord in
    select t.e, t.o from jsonb_array_elements(v_lines) with ordinality as t(e, o)
  loop
    select c.value into v_calc_line
      from jsonb_array_elements(v_calc->'lines') as c(value)
     where c.value->>'ref' = v_line->>'ref';

    v_item_id := gen_random_uuid();
    insert into public.quote_items (
      id, quote_id, price_list_item_id, code, name, description, unit, quantity, unit_price,
      subtotal, discount, total, discount_months, periodicity, list_price, list_currency, position
    ) values (
      v_item_id, v_id, (v_line->>'price_list_item_id')::uuid, v_line->>'code', v_line->>'name',
      coalesce((select item.description from public.price_list_items item
                 where item.id=(v_line->>'price_list_item_id')::uuid),''), 'unidad',
      (v_line->>'quantity')::numeric, (v_line->>'unit_price')::numeric,
      (v_calc_line->>'subtotal')::numeric, (v_calc_line->>'discount')::numeric,
      (v_calc_line->>'total')::numeric, (v_calc_line->>'discount_months')::integer,
      v_line->>'periodicity', (v_line->>'list_price')::numeric, v_line->>'list_currency',
      (v_ord - 1)::integer
    );
    v_ids := v_ids || jsonb_build_object(v_line->>'ref', v_item_id);
  end loop;

  insert into public.quote_discounts (quote_id, position, scope, quote_item_id, kind, value, months)
  select
    v_id,
    (t.o - 1)::integer,
    t.d->>'scope',
    case when t.d->>'scope' = 'line' then (v_ids->>(t.d->>'item_ref'))::uuid end,
    t.d->>'kind',
    case when t.d->>'kind' = 'free' then 0 else coalesce(nullif(t.d->>'value', '')::numeric, 0) end,
    nullif(t.d->>'months', '')::integer
  from jsonb_array_elements(coalesce(p_discounts, '[]'::jsonb)) with ordinality as t(d, o);

  return jsonb_build_object(
    'id', v_id,
    'root_id', coalesce(v_root, v_id),
    'version', v_version,
    'number', v_number,
    'totals', v_calc
  );
end;
$function$;

commit;
