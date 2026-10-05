-- 0046: tutorial ChileCompra v5 con Convenio Marco.
update public.tutorials
set
  description = 'Busca licitaciones, analiza Convenio Marco y entiende cómo se mueve Mercado Público.',
  version = 5,
  duration_min = 6,
  roles = array['super','admin','comercial','visita']::text[],
  active = true,
  updated_at = now()
where id = 'chilecompra';
