-- 0005: arreglar las llamadas internas que quedaron apuntando al esquema público.
-- La migración 0003 movió estas funciones a `internal` con ALTER FUNCTION ... SET SCHEMA,
-- pero el cuerpo de una función es texto y no se reescribe: can_view_all() y can_manage_all()
-- seguían llamando a public.my_role(), que ya no existe. Como casi todas las políticas RLS
-- pasan por esas dos funciones, cualquier lectura o escritura fallaba con
-- "function public.my_role() does not exist".

create or replace function internal.my_role()
returns text language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function internal.can_view_all()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(internal.my_role() in ('super','admin','visita'), false);
$$;

create or replace function internal.can_manage_all()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(internal.my_role() in ('super','admin'), false);
$$;
