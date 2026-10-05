-- 0041: tutorial ChileCompra v3 para la experiencia móvil simplificada.

update public.tutorials
set
  description = 'Busca una licitación, crea seguimientos y convierte oportunidades al CRM.',
  version = 3,
  duration_min = 4,
  roles = array['super','admin','comercial','visita']::text[],
  active = true,
  updated_at = now()
where id = 'chilecompra';
