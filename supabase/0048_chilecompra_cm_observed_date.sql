-- 0048: fecha de observación de cada OC CM para períodos de análisis consistentes.
alter table public.chilecompra_cm_orders
  add column if not exists observed_date date;

create index if not exists chilecompra_cm_orders_observed_idx
  on public.chilecompra_cm_orders (observed_date desc);

update public.chilecompra_cm_orders
set observed_date = coalesce(sent_at::date, created_at_mp::date, last_seen_at::date)
where observed_date is null;
