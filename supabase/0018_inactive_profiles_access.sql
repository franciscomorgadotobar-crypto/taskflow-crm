-- 0018: un perfil marcado como inactivo deja de pertenecer efectivamente a la organización.
-- Auth puede conservar una sesión válida, por lo que la barrera debe estar en RLS y no
-- solamente en la interfaz.

create or replace function internal.my_org()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organization_id
  from public.profiles
  where id = auth.uid()
    and active = true;
$$;

create or replace function internal.my_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from public.profiles
  where id = auth.uid()
    and active = true;
$$;

create or replace function internal.can_manage_all()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(internal.my_role() in ('super','admin'), false);
$$;

revoke all on function internal.my_org(), internal.my_role(), internal.can_manage_all() from public, anon;
grant execute on function internal.my_org(), internal.my_role(), internal.can_manage_all() to authenticated;
