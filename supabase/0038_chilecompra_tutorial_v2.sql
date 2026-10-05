-- 0038: actualizar el tutorial de ChileCompra para el flujo simplificado.

update public.tutorials
set
  name = 'Primeros pasos en ChileCompra',
  description = 'Crea un seguimiento, busca novedades y revisa las licitaciones que coinciden con lo que vendes.',
  version = 2,
  duration_min = 4,
  roles = array['super','admin','comercial','visita']::text[],
  sort_order = 30,
  active = true,
  updated_at = now()
where id = 'chilecompra';
