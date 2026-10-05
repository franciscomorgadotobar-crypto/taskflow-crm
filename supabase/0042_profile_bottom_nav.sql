-- 0042: preferencia personal para la barra inferior móvil.

alter table public.profiles
  add column if not exists bottom_nav text[] not null default array[
    'dashboard',
    'chilecompra',
    'hyperfocus',
    'pipeline',
    'remarketing'
  ]::text[];

update public.profiles
set bottom_nav = array[
  'dashboard',
  'chilecompra',
  'hyperfocus',
  'pipeline',
  'remarketing'
]::text[]
where bottom_nav is null
   or bottom_nav = '{}'::text[];

alter table public.profiles
  drop constraint if exists profiles_bottom_nav_valid;

alter table public.profiles
  add constraint profiles_bottom_nav_valid
  check (
    cardinality(bottom_nav) between 1 and 5
    and bottom_nav <@ array[
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
