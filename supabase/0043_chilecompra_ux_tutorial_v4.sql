-- 0043: tutorial ChileCompra v4 para navegación visible, pulso de mercado y detalle en página.

update public.tutorials
set
  description = 'Busca licitaciones, sigue oportunidades y entiende cómo se mueve Mercado Público.',
  version = 4,
  duration_min = 5,
  roles = array['super','admin','comercial','visita']::text[],
  active = true,
  updated_at = now()
where id = 'chilecompra';
