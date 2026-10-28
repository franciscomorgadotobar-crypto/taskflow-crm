-- Cotizaciones independientes de leads (TaskFlow CRM, 2026-10-28)
-- Conserva versiones y snapshots existentes. Requiere empresa manual cuando lead_id IS NULL.
begin;
alter table public.quotes alter column lead_id drop not null;

-- Las cotizaciones sin lead quedan dentro de su organización y se restringen
-- a su creador (o administrador). El resto mantiene las reglas existentes.
drop policy if exists quotes_select on public.quotes;
create policy quotes_select on public.quotes for select to authenticated
  using (organization_id = internal.my_org()
    and (case when lead_id is null
      then (internal.can_manage_all() or owner_id = (select auth.uid()))
      else internal.can_see_lead(lead_id) end));

drop policy if exists quotes_insert on public.quotes;
create policy quotes_insert on public.quotes for insert to authenticated
  with check (organization_id = internal.my_org()
    and (lead_id is null or internal.can_edit_lead(lead_id))
    and (internal.can_manage_all() or owner_id = (select auth.uid())));

drop policy if exists quotes_update on public.quotes;
create policy quotes_update on public.quotes for update to authenticated
  using (organization_id = internal.my_org()
    and (lead_id is null or internal.can_edit_lead(lead_id))
    and (internal.can_manage_all() or owner_id = (select auth.uid())))
  with check (organization_id = internal.my_org()
    and (lead_id is null or internal.can_edit_lead(lead_id))
    and (internal.can_manage_all() or owner_id = (select auth.uid())));

drop policy if exists quotes_delete on public.quotes;
create policy quotes_delete on public.quotes for delete to authenticated
  using (organization_id = internal.my_org()
    and (lead_id is null or internal.can_edit_lead(lead_id))
    and (internal.can_manage_all() or owner_id = (select auth.uid())));

drop policy if exists quote_items_select on public.quote_items;
create policy quote_items_select on public.quote_items for select to authenticated
  using (exists (
    select 1 from public.quotes q where q.id = quote_items.quote_id
      and q.organization_id = internal.my_org()
      and (case when q.lead_id is null
        then (internal.can_manage_all() or q.owner_id = (select auth.uid()))
        else internal.can_see_lead(q.lead_id) end)
  ));

drop policy if exists quote_items_write on public.quote_items;
create policy quote_items_write on public.quote_items for all to authenticated
  using (exists (
    select 1 from public.quotes q where q.id = quote_items.quote_id
      and q.organization_id = internal.my_org()
      and (q.lead_id is null or internal.can_edit_lead(q.lead_id))
      and (internal.can_manage_all() or q.owner_id = (select auth.uid()))
  ))
  with check (exists (
    select 1 from public.quotes q where q.id = quote_items.quote_id
      and q.organization_id = internal.my_org()
      and (q.lead_id is null or internal.can_edit_lead(q.lead_id))
      and (internal.can_manage_all() or q.owner_id = (select auth.uid()))
  ));

drop policy if exists quote_discounts_select on public.quote_discounts;
create policy quote_discounts_select on public.quote_discounts for select to authenticated
  using (exists (
    select 1 from public.quotes q where q.id = quote_discounts.quote_id
      and q.organization_id = internal.my_org()
      and (case when q.lead_id is null
        then (internal.can_manage_all() or q.owner_id = (select auth.uid()))
        else internal.can_see_lead(q.lead_id) end)
  ));

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

  v_lines := internal.quote_resolve_lines(v_price_list, v_currency, v_uf, p_items);
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
    number, price_list_id, currency, uf_value, uf_date, quote_date, contract_months,
    payment_method, payment_terms, iva_rate, totals
  ) values (
    v_id, v_root, v_version, true, v_lead, v_owner, coalesce(v_owner_name, ''), v_status,
    coalesce(p_quote->'client_snapshot', '{}'::jsonb),
    (v_calc->'contract'->>'net')::numeric,
    (v_calc->'contract'->>'iva')::numeric,
    (v_calc->'contract'->>'total')::numeric,
    coalesce(p_quote->>'notes', ''), v_valid_until, v_org,
    v_number, v_price_list, v_currency, v_uf, nullif(p_quote->>'uf_date', '')::date,
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
$function$
;

CREATE OR REPLACE FUNCTION public.delete_quote_version(p_quote_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_quote public.quotes%rowtype;
  v_chain_root uuid;
  v_new_root uuid;
  v_next_id uuid;
begin
  select *
    into v_quote
    from public.quotes
   where id = p_quote_id
     and organization_id = internal.my_org()
   for update;

  if not found then
    raise exception 'Cotización no encontrada o sin acceso';
  end if;

  if coalesce(internal.my_role() in ('super','admin','comercial'), false) is not true
     or (v_quote.lead_id is not null and not internal.can_edit_lead(v_quote.lead_id))
     or not (internal.can_manage_all() or v_quote.owner_id = auth.uid()) then
    raise exception 'No tienes permiso para eliminar esta cotización';
  end if;

  v_chain_root := coalesce(v_quote.root_id, v_quote.id);

  if v_quote.root_id is null then
    select q.id
      into v_new_root
      from public.quotes q
     where q.root_id = v_quote.id
       and q.id <> p_quote_id
     order by q.version asc
     limit 1
     for update;

    if v_new_root is not null then
      update public.quotes
         set root_id = null
       where id = v_new_root;

      update public.quotes
         set root_id = v_new_root
       where root_id = v_quote.id
         and id <> v_new_root;

      v_chain_root := v_new_root;
    end if;
  end if;

  delete from public.quotes where id = p_quote_id;

  if v_quote.is_current then
    select q.id
      into v_next_id
      from public.quotes q
     where coalesce(q.root_id, q.id) = v_chain_root
     order by q.version desc
     limit 1
     for update;

    if v_next_id is not null then
      update public.quotes set is_current = true where id = v_next_id;
    end if;
  end if;
end;
$function$
;
commit;
