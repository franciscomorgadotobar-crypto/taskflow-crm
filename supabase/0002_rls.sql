-- TaskFlow CRM — permisos por rol (RLS)
-- super/admin: acceso total. comercial: solo lo suyo. visita: solo lectura de todo.

create function public.my_role()
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create function public.can_view_all()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.my_role() in ('super','admin','visita'), false);
$$;

create function public.can_manage_all()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.my_role() in ('super','admin'), false);
$$;

alter table public.profiles enable row level security;
alter table public.leads enable row level security;
alter table public.discoveries enable row level security;
alter table public.activities enable row level security;
alter table public.templates enable row level security;
alter table public.services enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;

-- profiles: cualquier autenticado ve el equipo (para asignar responsables); cada quien edita lo suyo, admin/super edita todo.
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid() or public.can_manage_all());
create policy profiles_delete_admin on public.profiles for delete to authenticated using (public.can_manage_all());

-- leads
create policy leads_select on public.leads for select to authenticated
  using (public.can_view_all() or owner_id = auth.uid());
create policy leads_insert on public.leads for insert to authenticated
  with check (public.my_role() in ('super','admin','comercial') and (public.can_manage_all() or owner_id = auth.uid()));
create policy leads_update on public.leads for update to authenticated
  using (public.can_manage_all() or owner_id = auth.uid());
create policy leads_delete on public.leads for delete to authenticated
  using (public.can_manage_all() or owner_id = auth.uid());

-- discoveries (siguen la visibilidad del lead)
create policy discoveries_select on public.discoveries for select to authenticated
  using (exists (select 1 from public.leads l where l.id = discoveries.lead_id and (public.can_view_all() or l.owner_id = auth.uid())));
create policy discoveries_write on public.discoveries for all to authenticated
  using (exists (select 1 from public.leads l where l.id = discoveries.lead_id and (public.can_manage_all() or l.owner_id = auth.uid())))
  with check (exists (select 1 from public.leads l where l.id = discoveries.lead_id and (public.can_manage_all() or l.owner_id = auth.uid())));

-- activities
create policy activities_select on public.activities for select to authenticated
  using (public.can_view_all() or owner_id = auth.uid());
create policy activities_insert on public.activities for insert to authenticated
  with check (public.can_manage_all() or owner_id = auth.uid());
create policy activities_update on public.activities for update to authenticated
  using (public.can_manage_all() or owner_id = auth.uid());
create policy activities_delete on public.activities for delete to authenticated
  using (public.can_manage_all() or owner_id = auth.uid());

-- templates (recurso compartido de la empresa; edición reservada a admin/super)
create policy templates_select on public.templates for select to authenticated using (true);
create policy templates_write on public.templates for all to authenticated
  using (public.can_manage_all()) with check (public.can_manage_all());

-- services (catálogo compartido; edición reservada a admin/super)
create policy services_select on public.services for select to authenticated using (true);
create policy services_write on public.services for all to authenticated
  using (public.can_manage_all()) with check (public.can_manage_all());

-- quotes
create policy quotes_select on public.quotes for select to authenticated
  using (public.can_view_all() or owner_id = auth.uid());
create policy quotes_insert on public.quotes for insert to authenticated
  with check (public.can_manage_all() or owner_id = auth.uid());
create policy quotes_update on public.quotes for update to authenticated
  using (public.can_manage_all() or owner_id = auth.uid());
create policy quotes_delete on public.quotes for delete to authenticated
  using (public.can_manage_all() or owner_id = auth.uid());

-- quote_items (siguen la visibilidad de la cotización)
create policy quote_items_select on public.quote_items for select to authenticated
  using (exists (select 1 from public.quotes q where q.id = quote_items.quote_id and (public.can_view_all() or q.owner_id = auth.uid())));
create policy quote_items_write on public.quote_items for all to authenticated
  using (exists (select 1 from public.quotes q where q.id = quote_items.quote_id and (public.can_manage_all() or q.owner_id = auth.uid())))
  with check (exists (select 1 from public.quotes q where q.id = quote_items.quote_id and (public.can_manage_all() or q.owner_id = auth.uid())));
