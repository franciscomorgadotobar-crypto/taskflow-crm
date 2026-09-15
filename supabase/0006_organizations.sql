-- 0006: multiempresa (organizaciones) + oportunidades privadas.
--
-- Modelo acordado: dentro de una organización el equipo ve toda la cartera, salvo las
-- oportunidades marcadas como privadas. Editar sigue siendo del dueño y de admin/super.
-- Entre organizaciones no se ve nada: es la base para vender el CRM a varias empresas.

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

alter table public.profiles   add column organization_id uuid references public.organizations(id);
alter table public.leads      add column organization_id uuid references public.organizations(id);
alter table public.activities add column organization_id uuid references public.organizations(id);
alter table public.templates  add column organization_id uuid references public.organizations(id);
alter table public.services   add column organization_id uuid references public.organizations(id);
alter table public.quotes     add column organization_id uuid references public.organizations(id);

-- Oportunidad privada: solo la ve su dueño (y el super, para continuidad del negocio).
alter table public.leads add column is_private boolean not null default false;

create index profiles_org_idx   on public.profiles(organization_id);
create index leads_org_idx      on public.leads(organization_id);
create index activities_org_idx on public.activities(organization_id);
create index templates_org_idx  on public.templates(organization_id);
create index services_org_idx   on public.services(organization_id);
create index quotes_org_idx     on public.quotes(organization_id);

insert into public.organizations (name) values ('TaskFlow');

update public.profiles   set organization_id = (select id from public.organizations order by created_at limit 1);
update public.leads      set organization_id = (select id from public.organizations order by created_at limit 1);
update public.activities set organization_id = (select id from public.organizations order by created_at limit 1);
update public.templates  set organization_id = (select id from public.organizations order by created_at limit 1);
update public.services   set organization_id = (select id from public.organizations order by created_at limit 1);
update public.quotes     set organization_id = (select id from public.organizations order by created_at limit 1);

create or replace function internal.my_org()
returns uuid language sql stable security definer set search_path = '' as $$
  select organization_id from public.profiles where id = auth.uid();
$$;

-- Visibilidad de una oportunidad: misma organización y, si es privada, solo dueño o super.
create or replace function internal.can_see_lead(lead uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.leads l
    where l.id = lead
      and l.organization_id = internal.my_org()
      and (not l.is_private or l.owner_id = auth.uid() or internal.my_role() = 'super')
  );
$$;

-- Edición: además de poder verla, hay que ser el dueño o admin/super.
create or replace function internal.can_edit_lead(lead uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.leads l
    where l.id = lead
      and l.organization_id = internal.my_org()
      and (not l.is_private or l.owner_id = auth.uid() or internal.my_role() = 'super')
      and (internal.can_manage_all() or l.owner_id = auth.uid())
  );
$$;

revoke all on function internal.my_org(), internal.can_see_lead(uuid), internal.can_edit_lead(uuid) from public, anon;
grant execute on function internal.my_org(), internal.can_see_lead(uuid), internal.can_edit_lead(uuid) to authenticated;

-- Relleno automático de la organización: así el frontend no necesita saber de organizaciones.
create or replace function internal.set_org()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.organization_id is null then
    new.organization_id := internal.my_org();
  end if;
  return new;
end;
$$;

create trigger set_org before insert on public.leads      for each row execute function internal.set_org();
create trigger set_org before insert on public.activities for each row execute function internal.set_org();
create trigger set_org before insert on public.templates  for each row execute function internal.set_org();
create trigger set_org before insert on public.services   for each row execute function internal.set_org();
create trigger set_org before insert on public.quotes     for each row execute function internal.set_org();

-- Usuario nuevo: mientras exista una sola organización se asigna sola. Si algún día hay
-- varias, queda en null a propósito (falla cerrado) y el admin la asigna a mano; cuando
-- el CRM se venda, acá irá la lógica de crear una organización por cada alta.
create or replace function internal.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare unica uuid;
begin
  select id into unica from public.organizations
  where (select count(*) from public.organizations) = 1 limit 1;

  insert into public.profiles (id, email, name, organization_id)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
          unica);
  return new;
end;
$$;
