-- 0034: ayuda y tutoriales guiados inspirados en la experiencia de Coproactiva.

create table if not exists public.tutorials (
  id text primary key,
  name text not null,
  description text not null default '',
  version integer not null default 1 check (version > 0),
  duration_min integer not null default 3 check (duration_min > 0),
  roles text[] not null default array['super','admin','comercial','visita']::text[],
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tutorials_id_format check (id ~ '^[a-z0-9_]+$')
);

create table if not exists public.tutorial_assignments (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tutorial_id text not null references public.tutorials(id) on delete cascade,
  version integer not null check (version > 0),
  auto_start boolean not null default true,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (profile_id, tutorial_id, version)
);

create table if not exists public.tutorial_progress (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tutorial_id text not null references public.tutorials(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null default 'pending'
    check (status in ('pending','in_progress','completed')),
  current_step integer not null default 0 check (current_step >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (profile_id, tutorial_id, version)
);

alter table public.tutorials enable row level security;
alter table public.tutorial_assignments enable row level security;
alter table public.tutorial_progress enable row level security;

drop policy if exists tutorials_read on public.tutorials;
create policy tutorials_read on public.tutorials
for select to authenticated
using (active or internal.my_role() = 'super');

drop policy if exists tutorials_super_insert on public.tutorials;
create policy tutorials_super_insert on public.tutorials
for insert to authenticated
with check (internal.my_role() = 'super');

drop policy if exists tutorials_super_update on public.tutorials;
create policy tutorials_super_update on public.tutorials
for update to authenticated
using (internal.my_role() = 'super')
with check (internal.my_role() = 'super');

drop policy if exists tutorials_super_delete on public.tutorials;
create policy tutorials_super_delete on public.tutorials
for delete to authenticated
using (internal.my_role() = 'super');

drop policy if exists tutorial_assignments_read on public.tutorial_assignments;
create policy tutorial_assignments_read on public.tutorial_assignments
for select to authenticated
using ((select auth.uid()) = profile_id or internal.my_role() = 'super');

drop policy if exists tutorial_assignments_super_insert on public.tutorial_assignments;
create policy tutorial_assignments_super_insert on public.tutorial_assignments
for insert to authenticated
with check (internal.my_role() = 'super');

drop policy if exists tutorial_assignments_super_update on public.tutorial_assignments;
create policy tutorial_assignments_super_update on public.tutorial_assignments
for update to authenticated
using (internal.my_role() = 'super')
with check (internal.my_role() = 'super');

drop policy if exists tutorial_assignments_super_delete on public.tutorial_assignments;
create policy tutorial_assignments_super_delete on public.tutorial_assignments
for delete to authenticated
using (internal.my_role() = 'super');

drop policy if exists tutorial_progress_read on public.tutorial_progress;
create policy tutorial_progress_read on public.tutorial_progress
for select to authenticated
using ((select auth.uid()) = profile_id or internal.my_role() = 'super');

drop policy if exists tutorial_progress_insert on public.tutorial_progress;
create policy tutorial_progress_insert on public.tutorial_progress
for insert to authenticated
with check ((select auth.uid()) = profile_id or internal.my_role() = 'super');

drop policy if exists tutorial_progress_update on public.tutorial_progress;
create policy tutorial_progress_update on public.tutorial_progress
for update to authenticated
using ((select auth.uid()) = profile_id or internal.my_role() = 'super')
with check ((select auth.uid()) = profile_id or internal.my_role() = 'super');

drop policy if exists tutorial_progress_delete on public.tutorial_progress;
create policy tutorial_progress_delete on public.tutorial_progress
for delete to authenticated
using (internal.my_role() = 'super');

grant select on public.tutorials to authenticated;
grant select on public.tutorial_assignments to authenticated;
grant select, insert, update on public.tutorial_progress to authenticated;

insert into public.tutorials (id,name,description,version,duration_min,roles,sort_order)
values
('primeros_pasos','Primeros pasos','Conoce el resumen, tus pendientes y dónde encontrar ChileCompra.',1,3,array['super','admin','comercial','visita']::text[],10),
('gestionar_pipeline','Gestionar el pipeline','Aprende a leer el embudo, abrir oportunidades y registrar el siguiente paso.',1,4,array['super','admin','comercial','visita']::text[],20),
('chilecompra','ChileCompra','Crea seguimientos, revisa coincidencias y usa la inteligencia de mercado.',1,5,array['super','admin','comercial','visita']::text[],30),
('gestionar_equipo','Gestionar equipo','Agrega personas, define permisos, reenvía accesos y administra bajas.',1,4,array['super','admin']::text[],40)
on conflict (id) do update set
  name=excluded.name,description=excluded.description,version=excluded.version,
  duration_min=excluded.duration_min,roles=excluded.roles,sort_order=excluded.sort_order,
  active=true,updated_at=now();

create or replace function public.assign_tutorials_to_new_profile()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.active then
    insert into public.tutorial_assignments(profile_id,tutorial_id,version,auto_start,assigned_by)
    select new.id,t.id,t.version,(t.id='primeros_pasos'),null
    from public.tutorials t
    where t.active and new.role::text = any(t.roles) and t.id='primeros_pasos'
    on conflict do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.assign_tutorials_to_new_profile() from public;
revoke all on function public.assign_tutorials_to_new_profile() from anon;
revoke all on function public.assign_tutorials_to_new_profile() from authenticated;

drop trigger if exists profiles_initial_tutorials on public.profiles;
create trigger profiles_initial_tutorials
after insert on public.profiles
for each row execute function public.assign_tutorials_to_new_profile();

insert into public.tutorial_assignments(profile_id,tutorial_id,version,auto_start,assigned_by)
select p.id,t.id,t.version,true,null
from public.profiles p
join public.tutorials t on t.id='primeros_pasos' and t.active
where p.active and p.role::text = any(t.roles)
on conflict do nothing;

create index if not exists tutorial_assignments_tutorial_idx on public.tutorial_assignments(tutorial_id);
create index if not exists tutorial_progress_tutorial_idx on public.tutorial_progress(tutorial_id);
