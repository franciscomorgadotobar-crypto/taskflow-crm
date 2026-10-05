-- 0037: separar Mi cuenta de Configuración y publicar la segunda versión
-- del tutorial administrativo.

update public.tutorials
set
  name = 'Configuración y equipo',
  description = 'Administra usuarios, permisos, capacitaciones y las opciones generales del CRM.',
  version = 2,
  duration_min = 4,
  roles = array['super','admin']::text[],
  sort_order = 60,
  active = true,
  updated_at = now()
where id = 'gestionar_equipo';
