-- 0013: creación transaccional de versiones de cotización.
--
-- Desactiva la versión vigente, crea la nueva cotización y sus ítems dentro de
-- una sola transacción. SECURITY INVOKER mantiene RLS y permisos del usuario.

create or replace function public.create_quote_version(
  p_quote jsonb,
  p_items jsonb default '[]'::jsonb,
  p_base_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := (p_quote->>'id')::uuid;
begin
  if v_id is null then raise exception 'ID de cotización obligatorio'; end if;

  if p_base_id is not null then
    update public.quotes
       set is_current = false
     where id = p_base_id;
    if not found then raise exception 'Cotización base no encontrada o sin acceso'; end if;
  end if;

  insert into public.quotes (
    id, root_id, version, is_current, lead_id, owner_id, owner_name, status,
    client_snapshot, subtotal_neto, iva, total, notes, valid_until
  ) values (
    v_id,
    nullif(p_quote->>'root_id','')::uuid,
    (p_quote->>'version')::integer,
    true,
    (p_quote->>'lead_id')::uuid,
    nullif(p_quote->>'owner_id','')::uuid,
    coalesce(p_quote->>'owner_name',''),
    coalesce(p_quote->>'status','borrador'),
    coalesce(p_quote->'client_snapshot','{}'::jsonb),
    coalesce((p_quote->>'subtotal_neto')::numeric,0),
    coalesce((p_quote->>'iva')::numeric,0),
    coalesce((p_quote->>'total')::numeric,0),
    coalesce(p_quote->>'notes',''),
    nullif(p_quote->>'valid_until','')::date
  );

  insert into public.quote_items (
    id, quote_id, service_id, name, unit, quantity, unit_price, subtotal, position
  )
  select
    (x->>'id')::uuid,
    v_id,
    nullif(x->>'service_id','')::uuid,
    coalesce(x->>'name',''),
    coalesce(x->>'unit','unidad'),
    coalesce((x->>'quantity')::numeric,1),
    coalesce((x->>'unit_price')::numeric,0),
    coalesce((x->>'subtotal')::numeric,0),
    coalesce((x->>'position')::integer,0)
  from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x;
end;
$$;

revoke all on function public.create_quote_version(jsonb, jsonb, uuid) from public, anon;
grant execute on function public.create_quote_version(jsonb, jsonb, uuid) to authenticated;
