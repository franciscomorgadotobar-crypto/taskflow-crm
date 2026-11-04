-- Agrega alcance comercial a los servicios cuyo catálogo aún no lo incluye.
-- Respeta descripciones editadas y no reescribe versiones anteriores de cotización.
begin;
update public.price_list_items
set description = case code
    WHEN 'GE_BASE' THEN 'Plataforma web administrativa para organizar la gestión técnica.
Coordinación de trabajos, actividades y responsables desde oficina.
Consulta y seguimiento del estado de la operación.'
    WHEN 'GE_APP' THEN 'Licencia de acceso por usuario a la aplicación móvil para personal en terreno.
Consulta de las actividades de trabajo asignadas.
Registro y actualización del avance de las actividades desde el móvil.'
    WHEN 'GI_BASE' THEN 'Plataforma web para organizar y supervisar las operaciones internas.
Centralización de actividades y seguimiento de su ejecución.'
    WHEN 'GI_WEB' THEN 'Acceso web individual para técnicos o colaboradores de la operación.
Consulta y seguimiento de las actividades que les correspondan.'
    WHEN 'CFG_ADV' THEN 'Horas de configuración y adaptación de la plataforma a los requerimientos acordados.
El alcance de las tareas se define según la implementación contratada.'
    WHEN 'SETUP' THEN 'Horas de habilitación y puesta en marcha de la solución contratada.'
  else description end
where code in ('GE_BASE', 'GE_APP', 'GI_BASE', 'GI_WEB', 'CFG_ADV', 'SETUP')
  and btrim(coalesce(description, '')) = '';
commit;
