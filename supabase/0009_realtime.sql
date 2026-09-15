-- 0009: activar la réplica en vivo.
--
-- La publicación supabase_realtime venía vacía: el frontend se suscribía a los
-- cambios y la conexión se abría, pero Postgres no emitía nada, así que cada
-- usuario solo veía el trabajo de los demás al recargar la página.
--
-- RLS sigue mandando: cada suscriptor recibe únicamente las filas que sus
-- políticas le permiten ver, de modo que esto no abre datos entre organizaciones.
alter publication supabase_realtime add table
  public.leads,
  public.activities,
  public.discoveries,
  public.templates,
  public.services,
  public.quotes,
  public.quote_items,
  public.profiles,
  public.hyperfocus_campaigns,
  public.hyperfocus_records;
