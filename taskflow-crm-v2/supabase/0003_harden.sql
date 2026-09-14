-- Endurecer: sacar los helpers de RLS del esquema público (no deben quedar expuestos como RPC)
-- y fijar search_path en la función de trigger que faltaba.

create schema if not exists internal;
revoke all on schema internal from public, anon, authenticated;
grant usage on schema internal to authenticated;

alter function public.my_role() set schema internal;
alter function public.can_view_all() set schema internal;
alter function public.can_manage_all() set schema internal;
alter function public.handle_new_user() set schema internal;

revoke all on function internal.my_role() from public, anon;
revoke all on function internal.can_view_all() from public, anon;
revoke all on function internal.can_manage_all() from public, anon;
grant execute on function internal.my_role() to authenticated;
grant execute on function internal.can_view_all() to authenticated;
grant execute on function internal.can_manage_all() to authenticated;

alter function public.set_updated_at() set search_path = '';
