alter table public.profiles
  add column if not exists mobile_nav_mode text not null default 'drawer';

alter table public.profiles
  add column if not exists mobile_menu_position text not null default 'left';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_mobile_nav_mode_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_mobile_nav_mode_check
      check (mobile_nav_mode in ('drawer','bottom'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_mobile_menu_position_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_mobile_menu_position_check
      check (mobile_menu_position in ('left','right'));
  end if;
end $$;
