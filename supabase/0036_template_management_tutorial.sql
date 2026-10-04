-- 0036: tutorial guiado para la administración de plantillas.

insert into public.tutorials (
  id,
  name,
  description,
  version,
  duration_min,
  roles,
  sort_order,
  active,
  updated_at
)
values (
  'gestionar_plantillas',
  'Gestionar plantillas',
  'Crea mensajes reutilizables, inserta variables y comprueba el resultado con datos reales.',
  1,
  4,
  array['super','admin']::text[],
  55,
  true,
  now()
)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  version = excluded.version,
  duration_min = excluded.duration_min,
  roles = excluded.roles,
  sort_order = excluded.sort_order,
  active = true,
  updated_at = now();
