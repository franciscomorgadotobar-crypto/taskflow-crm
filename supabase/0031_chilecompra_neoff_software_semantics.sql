-- 0031: corrige semántica comercial del Radar ChileCompra.
-- NEOFF es software de conectividad/telemetría/integración, no servicio de mantención.

update public.chilecompra_campaigns
set query_terms = case name
  when 'NEOFF' then array[
    'telemetria','telemetría','monitoreo remoto','supervision remota','supervisión remota',
    'iot','internet de las cosas','m2m','gateway','scada','modbus','bacnet','mqtt','opc',
    'integracion de protocolos','integración de protocolos','integracion de equipos','integración de equipos',
    'rfid','radiofrecuencia','trazabilidad rfid','software de monitoreo','plataforma de monitoreo'
  ]::text[]
  when 'TaskFlow' then array[
    'orden de trabajo','ordenes de trabajo','órdenes de trabajo','ot digital',
    'gestion de mantenimiento','gestión de mantenimiento','software de mantenimiento','sistema de mantenimiento',
    'tecnicos en terreno','técnicos en terreno','checklist','inspeccion','inspección',
    'evidencia fotografica','evidencia fotográfica','inventario de repuestos',
    'gestion de activos','gestión de activos'
  ]::text[]
  when 'TaskFlow + NEOFF' then array[
    'telemetria ordenes de trabajo','telemetría órdenes de trabajo',
    'monitoreo remoto gestion de mantenimiento','monitoreo remoto gestión de mantenimiento',
    'iot mantenimiento','rfid inventario','equipos conectados ordenes de trabajo'
  ]::text[]
  else query_terms
end,
updated_at = now()
where name in ('NEOFF','TaskFlow','TaskFlow + NEOFF');

update public.chilecompra_opportunities
set fit_score = 0,
    fit_level = 'bajo',
    matched_solutions = '{}',
    matched_capabilities = '{}',
    match_reasons = '{}',
    updated_at = now()
where radar_state = 'nuevo';
