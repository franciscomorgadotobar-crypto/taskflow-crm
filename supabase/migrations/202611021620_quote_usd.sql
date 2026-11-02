-- USD y conversion cruzada. Cada version conserva el dolar (CLP por USD).
begin;
alter table public.price_lists drop constraint if exists price_lists_currency_check;
alter table public.price_lists add constraint price_lists_currency_check check (currency in ('UF','CLP','USD'));
alter table public.quotes drop constraint if exists quotes_currency_check;
alter table public.quotes add constraint quotes_currency_check check (currency in ('UF','CLP','USD'));
alter table public.quote_items drop constraint if exists quote_items_list_currency_check;
alter table public.quote_items add constraint quote_items_list_currency_check check (list_currency in ('UF','CLP','USD'));
alter table public.quotes add column if not exists usd_value numeric check (usd_value is null or usd_value > 0);
alter table public.quotes add column if not exists usd_date date;

CREATE OR REPLACE FUNCTION internal.quote_compute(p_currency text, p_iva_rate numeric, p_contract_months integer, p_lines jsonb, p_discounts jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v_prec integer := case when p_currency = 'CLP' then 0 else 2 end;
  v_n integer;
  v_nd integer;
  l_ref text[] := '{}';
  l_per text[] := '{}';
  l_qty numeric[] := '{}';
  l_gross numeric[] := '{}';
  l_disc numeric[] := '{}';
  l_dmonths integer[] := '{}';
  d_scope text[] := '{}';
  d_kind text[] := '{}';
  d_val numeric[] := '{}';
  d_months integer[] := '{}';
  d_idx integer[] := '{}';
  v_cur numeric[];
  v_x jsonb;
  v_ref text;
  v_price numeric;
  v_block text;
  v_pass integer;
  v_total numeric;
  v_dt numeric;
  v_share numeric;
  v_sum numeric;
  v_anchor integer;
  v_sub numeric;
  v_net numeric;
  v_iva numeric;
  v_obj jsonb;
  v_setup jsonb;
  v_first jsonb;
  v_proj jsonb := '[]'::jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_contract numeric := 0;
  i integer;
  j integer;
  k integer;
begin
  if p_currency is null or p_currency not in ('UF','CLP','USD') then
    raise exception 'Moneda no válida';
  end if;
  if p_contract_months is null or p_contract_months < 1 or p_contract_months > 120 then
    raise exception 'Los meses de contrato deben estar entre 1 y 120';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_discounts, '[]'::jsonb)) <> 'array' then
    raise exception 'Formato de líneas o descuentos no válido';
  end if;

  v_n := jsonb_array_length(coalesce(p_lines, '[]'::jsonb));
  v_nd := jsonb_array_length(coalesce(p_discounts, '[]'::jsonb));

  for i in 1..v_n loop
    v_x := p_lines -> (i - 1);
    v_ref := nullif(btrim(coalesce(v_x->>'ref', '')), '');
    if v_ref is null then
      raise exception 'Cada línea necesita una referencia';
    end if;
    if v_ref = any(l_ref) then
      raise exception 'Referencia de línea duplicada: %', v_ref;
    end if;
    l_ref[i] := v_ref;
    l_per[i] := v_x->>'periodicity';
    if l_per[i] is null or l_per[i] not in ('unico','mensual') then
      raise exception 'Periodicidad no válida en la línea %', i;
    end if;
    l_qty[i] := nullif(v_x->>'quantity', '')::numeric;
    if l_qty[i] is null or l_qty[i] <= 0 then
      raise exception 'La cantidad de la línea % debe ser mayor que cero', i;
    end if;
    v_price := nullif(v_x->>'unit_price', '')::numeric;
    if v_price is null or v_price < 0 then
      raise exception 'Precio no válido en la línea %', i;
    end if;
    l_gross[i] := round(l_qty[i] * v_price, v_prec);
    l_disc[i] := 0;
    l_dmonths[i] := 0;
  end loop;

  for j in 1..v_nd loop
    v_x := p_discounts -> (j - 1);
    d_scope[j] := v_x->>'scope';
    d_kind[j] := v_x->>'kind';
    d_val[j] := coalesce(nullif(v_x->>'value', '')::numeric, 0);
    d_months[j] := nullif(v_x->>'months', '')::integer;
    d_idx[j] := null;

    if d_scope[j] is null or d_scope[j] not in ('line','setup_total','monthly_total') then
      raise exception 'Alcance no válido en el descuento %', j;
    end if;
    if d_kind[j] is null or d_kind[j] not in ('percent','amount','fixed_price','free') then
      raise exception 'Tipo no válido en el descuento %', j;
    end if;
    if d_kind[j] = 'free' then
      d_val[j] := 0;
    end if;
    if d_val[j] < 0 then
      raise exception 'El valor del descuento % no puede ser negativo', j;
    end if;
    if d_kind[j] = 'percent' and d_val[j] > 100 then
      raise exception 'El porcentaje del descuento % no puede superar 100', j;
    end if;
    if d_months[j] is not null and (d_months[j] < 1 or d_months[j] > p_contract_months) then
      raise exception 'Los meses del descuento % deben estar entre 1 y %', j, p_contract_months;
    end if;
    if d_scope[j] = 'line' then
      d_idx[j] := array_position(l_ref, v_x->>'item_ref');
      if d_idx[j] is null then
        raise exception 'El descuento % apunta a una línea inexistente', j;
      end if;
      if l_per[d_idx[j]] = 'unico' and d_months[j] is not null then
        raise exception 'Los descuentos de habilitación no usan meses (descuento %)', j;
      end if;
    elsif d_scope[j] = 'setup_total' and d_months[j] is not null then
      raise exception 'Los descuentos de habilitación no usan meses (descuento %)', j;
    end if;
  end loop;

  for v_pass in 0..p_contract_months loop
    v_block := case when v_pass = 0 then 'unico' else 'mensual' end;
    v_cur := l_gross;

    for j in 1..v_nd loop
      continue when v_pass > 0 and d_months[j] is not null and v_pass > d_months[j];

      if d_scope[j] = 'line' then
        k := d_idx[j];
        continue when l_per[k] <> v_block;
        v_dt := case d_kind[j]
          when 'percent' then round(v_cur[k] * d_val[j] / 100, v_prec)
          when 'amount' then round(d_val[j], v_prec)
          when 'fixed_price' then v_cur[k] - round(d_val[j] * l_qty[k], v_prec)
          else v_cur[k]
        end;
        v_cur[k] := v_cur[k] - least(greatest(v_dt, 0), v_cur[k]);

      elsif (d_scope[j] = 'setup_total' and v_block = 'unico')
         or (d_scope[j] = 'monthly_total' and v_block = 'mensual') then
        v_total := 0;
        v_anchor := null;
        for i in 1..v_n loop
          if l_per[i] = v_block then
            v_total := v_total + v_cur[i];
            if v_anchor is null or v_cur[i] > v_cur[v_anchor] then
              v_anchor := i;
            end if;
          end if;
        end loop;
        continue when v_total <= 0;

        v_dt := case d_kind[j]
          when 'percent' then round(v_total * d_val[j] / 100, v_prec)
          when 'amount' then round(d_val[j], v_prec)
          when 'fixed_price' then v_total - round(d_val[j], v_prec)
          else v_total
        end;
        v_dt := least(greatest(v_dt, 0), v_total);
        continue when v_dt = 0;

        -- Reparto proporcional; la línea mayor absorbe la diferencia de redondeo.
        v_sum := 0;
        for i in 1..v_n loop
          if l_per[i] = v_block and i <> v_anchor then
            v_share := least(round(v_dt * v_cur[i] / v_total, v_prec), v_cur[i]);
            v_cur[i] := v_cur[i] - v_share;
            v_sum := v_sum + v_share;
          end if;
        end loop;
        v_cur[v_anchor] := v_cur[v_anchor] - least(greatest(v_dt - v_sum, 0), v_cur[v_anchor]);
      end if;
    end loop;

    v_sub := 0;
    v_net := 0;
    for i in 1..v_n loop
      if l_per[i] = v_block then
        v_sub := v_sub + l_gross[i];
        v_net := v_net + v_cur[i];
        if v_pass <= 1 then
          l_disc[i] := l_gross[i] - v_cur[i];
        end if;
        if v_pass >= 1 and v_cur[i] < l_gross[i] then
          l_dmonths[i] := l_dmonths[i] + 1;
        end if;
      end if;
    end loop;

    v_iva := round(v_net * p_iva_rate, v_prec);
    v_obj := jsonb_build_object(
      'subtotal', v_sub, 'discount', v_sub - v_net, 'net', v_net,
      'iva', v_iva, 'total', v_net + v_iva
    );
    v_contract := v_contract + v_net;

    if v_pass = 0 then
      v_setup := v_obj;
    else
      if v_pass = 1 then
        v_first := v_obj;
      end if;
      v_proj := v_proj || jsonb_build_array(v_obj || jsonb_build_object('month', v_pass));
    end if;
  end loop;

  for i in 1..v_n loop
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'ref', l_ref[i],
      'periodicity', l_per[i],
      'subtotal', l_gross[i],
      'discount', l_disc[i],
      'total', l_gross[i] - l_disc[i],
      'discount_months', l_dmonths[i]
    ));
  end loop;

  v_iva := round(v_contract * p_iva_rate, v_prec);
  return jsonb_build_object(
    'currency', p_currency,
    'iva_rate', p_iva_rate,
    'contract_months', p_contract_months,
    'lines', v_lines,
    'setup', v_setup,
    'monthly', v_first,
    'projection', v_proj,
    'contract', jsonb_build_object('net', v_contract, 'iva', v_iva, 'total', v_contract + v_iva)
  );
end;
$function$;



-- Mantener la funcion original intacta asegura compatibilidad UF/CLP.
create or replace function internal.quote_resolve_lines_usd(
  p_price_list_id uuid,p_currency text,p_uf_value numeric,p_usd_value numeric,p_items jsonb
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_list public.price_lists%rowtype;
  v_item public.price_list_items%rowtype;
  v_x jsonb; v_ord bigint; v_clp numeric; v_price numeric;
  v_out jsonb := '[]'::jsonb;
begin
  if p_currency is null or p_currency not in ('UF','CLP','USD') then
    raise exception 'Moneda no válida';
  end if;
  select * into v_list from public.price_lists
   where id = p_price_list_id and organization_id = internal.my_org();
  if not found then raise exception 'Lista de precios no disponible'; end if;
  if v_list.status <> 'vigente' then
    raise exception 'La lista de precios "%" está archivada', v_list.name;
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Formato de líneas no válido';
  end if;
  if p_uf_value is not null and p_uf_value <= 0 then raise exception 'Valor UF no válido'; end if;
  if p_usd_value is not null and p_usd_value <= 0 then raise exception 'Valor USD no válido'; end if;

  if v_list.currency <> 'USD' and p_currency <> 'USD' then
    return internal.quote_resolve_lines(p_price_list_id,p_currency,p_uf_value,p_items);
  end if;
  if v_list.currency <> p_currency then
    if (v_list.currency='UF' or p_currency='UF') and coalesce(p_uf_value,0)<=0 then
      raise exception 'Ingresa el valor de la UF en CLP para convertir la cotización';
    end if;
    if (v_list.currency='USD' or p_currency='USD') and coalesce(p_usd_value,0)<=0 then
      raise exception 'Ingresa el dólar en CLP por USD para convertir la cotización';
    end if;
  end if;
  for v_x,v_ord in select t.e,t.o from jsonb_array_elements(coalesce(p_items,'[]'::jsonb))
    with ordinality as t(e,o)
  loop
    select * into v_item from public.price_list_items
     where id=nullif(v_x->>'price_list_item_id','')::uuid and price_list_id=v_list.id;
    if not found then raise exception 'La línea % no corresponde a un servicio de la lista',v_ord; end if;
    if not v_item.active then raise exception 'El servicio % está inactivo',v_item.code; end if;
    if v_list.currency=p_currency then
      v_price:=v_item.price;
    else
      v_clp:=case v_list.currency
        when 'CLP' then v_item.price
        when 'UF' then v_item.price*p_uf_value
        when 'USD' then v_item.price*p_usd_value end;
      v_price:=case p_currency
        when 'CLP' then round(v_clp,0)
        when 'UF' then round(v_clp/p_uf_value,4)
        when 'USD' then round(v_clp/p_usd_value,4) end;
    end if;
    v_out:=v_out||jsonb_build_array(jsonb_build_object(
      'ref',coalesce(nullif(btrim(v_x->>'ref'),''),v_ord::text),
      'price_list_item_id',v_item.id,'code',v_item.code,'name',v_item.name,
      'periodicity',v_item.periodicity,'quantity',nullif(v_x->>'quantity','')::numeric,
      'list_price',v_item.price,'list_currency',v_list.currency,'unit_price',v_price
    ));
  end loop;
  return v_out;
end;
$$;
revoke all on function internal.quote_resolve_lines_usd(uuid,text,numeric,numeric,jsonb) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.quote_preview(p_quote jsonb, p_items jsonb DEFAULT '[]'::jsonb, p_discounts jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_currency text := nullif(p_quote->>'currency', '');
  v_lines jsonb;
begin
  if auth.uid() is null or internal.my_org() is null then
    raise exception 'Sesión sin organización activa';
  end if;

  v_lines := internal.quote_resolve_lines_usd(
    nullif(p_quote->>'price_list_id', '')::uuid,
    v_currency,
    nullif(p_quote->>'uf_value', '')::numeric,
    nullif(p_quote->>'usd_value', '')::numeric,
    p_items
  );

  return internal.quote_compute(
    v_currency, 0.19, nullif(p_quote->>'contract_months', '')::integer,
    v_lines, coalesce(p_discounts, '[]'::jsonb)
  ) || jsonb_build_object('items', v_lines);
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

  v_lines := internal.quote_resolve_lines_usd(v_price_list, v_currency, v_uf, v_usd, p_items);
  v_calc := internal.quote_compute(v_currency, v_iva_rate, v_months, v_lines, coalesce(p_discounts, '[]'::jsonb));

  if v_number is null then
    v_number := internal.next_quote_number(v_org, v_quote_date);
  end if;
  if p_base_id is not null then
    update public.quotes set is_current = false where id = p_base_id;
  end if;

  select coalesce(nullif(p.name, ''), p.email, '') into v_owner_name
    from public.profiles p
   where p.id = v_owner;

  insert into public.quotes (
    id, root_id, version, is_current, lead_id, owner_id, owner_name, status,
    client_snapshot, subtotal_neto, iva, total, notes, valid_until, organization_id,
    number, price_list_id, currency, uf_value, uf_date, usd_value, usd_date, quote_date, contract_months,
    payment_method, payment_terms, iva_rate, totals
  ) values (
    v_id, v_root, v_version, true, v_lead, v_owner, coalesce(v_owner_name, ''), v_status,
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
      id, quote_id, price_list_item_id, code, name, unit, quantity, unit_price,
      subtotal, discount, total, discount_months, periodicity, list_price, list_currency, position
    ) values (
      v_item_id, v_id, (v_line->>'price_list_item_id')::uuid, v_line->>'code', v_line->>'name', 'unidad',
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

  insert into public.price_list_items (price_list_id, code, name, price, periodicity, category, active, position)
  select
    v_id,
    btrim(t.e->>'code'),
    btrim(t.e->>'name'),
    (t.e->>'price')::numeric,
    case when lower(btrim(t.e->>'periodicity')) = 'mensual' then 'mensual' else 'unico' end,
    btrim(coalesce(t.e->>'category', '')),
    coalesce((t.e->>'active')::boolean, true),
    (t.o - 1)::integer
  from jsonb_array_elements(p_items) with ordinality as t(e, o);

  return v_id;
end;
$function$;


commit;