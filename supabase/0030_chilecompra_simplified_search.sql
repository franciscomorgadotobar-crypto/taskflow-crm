-- 0030: simplifica ChileCompra a búsqueda tradicional y tres campañas fijas.
delete from public.chilecompra_campaign_matches;
delete from public.chilecompra_campaigns;

insert into public.chilecompra_campaigns
  (organization_id, name, product_scope, query_terms, priority, active, system_seed, created_by)
select o.id, seed.name, seed.product_scope, seed.query_terms, 'alta', true, true, null
from public.organizations o
cross join (
  values
    (
      'NEOFF',
      array['NEOFF']::text[],
      array[
        'telemetria','telemetría','iot','internet de las cosas','sensor','sensores',
        'monitoreo remoto','supervision remota','supervisión remota','scada','modbus',
        'bacnet','mqtt','opc','gateway','rfid','radiofrecuencia','control balistico',
        'control balístico','armamento','municion','munición','variables operacionales',
        'medicion remota','medición remota','automatizacion','automatización'
      ]::text[]
    ),
    (
      'TaskFlow',
      array['TaskFlow']::text[],
      array[
        'orden de trabajo','ordenes de trabajo','órdenes de trabajo','ot digital',
        'mantenimiento','mantenimiento preventivo','mantenimiento correctivo',
        'servicio tecnico','servicio técnico','tecnicos en terreno','técnicos en terreno',
        'checklist','inspeccion','inspección','evidencia fotografica','evidencia fotográfica',
        'inventario','repuestos','gestion de activos','gestión de activos',
        'laboratorio tecnico','laboratorio técnico','diagnostico','diagnóstico','reparacion','reparación'
      ]::text[]
    ),
    (
      'TaskFlow + NEOFF',
      array['TaskFlow','NEOFF']::text[],
      array[
        'hvac','climatizacion','climatización','aire acondicionado','grupo electrogeno',
        'grupo electrógeno','grupos electrogenos','grupos electrógenos','telecomunicaciones',
        'fibra optica','fibra óptica','ascensor','ascensores','transporte vertical',
        'facility','infraestructura critica','infraestructura crítica','mineria','minería',
        'tunel','túnel','tuneles','túneles','planta industrial','linea de produccion',
        'línea de producción','utilities'
      ]::text[]
    )
) as seed(name, product_scope, query_terms)
on conflict (organization_id, name) do update
set product_scope=excluded.product_scope,
    query_terms=excluded.query_terms,
    priority='alta',
    active=true,
    system_seed=true,
    created_by=null,
    updated_at=now();
