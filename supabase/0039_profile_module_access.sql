-- 0039: acceso detallado por módulos para perfiles del CRM.

alter table public.profiles
  add column if not exists module_access text[] not null default array[
    'dashboard',
    'leads',
    'hyperfocus',
    'pipeline',
    'remarketing',
    'implementation',
    'templates',
    'chilecompra',
    'quotes'
  ]::text[];

update public.profiles
set module_access = array[
  'dashboard',
  'leads',
  'hyperfocus',
  'pipeline',
  'remarketing',
  'implementation',
  'templates',
  'chilecompra',
  'quotes'
]::text[]
where module_access is null;

alter table public.profiles
  drop constraint if exists profiles_module_access_valid;

alter table public.profiles
  add constraint profiles_module_access_valid
  check (
    module_access <@ array[
      'dashboard',
      'leads',
      'hyperfocus',
      'pipeline',
      'remarketing',
      'implementation',
      'templates',
      'chilecompra',
      'quotes'
    ]::text[]
  );
