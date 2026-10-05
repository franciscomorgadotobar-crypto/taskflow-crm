-- 0040: tutorial de Configuración actualizado para permisos por módulo.

update public.tutorials
set
  description = 'Administra usuarios, perfiles base, módulos habilitados y capacitaciones.',
  version = 3,
  duration_min = 4,
  roles = array['super','admin']::text[],
  active = true,
  updated_at = now()
where id = 'gestionar_equipo';
