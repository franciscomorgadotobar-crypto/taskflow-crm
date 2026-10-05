-- 0045: Convenio Marco dentro del módulo ChileCompra.
-- Cache pública de órdenes CM + estado comercial por organización.

create table if not exists public.chilecompra_cm_orders (
  code text primary key,
  name text not null default '',
  description text not null default '',
  status_code integer,
  status text not null default '',
  type_code integer,
  type text not null default 'CM',
  currency text not null default 'CLP',
  net_total numeric,
  total numeric,
  discounts numeric,
  charges numeric,
  taxes numeric,
  created_at_mp timestamptz,
  sent_at timestamptz,
  accepted_at timestamptz,
  cancelled_at timestamptz,
  modified_at_mp timestamptz,
  buyer_code text not null default '',
  buyer_name text not null default '',
  buyer_unit text not null default '',
  buyer_rut text not null default '',
  buyer_region text not null default '',
  buyer_commune text not null default '',
  buyer_address text not null default '',
  buyer_contact text not null default '',
  buyer_email text not null default '',
  supplier_code text not null default '',
  supplier_name text not null default '',
  supplier_rut text not null default '',
  supplier_region text not null default '',
  supplier_commune text not null default '',
  supplier_address text not null default '',
  supplier_contact text not null default '',
  supplier_email text not null default '',
  agreement_code text not null default '',
  source_url text not null default '',
  raw jsonb not null default '{}'::jsonb,
  detail_loaded boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chilecompra_cm_order_items (
  order_code text not null references public.chilecompra_cm_orders(code) on delete cascade,
  line_no integer not null,
  category_code text not null default '',
  category text not null default '',
  product_code text not null default '',
  buyer_spec text not null default '',
  supplier_spec text not null default '',
  quantity numeric,
  unit text not null default '',
  currency text not null default 'CLP',
  unit_price numeric,
  charges numeric,
  discounts numeric,
  taxes numeric,
  total numeric,
  agreement_code text not null default '',
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (order_code, line_no)
);

create table if not exists public.chilecompra_cm_states (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_code text not null references public.chilecompra_cm_orders(code) on delete cascade,
  radar_state text not null default 'nuevo' check (radar_state in ('nuevo','guardado','crm','descartado')),
  lead_id uuid references public.leads(id) on delete set null,
  note text not null default '',
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, order_code)
);

create index if not exists chilecompra_cm_orders_created_idx
  on public.chilecompra_cm_orders (created_at_mp desc);
create index if not exists chilecompra_cm_orders_buyer_idx
  on public.chilecompra_cm_orders (buyer_name);
create index if not exists chilecompra_cm_orders_supplier_idx
  on public.chilecompra_cm_orders (supplier_name);
create index if not exists chilecompra_cm_orders_agreement_idx
  on public.chilecompra_cm_orders (agreement_code);
create index if not exists chilecompra_cm_items_product_idx
  on public.chilecompra_cm_order_items (product_code, category_code);
create index if not exists chilecompra_cm_items_agreement_idx
  on public.chilecompra_cm_order_items (agreement_code);
create index if not exists chilecompra_cm_states_org_state_idx
  on public.chilecompra_cm_states (organization_id, radar_state, updated_at desc);

alter table public.chilecompra_cm_orders enable row level security;
alter table public.chilecompra_cm_order_items enable row level security;
alter table public.chilecompra_cm_states enable row level security;

drop policy if exists chilecompra_cm_orders_select on public.chilecompra_cm_orders;
create policy chilecompra_cm_orders_select
on public.chilecompra_cm_orders for select to authenticated
using (true);

drop policy if exists chilecompra_cm_items_select on public.chilecompra_cm_order_items;
create policy chilecompra_cm_items_select
on public.chilecompra_cm_order_items for select to authenticated
using (true);

drop policy if exists chilecompra_cm_states_select on public.chilecompra_cm_states;
create policy chilecompra_cm_states_select
on public.chilecompra_cm_states for select to authenticated
using (organization_id = internal.my_org());

drop policy if exists chilecompra_cm_states_insert on public.chilecompra_cm_states;
create policy chilecompra_cm_states_insert
on public.chilecompra_cm_states for insert to authenticated
with check (
  organization_id = internal.my_org()
  and internal.my_role() in ('super','admin','comercial')
  and coalesce(updated_by, auth.uid()) = auth.uid()
);

drop policy if exists chilecompra_cm_states_update on public.chilecompra_cm_states;
create policy chilecompra_cm_states_update
on public.chilecompra_cm_states for update to authenticated
using (
  organization_id = internal.my_org()
  and internal.my_role() in ('super','admin','comercial')
)
with check (
  organization_id = internal.my_org()
  and internal.my_role() in ('super','admin','comercial')
);

create or replace function public.chilecompra_convert_cm_order(p_order_code text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order public.chilecompra_cm_orders%rowtype;
  v_state public.chilecompra_cm_states%rowtype;
  v_actor public.profiles%rowtype;
  v_lead_id uuid;
  v_notes text;
  v_items text;
begin
  if coalesce(internal.my_role() in ('super','admin','comercial'), false) is not true then
    raise exception 'No tienes permiso para convertir órdenes de Convenio Marco';
  end if;

  select * into v_order
  from public.chilecompra_cm_orders
  where code = p_order_code;

  if not found then raise exception 'Orden de Convenio Marco no encontrada'; end if;

  select * into v_state
  from public.chilecompra_cm_states
  where organization_id = internal.my_org()
    and order_code = p_order_code;

  if found and v_state.lead_id is not null then return v_state.lead_id; end if;

  select * into v_actor
  from public.profiles
  where id = auth.uid()
    and organization_id = internal.my_org()
    and active is true;

  if not found then raise exception 'Perfil activo no disponible'; end if;

  select string_agg(
    concat(
      coalesce(nullif(category,''), nullif(product_code,''), 'Ítem'),
      ': ',
      left(coalesce(nullif(supplier_spec,''), nullif(buyer_spec,''), 'Sin descripción'), 220),
      case when quantity is not null then concat(' · ', quantity, ' ', coalesce(unit,'')) else '' end,
      case when unit_price is not null then concat(' · precio unitario ', coalesce(currency,'CLP'), ' ', round(unit_price, 0)) else '' end
    ),
    E'\n'
    order by line_no
  )
  into v_items
  from public.chilecompra_cm_order_items
  where order_code = p_order_code;

  v_lead_id := gen_random_uuid();
  v_notes := concat(
    'Compra observada por Convenio Marco. OC: ', v_order.code,
    case when v_order.agreement_code <> '' then concat(E'\nConvenio: ', v_order.agreement_code) else '' end,
    case when v_order.supplier_name <> '' then concat(E'\nProveedor adjudicado: ', v_order.supplier_name) else '' end,
    case when v_order.total is not null then concat(E'\nMonto OC: ', v_order.currency, ' ', round(v_order.total,0)) else '' end,
    case when v_order.source_url <> '' then concat(E'\nFicha: ', v_order.source_url) else '' end,
    case when v_order.description <> '' then concat(E'\n\nDescripción: ', v_order.description) else '' end,
    case when coalesce(v_items,'') <> '' then concat(E'\n\nÍtems:\n', v_items) else '' end
  );

  insert into public.leads (
    id, organization_id, company, industry, source, stage, priority,
    probability, expected_close_date, next_action, next_date, next_type,
    owner_id, owner_name, notes, stage_history
  )
  values (
    v_lead_id,
    internal.my_org(),
    coalesce(nullif(v_order.buyer_name,''), nullif(v_order.buyer_unit,''), v_order.name),
    '',
    'ChileCompra · Convenio Marco',
    'Contactado',
    'Media',
    20,
    null,
    concat('Analizar recompra / abastecimiento de ', v_order.code),
    current_date,
    'Llamada',
    auth.uid(),
    coalesce(nullif(v_actor.name,''), nullif(v_actor.email,''), 'Usuario'),
    v_notes,
    jsonb_build_array(jsonb_build_object('stage','Contactado','at',now()))
  );

  insert into public.chilecompra_cm_states (
    organization_id, order_code, radar_state, lead_id, updated_by, updated_at
  )
  values (
    internal.my_org(), p_order_code, 'crm', v_lead_id, auth.uid(), now()
  )
  on conflict (organization_id, order_code)
  do update set
    radar_state='crm',
    lead_id=excluded.lead_id,
    updated_by=auth.uid(),
    updated_at=now();

  return v_lead_id;
end;
$$;

revoke all on function public.chilecompra_convert_cm_order(text) from public, anon;
grant execute on function public.chilecompra_convert_cm_order(text) to authenticated;

-- Actualización periódica de órdenes de Convenio Marco recientes.
-- El edge function filtra exclusivamente Tipo=CM/CodigoTipo=9.
do $$
begin
  perform cron.unschedule('chilecompra-cm-sync');
exception when others then
  null;
end
$$;

select cron.schedule(
  'chilecompra-cm-sync',
  '20 */2 * * *',
  $$
    select net.http_post(
      url := 'https://egglrpexexcodsreumnz.supabase.co/functions/v1/chilecompra-radar',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-radar-cron',(
          select decrypted_secret
          from vault.decrypted_secrets
          where name='chilecompra_radar_cron_key'
          order by created_at desc
          limit 1
        )
      ),
      body := '{"action":"cm-sync","days":1,"detailLimit":24,"offsetDays":0}'::jsonb,
      timeout_milliseconds := 120000
    ) as request_id;
  $$
);


do $$
begin
  perform cron.unschedule('chilecompra-cm-yesterday');
exception when others then
  null;
end
$$;

select cron.schedule(
  'chilecompra-cm-yesterday',
  '10 2 * * *',
  $$
    select net.http_post(
      url := 'https://egglrpexexcodsreumnz.supabase.co/functions/v1/chilecompra-radar',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-radar-cron',(
          select decrypted_secret
          from vault.decrypted_secrets
          where name='chilecompra_radar_cron_key'
          order by created_at desc
          limit 1
        )
      ),
      body := '{"action":"cm-sync","days":1,"detailLimit":24,"offsetDays":1}'::jsonb,
      timeout_milliseconds := 120000
    ) as request_id;
  $$
);
