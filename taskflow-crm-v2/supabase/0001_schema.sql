-- TaskFlow CRM — esquema base (equipo, leads, actividades, plantillas, cotizador)

create extension if not exists "pgcrypto";

-- ---------- Equipo ----------

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null default '',
  phone text not null default '',
  role text not null default 'comercial' check (role in ('super','admin','comercial','visita')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Leads ----------

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  rut text not null default '',
  industry text not null default '',
  source text not null default '',
  contact text not null default '',
  role text not null default '',
  email text not null default '',
  phone text not null default '',
  stage text not null default 'Lead',
  priority text not null default '',
  value numeric not null default 0,
  probability numeric not null default 10,
  expected_close_date date,
  next_action text not null default '',
  next_date date,
  next_type text not null default '',
  owner_id uuid references public.profiles(id),
  owner_name text not null default '',
  loss_reason text not null default '',
  remarketing_reason text not null default '',
  notes text not null default '',
  stage_history jsonb not null default '[]',
  contacts jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leads_owner_id_idx on public.leads(owner_id);
create index leads_stage_idx on public.leads(stage);

create table public.discoveries (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  pain text not null default '',
  current_management text not null default '',
  technicians text not null default '',
  locations text not null default '',
  buy_trigger text not null default '',
  modules text[] not null default '{}',
  integrations text not null default '',
  success_criteria text not null default '',
  technical_notes text not null default '',
  updated_at timestamptz not null default now()
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  company text not null default '',
  type text not null default '',
  date timestamptz not null default now(),
  owner_id uuid references public.profiles(id),
  owner_name text not null default '',
  detail text not null default '',
  task text not null default '',
  commitment text not null default '',
  commitment_date date,
  commitment_done boolean not null default false,
  system boolean not null default false,
  created_at timestamptz not null default now()
);

create index activities_lead_id_idx on public.activities(lead_id);

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  channel text not null default 'both',
  subject text not null default '',
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Cotizador ----------

create table public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  unit text not null default 'unidad',
  net_price numeric not null default 0,
  category text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  root_id uuid,
  version integer not null default 1,
  is_current boolean not null default true,
  lead_id uuid not null references public.leads(id) on delete cascade,
  owner_id uuid references public.profiles(id),
  owner_name text not null default '',
  status text not null default 'borrador' check (status in ('borrador','enviada','aceptada','rechazada')),
  client_snapshot jsonb not null default '{}',
  subtotal_neto numeric not null default 0,
  iva numeric not null default 0,
  total numeric not null default 0,
  notes text not null default '',
  valid_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  foreign key (root_id) references public.quotes(id)
);

create index quotes_lead_id_idx on public.quotes(lead_id);
create index quotes_root_id_idx on public.quotes(root_id);
create index quotes_owner_id_idx on public.quotes(owner_id);

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  name text not null,
  unit text not null default 'unidad',
  quantity numeric not null default 1,
  unit_price numeric not null default 0,
  subtotal numeric not null default 0,
  position integer not null default 0
);

create index quote_items_quote_id_idx on public.quote_items(quote_id);

-- ---------- updated_at automático ----------

create function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.leads for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.discoveries for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.templates for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.services for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.quotes for each row execute function public.set_updated_at();
