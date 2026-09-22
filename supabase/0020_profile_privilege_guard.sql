-- 0020: administración del equipo reservada al rol super y protección
-- contra auto-escalación de privilegios.
--
-- Antes, profiles_update permitía que cualquier usuario actualizara su propia fila
-- completa. Un comercial podía llamar directamente a PostgREST y cambiar role a
-- admin/super. Además, admin podía modificar/eliminar perfiles aunque el modelo del
-- producto reserva la administración del equipo al super.

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (
    organization_id = internal.my_org()
    and (id = auth.uid() or internal.my_role() = 'super')
  )
  with check (organization_id = internal.my_org());

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles for delete to authenticated
  using (
    organization_id = internal.my_org()
    and internal.my_role() = 'super'
  );

create or replace function internal.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  other_active_super boolean;
begin
  -- Operaciones administrativas con service_role / SQL Editor no llevan auth.uid().
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  actor_role := internal.my_role();

  if tg_op = 'UPDATE' then
    -- Un usuario que no sea super solo puede editar sus datos personales.
    if actor_role is distinct from 'super' then
      if new.id is distinct from old.id
         or new.email is distinct from old.email
         or new.organization_id is distinct from old.organization_id
         or new.role is distinct from old.role
         or new.active is distinct from old.active
         or new.created_at is distinct from old.created_at then
        raise exception 'Solo un super administrador puede cambiar permisos, estado u organización de un perfil'
          using errcode = '42501';
      end if;
      return new;
    end if;

    -- Evita dejar una organización sin ningún super activo por un cambio accidental.
    if old.role = 'super'
       and old.active = true
       and (
         new.role is distinct from 'super'
         or new.active is distinct from true
         or new.organization_id is distinct from old.organization_id
       ) then
      select exists (
        select 1
        from public.profiles p
        where p.organization_id = old.organization_id
          and p.id <> old.id
          and p.role = 'super'
          and p.active = true
      ) into other_active_super;

      if not other_active_super then
        raise exception 'La organización debe conservar al menos un super administrador activo'
          using errcode = '42501';
      end if;
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    if actor_role is distinct from 'super' then
      raise exception 'Solo un super administrador puede eliminar perfiles'
        using errcode = '42501';
    end if;

    if old.role = 'super' and old.active = true then
      select exists (
        select 1
        from public.profiles p
        where p.organization_id = old.organization_id
          and p.id <> old.id
          and p.role = 'super'
          and p.active = true
      ) into other_active_super;

      if not other_active_super then
        raise exception 'La organización debe conservar al menos un super administrador activo'
          using errcode = '42501';
      end if;
    end if;

    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists protect_profile_privileges on public.profiles;
create trigger protect_profile_privileges
  before update or delete on public.profiles
  for each row execute function internal.protect_profile_privileges();

revoke all on function internal.protect_profile_privileges() from public, anon, authenticated;


-- Defensa adicional para el alta administrada: aunque alguien lograra usar signup
-- directamente contra la API pública de Auth, el perfil nace inactivo y 0018 lo
-- deja sin organización/rol efectivos hasta que un super lo habilite.
create or replace function internal.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  unica uuid;
begin
  select id into unica
  from public.organizations
  where (select count(*) from public.organizations) = 1
  limit 1;

  insert into public.profiles (id, email, name, organization_id, active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    unica,
    false
  );
  return new;
end;
$$;

revoke all on function internal.handle_new_user() from public, anon, authenticated;
