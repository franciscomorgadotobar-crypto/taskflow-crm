-- 0014: eliminación transaccional de una versión de cotización.
--
-- Si se elimina la versión vigente, reactiva la versión más reciente restante
-- dentro de la misma transacción. SECURITY INVOKER conserva RLS.

create or replace function public.delete_quote_version(p_quote_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_quote public.quotes%rowtype;
  v_next_id uuid;
begin
  select *
    into v_quote
    from public.quotes
   where id = p_quote_id
   for update;

  if not found then
    raise exception 'Cotización no encontrada o sin acceso';
  end if;

  delete from public.quotes where id = p_quote_id;

  if v_quote.is_current then
    select q.id
      into v_next_id
      from public.quotes q
     where coalesce(q.root_id, q.id) = coalesce(v_quote.root_id, v_quote.id)
     order by q.version desc
     limit 1
     for update;

    if v_next_id is not null then
      update public.quotes set is_current = true where id = v_next_id;
    end if;
  end if;
end;
$$;

revoke all on function public.delete_quote_version(uuid) from public, anon;
grant execute on function public.delete_quote_version(uuid) to authenticated;
