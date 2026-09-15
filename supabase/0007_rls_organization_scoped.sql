-- 0007: reescribir las reglas de acceso con alcance por organización.
-- Ver: todo lo de mi organización, salvo oportunidades privadas ajenas.
-- Editar: sigue siendo del dueño y de admin/super.
-- Entre organizaciones no se ve ni se escribe nada.

alter table public.organizations enable row level security;

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update_self on public.profiles;
drop policy if exists profiles_delete_admin on public.profiles;
drop policy if exists leads_select on public.leads;
drop policy if exists leads_insert on public.leads;
drop policy if exists leads_update on public.leads;
drop policy if exists leads_delete on public.leads;
drop policy if exists discoveries_select on public.discoveries;
drop policy if exists discoveries_write on public.discoveries;
drop policy if exists activities_select on public.activities;
drop policy if exists activities_insert on public.activities;
drop policy if exists activities_update on public.activities;
drop policy if exists activities_delete on public.activities;
drop policy if exists templates_select on public.templates;
drop policy if exists templates_write on public.templates;
drop policy if exists services_select on public.services;
drop policy if exists services_write on public.services;
drop policy if exists quotes_select on public.quotes;
drop policy if exists quotes_insert on public.quotes;
drop policy if exists quotes_update on public.quotes;
drop policy if exists quotes_delete on public.quotes;
drop policy if exists quote_items_select on public.quote_items;
drop policy if exists quote_items_write on public.quote_items;

create policy organizations_select on public.organizations for select to authenticated
  using (id = internal.my_org());

create policy profiles_select on public.profiles for select to authenticated
  using (organization_id = internal.my_org());
create policy profiles_update on public.profiles for update to authenticated
  using (organization_id = internal.my_org() and (id = auth.uid() or internal.can_manage_all()))
  with check (organization_id = internal.my_org());
create policy profiles_delete on public.profiles for delete to authenticated
  using (organization_id = internal.my_org() and internal.can_manage_all());

-- La condición va escrita acá (no con el ayudante) para no consultar la misma tabla
-- una vez por fila.
create policy leads_select on public.leads for select to authenticated
  using (
    organization_id = internal.my_org()
    and (not is_private or owner_id = auth.uid() or internal.my_role() = 'super')
  );
create policy leads_insert on public.leads for insert to authenticated
  with check (
    organization_id = internal.my_org()
    and internal.my_role() in ('super','admin','comercial')
    and (internal.can_manage_all() or owner_id = auth.uid())
  );
create policy leads_update on public.leads for update to authenticated
  using (
    organization_id = internal.my_org()
    and (not is_private or owner_id = auth.uid() or internal.my_role() = 'super')
    and (internal.can_manage_all() or owner_id = auth.uid())
  )
  with check (organization_id = internal.my_org());
create policy leads_delete on public.leads for delete to authenticated
  using (
    organization_id = internal.my_org()
    and (not is_private or owner_id = auth.uid() or internal.my_role() = 'super')
    and (internal.can_manage_all() or owner_id = auth.uid())
  );

create policy discoveries_select on public.discoveries for select to authenticated
  using (internal.can_see_lead(lead_id));
create policy discoveries_write on public.discoveries for all to authenticated
  using (internal.can_edit_lead(lead_id))
  with check (internal.can_edit_lead(lead_id));

create policy activities_select on public.activities for select to authenticated
  using (organization_id = internal.my_org() and (lead_id is null or internal.can_see_lead(lead_id)));
create policy activities_insert on public.activities for insert to authenticated
  with check (organization_id = internal.my_org() and (lead_id is null or internal.can_see_lead(lead_id)));
create policy activities_update on public.activities for update to authenticated
  using (organization_id = internal.my_org() and (internal.can_manage_all() or owner_id = auth.uid()))
  with check (organization_id = internal.my_org());
create policy activities_delete on public.activities for delete to authenticated
  using (organization_id = internal.my_org() and (internal.can_manage_all() or owner_id = auth.uid()));

create policy templates_select on public.templates for select to authenticated
  using (organization_id = internal.my_org());
create policy templates_write on public.templates for all to authenticated
  using (organization_id = internal.my_org() and internal.can_manage_all())
  with check (organization_id = internal.my_org() and internal.can_manage_all());

create policy services_select on public.services for select to authenticated
  using (organization_id = internal.my_org());
create policy services_write on public.services for all to authenticated
  using (organization_id = internal.my_org() and internal.can_manage_all())
  with check (organization_id = internal.my_org() and internal.can_manage_all());

create policy quotes_select on public.quotes for select to authenticated
  using (organization_id = internal.my_org() and internal.can_see_lead(lead_id));
create policy quotes_insert on public.quotes for insert to authenticated
  with check (organization_id = internal.my_org() and internal.can_see_lead(lead_id)
              and (internal.can_manage_all() or owner_id = auth.uid()));
create policy quotes_update on public.quotes for update to authenticated
  using (organization_id = internal.my_org() and internal.can_see_lead(lead_id)
         and (internal.can_manage_all() or owner_id = auth.uid()))
  with check (organization_id = internal.my_org());
create policy quotes_delete on public.quotes for delete to authenticated
  using (organization_id = internal.my_org() and internal.can_see_lead(lead_id)
         and (internal.can_manage_all() or owner_id = auth.uid()));

create policy quote_items_select on public.quote_items for select to authenticated
  using (exists (select 1 from public.quotes q where q.id = quote_items.quote_id
                 and q.organization_id = internal.my_org() and internal.can_see_lead(q.lead_id)));
create policy quote_items_write on public.quote_items for all to authenticated
  using (exists (select 1 from public.quotes q where q.id = quote_items.quote_id
                 and q.organization_id = internal.my_org() and internal.can_see_lead(q.lead_id)
                 and (internal.can_manage_all() or q.owner_id = auth.uid())))
  with check (exists (select 1 from public.quotes q where q.id = quote_items.quote_id
                 and q.organization_id = internal.my_org() and internal.can_see_lead(q.lead_id)
                 and (internal.can_manage_all() or q.owner_id = auth.uid())));
