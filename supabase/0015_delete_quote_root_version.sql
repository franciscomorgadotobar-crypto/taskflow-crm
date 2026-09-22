-- 0015: permite eliminar la versión raíz conservando versiones posteriores.
--
-- Si se elimina la raíz (root_id NULL) y existen descendientes, promueve la
-- versión más antigua restante como nueva raíz y reengancha toda la cadena.
-- La operación completa sigue siendo transaccional y SECURITY INVOKER.

create or replace function public.delete_quote_version(p_quote_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
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
   for update;

  if not found then
    raise exception 'Cotización no encontrada o sin acceso';
  end if;

  v_chain_root := coalesce(v_quote.root_id, v_quote.id);

  -- Al borrar la raíz, primero promueve una versión restante para no violar la
  -- FK quotes.root_id -> quotes.id. La nueva raíz queda con root_id NULL.
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
$$;

revoke all on function public.delete_quote_version(uuid) from public, anon;
grant execute on function public.delete_quote_version(uuid) to authenticated;
