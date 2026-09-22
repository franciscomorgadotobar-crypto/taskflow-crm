-- 0012: invariantes de versionado de cotizaciones.
--
-- Evita que una misma cadena de versiones termine con más de una cotización
-- vigente por escrituras concurrentes. La versión inicial usa root_id NULL y
-- las siguientes apuntan al id de esa primera versión.

create unique index if not exists quotes_one_current_per_root_idx
  on public.quotes ((coalesce(root_id, id)))
  where is_current = true;

create unique index if not exists quotes_one_version_per_root_idx
  on public.quotes ((coalesce(root_id, id)), version);
