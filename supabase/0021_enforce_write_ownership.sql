-- 0021: hacer efectivo el modelo "visita = solo lectura" y alinear las escrituras
-- de comerciales con las oportunidades que realmente tienen asignadas.
--
-- 0007 protegía muchas mutaciones por owner_id, pero varias políticas no incluían
-- una comprobación explícita de rol. Un perfil degradado a visita podía conservar
-- permisos de escritura sobre filas que seguían siendo suyas. Actividades e Híper
-- Foco tenían además rutas de UPDATE/DELETE que dependían solo del ownership/claim.

create or replace function internal.can_edit_lead(lead uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.leads l
    where l.id = lead
      and l.organization_id = internal.my_org()
      and internal.my_role() in ('super','admin','comercial')
      and (not l.is_private or l.owner_id = auth.uid() or internal.my_role() = 'super')
      and (internal.can_manage_all() or l.owner_id = auth.uid())
  );
$$;

revoke all on function internal.can_edit_lead(uuid) from public, anon;
grant execute on function internal.can_edit_lead(uuid) to authenticated, service_role;

drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads for update to authenticated
  using (
    organization_id = internal.my_org()
    and internal.my_role() in ('super','admin','comercial')
    and (not is_private or owner_id = auth.uid() or internal.my_role() = 'super')
    and (internal.can_manage_all() or owner_id = auth.uid())
  )
  with check (
    organization_id = internal.my_org()
    and internal.my_role() in ('super','admin','comercial')
    and (internal.can_manage_all() or owner_id = auth.uid())
  );

drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads for delete to authenticated
  using (
    organization_id = internal.my_org()
    and internal.my_role() in ('super','admin','comercial')
    and (not is_private or owner_id = auth.uid() or internal.my_role() = 'super')
    and (internal.can_manage_all() or owner_id = auth.uid())
  );

drop policy if exists activities_insert on public.activities;
create policy activities_insert on public.activities for insert to authenticated
  with check (
    organization_id = internal.my_org()
    and internal.my_role() in ('super','admin','comercial')
    and (
      (lead_id is not null and internal.can_edit_lead(lead_id))
      or
      (lead_id is null and (internal.can_manage_all() or owner_id = auth.uid()))
    )
  );

drop policy if exists activities_update on public.activities;
create policy activities_update on public.activities for update to authenticated
  using (
    organization_id = internal.my_org()
    and internal.my_role() in ('super','admin','comercial')
    and system = false
    and coalesce(task, '') = ''
    and (lead_id is null or internal.can_edit_lead(lead_id))
    and (internal.can_manage_all() or owner_id = auth.uid())
  )
  with check (
    organization_id = internal.my_org()
    and internal.my_role() in ('super','admin','comercial')
    and system = false
    and coalesce(task, '') = ''
    and (lead_id is null or internal.can_edit_lead(lead_id))
    and (internal.can_manage_all() or owner_id = auth.uid())
  );

drop policy if exists activities_delete on public.activities;
create policy activities_delete on public.activities for delete to authenticated
  using (
    organization_id = internal.my_org()
    and internal.my_role() in ('super','admin','comercial')
    and system = false
    and coalesce(task, '') = ''
    and (lead_id is null or internal.can_edit_lead(lead_id))
    and (internal.can_manage_all() or owner_id = auth.uid())
  );

drop policy if exists quotes_insert on public.quotes;
create policy quotes_insert on public.quotes for insert to authenticated
  with check (
    organization_id = internal.my_org()
    and internal.can_edit_lead(lead_id)
    and (internal.can_manage_all() or owner_id = auth.uid())
  );

drop policy if exists quotes_update on public.quotes;
create policy quotes_update on public.quotes for update to authenticated
  using (
    organization_id = internal.my_org()
    and internal.can_edit_lead(lead_id)
    and (internal.can_manage_all() or owner_id = auth.uid())
  )
  with check (
    organization_id = internal.my_org()
    and internal.can_edit_lead(lead_id)
    and (internal.can_manage_all() or owner_id = auth.uid())
  );

drop policy if exists quotes_delete on public.quotes;
create policy quotes_delete on public.quotes for delete to authenticated
  using (
    organization_id = internal.my_org()
    and internal.can_edit_lead(lead_id)
    and (internal.can_manage_all() or owner_id = auth.uid())
  );

drop policy if exists quote_items_write on public.quote_items;
create policy quote_items_write on public.quote_items for all to authenticated
  using (
    exists (
      select 1
      from public.quotes q
      where q.id = quote_items.quote_id
        and q.organization_id = internal.my_org()
        and internal.can_edit_lead(q.lead_id)
        and (internal.can_manage_all() or q.owner_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.quotes q
      where q.id = quote_items.quote_id
        and q.organization_id = internal.my_org()
        and internal.can_edit_lead(q.lead_id)
        and (internal.can_manage_all() or q.owner_id = auth.uid())
    )
  );

drop policy if exists hyperfocus_campaigns_insert on public.hyperfocus_campaigns;
create policy hyperfocus_campaigns_insert on public.hyperfocus_campaigns for insert to authenticated
  with check (
    organization_id = internal.my_org()
    and internal.my_role() in ('super','admin','comercial')
    and created_by = auth.uid()
  );

drop policy if exists hyperfocus_campaigns_update on public.hyperfocus_campaigns;
create policy hyperfocus_campaigns_update on public.hyperfocus_campaigns for update to authenticated
  using (
    organization_id = internal.my_org()
    and internal.my_role() in ('super','admin','comercial')
    and (internal.can_manage_all() or created_by = auth.uid())
  )
  with check (
    organization_id = internal.my_org()
    and internal.my_role() in ('super','admin','comercial')
    and (internal.can_manage_all() or created_by = auth.uid())
  );

drop policy if exists hyperfocus_campaigns_delete on public.hyperfocus_campaigns;
create policy hyperfocus_campaigns_delete on public.hyperfocus_campaigns for delete to authenticated
  using (
    organization_id = internal.my_org()
    and internal.my_role() in ('super','admin','comercial')
    and (internal.can_manage_all() or created_by = auth.uid())
  );

drop policy if exists hyperfocus_records_insert on public.hyperfocus_records;
create policy hyperfocus_records_insert on public.hyperfocus_records for insert to authenticated
  with check (
    organization_id = internal.my_org()
    and internal.my_role() in ('super','admin','comercial')
    and exists (
      select 1
      from public.hyperfocus_campaigns c
      where c.id = hyperfocus_records.campaign_id
        and c.organization_id = internal.my_org()
        and (internal.can_manage_all() or c.created_by = auth.uid())
    )
  );

drop policy if exists hyperfocus_records_update on public.hyperfocus_records;
create policy hyperfocus_records_update on public.hyperfocus_records for update to authenticated
  using (
    organization_id = internal.my_org()
    and internal.my_role() in ('super','admin','comercial')
    and (internal.can_manage_all() or claimed_by = auth.uid())
  )
  with check (
    organization_id = internal.my_org()
    and internal.my_role() in ('super','admin','comercial')
  );

drop policy if exists hyperfocus_records_delete on public.hyperfocus_records;
create policy hyperfocus_records_delete on public.hyperfocus_records for delete to authenticated
  using (
    organization_id = internal.my_org()
    and internal.my_role() in ('super','admin','comercial')
    and (
      internal.can_manage_all()
      or exists (
        select 1
        from public.hyperfocus_campaigns c
        where c.id = hyperfocus_records.campaign_id
          and c.created_by = auth.uid()
      )
    )
  );


drop policy if exists hyperfocus_interactions_insert on public.hyperfocus_interactions;
create policy hyperfocus_interactions_insert on public.hyperfocus_interactions for insert to authenticated
  with check (
    organization_id = internal.my_org()
    and internal.my_role() in ('super','admin','comercial')
    and created_by = auth.uid()
    and exists (
      select 1
      from public.hyperfocus_records r
      where r.id = hyperfocus_interactions.record_id
        and r.campaign_id = hyperfocus_interactions.campaign_id
        and r.organization_id = internal.my_org()
    )
  );
