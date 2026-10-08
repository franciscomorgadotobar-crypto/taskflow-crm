alter table public.price_lists
  alter column commercial_info
  set default '["Soporte 24/7","Implementación guiada por 1 mes","Marketing conjunto incluido (opcional)"]'::jsonb;

update public.price_lists
set commercial_info='["Soporte 24/7","Implementación guiada por 1 mes","Marketing conjunto incluido (opcional)"]'::jsonb,
    updated_at=now()
where commercial_info='[]'::jsonb;
