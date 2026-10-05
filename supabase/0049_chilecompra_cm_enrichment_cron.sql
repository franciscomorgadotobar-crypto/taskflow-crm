-- 0049: enriquecer progresivamente el detalle de órdenes de Convenio Marco.
-- Completa comprador, proveedor e ítems de órdenes ya detectadas sin golpear la API en paralelo.

do $$
begin
  perform cron.unschedule('chilecompra-cm-enrich');
exception when others then
  null;
end
$$;

select cron.schedule(
  'chilecompra-cm-enrich',
  '*/10 * * * *',
  $$
    select net.http_post(
      url := 'https://egglrpexexcodsreumnz.supabase.co/functions/v1/chilecompra-radar',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-radar-cron',(
          select decrypted_secret
          from vault.decrypted_secrets
          where name='chilecompra_radar_cron_key'
          order by created_at desc
          limit 1
        )
      ),
      body := '{"action":"cm-enrich","limit":8}'::jsonb,
      timeout_milliseconds := 120000
    ) as request_id;
  $$
);
