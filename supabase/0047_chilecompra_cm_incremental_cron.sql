-- 0047: ajustar sincronización Convenio Marco a lotes seguros e incrementales.
do $$
begin
  perform cron.unschedule('chilecompra-cm-sync');
exception when others then
  null;
end
$$;

do $$
begin
  perform cron.unschedule('chilecompra-cm-yesterday');
exception when others then
  null;
end
$$;

select cron.schedule(
  'chilecompra-cm-sync',
  '20 */2 * * *',
  $$
    select net.http_post(
      url := 'https://egglrpexexcodsreumnz.supabase.co/functions/v1/chilecompra-radar',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-radar-cron',(
          select decrypted_secret from vault.decrypted_secrets
          where name='chilecompra_radar_cron_key'
          order by created_at desc limit 1
        )
      ),
      body := '{"action":"cm-sync","days":1,"detailLimit":24,"offsetDays":0}'::jsonb,
      timeout_milliseconds := 120000
    ) as request_id;
  $$
);

select cron.schedule(
  'chilecompra-cm-yesterday',
  '10 2 * * *',
  $$
    select net.http_post(
      url := 'https://egglrpexexcodsreumnz.supabase.co/functions/v1/chilecompra-radar',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-radar-cron',(
          select decrypted_secret from vault.decrypted_secrets
          where name='chilecompra_radar_cron_key'
          order by created_at desc limit 1
        )
      ),
      body := '{"action":"cm-sync","days":1,"detailLimit":24,"offsetDays":1}'::jsonb,
      timeout_milliseconds := 120000
    ) as request_id;
  $$
);
