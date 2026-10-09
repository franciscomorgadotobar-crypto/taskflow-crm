alter table public.profiles
  add column if not exists mascot_character text not null default 'bonvallet'
  check (mascot_character in ('bonvallet','nicanor'));

update public.profiles
set mascot_character='bonvallet'
where mascot_character is null or mascot_character not in ('bonvallet','nicanor');
