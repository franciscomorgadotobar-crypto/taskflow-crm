-- USD se factura en centavos: precio unitario y subtotal concuerdan al mostrar dos decimales.
CREATE OR REPLACE FUNCTION internal.quote_resolve_lines_usd(p_price_list_id uuid, p_currency text, p_uf_value numeric, p_usd_value numeric, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      v_price:=case when p_currency='USD' then round(v_item.price,2) else v_item.price end;
    else
      v_clp:=case v_list.currency
        when 'CLP' then v_item.price
        when 'UF' then v_item.price*p_uf_value
        when 'USD' then v_item.price*p_usd_value end;
      v_price:=case p_currency
        when 'CLP' then round(v_clp,0)
        when 'UF' then round(v_clp/p_uf_value,4)
        when 'USD' then round(v_clp/p_usd_value,2) end;
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
$function$;
