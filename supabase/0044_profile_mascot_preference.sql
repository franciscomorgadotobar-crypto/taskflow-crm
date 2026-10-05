-- 0044: preferencia persistente de mascota por usuario.
alter table public.profiles
  add column if not exists mascot_enabled boolean null;
