/**
 * Nombres y alcances explicados para quien recibe una cotización sin haber
 * asistido a una demostración comercial. No interviene en precios ni cálculos.
 * La descripción guardada en la versión tiene prioridad sobre los textos base.
 */
export const CLIENT_SERVICE_NAMES = Object.freeze({
  GE_BASE: 'Gestión Externa - Plan Base (plataforma web administrativa para gestión técnica)',
  GE_APP: 'Gestión Externa - Usuario App (aplicación móvil para gestión de trabajos en terreno)',
  GI_BASE: 'Gestión Interna - Plan Base (plataforma web para coordinar operaciones internas)',
  GI_WEB: 'Gestión Interna - Usuario Web (acceso para técnicos y colaboradores)',
  INV_ENTRADA: 'Inventario - Plan Entrada',
  INV_BASICO: 'Inventario - Plan Básico',
  INV_MEDIO: 'Inventario - Plan Medio',
  INV_AVANZADO: 'Inventario - Plan Avanzado',
  INV_FULL: 'Inventario - Plan Full',
  INV_APP: 'Inventario - Acceso móvil',
  INV_USER_ADD: 'Inventario - Usuario adicional',
  INV_ALMACEN_ADD: 'Inventario - Almacén adicional',
  INV_DEP: 'Inventario - Valorización y depreciación',
  STORAGE_1GB: 'Almacenamiento adicional de documentos (1 GB)',
  SETUP: 'Puesta en marcha asistida (por hora)',
  CFG_ADV: 'Configuración avanzada de la plataforma (por hora)',
  TRAIN_REM: 'Capacitación en línea (por hora)',
  TRAIN_PRE_RM: 'Capacitación presencial en Santiago'
});

export const CLIENT_SERVICE_SCOPES = Object.freeze({
  GE_BASE: [
    'Acceso a plataforma web administrativa para organizar la gestión técnica.',
    'Coordinación de trabajos, actividades y responsables desde oficina.',
    'Consulta y seguimiento del estado de la operación.'
  ].join('\n'),
  GE_APP: [
    'Licencia de acceso por usuario a la aplicación móvil para personal en terreno.',
    'Consulta de las actividades de trabajo asignadas.',
    'Registro y actualización del avance de las actividades desde el móvil.'
  ].join('\n'),
  GI_BASE: [
    'Plataforma web para organizar y supervisar las operaciones internas.',
    'Centralización de actividades y seguimiento de su ejecución.'
  ].join('\n'),
  GI_WEB: [
    'Acceso web individual para técnicos o colaboradores de la operación.',
    'Consulta y seguimiento de las actividades que les correspondan.'
  ].join('\n'),
  INV_ENTRADA: [
    'Hasta 200 ítems de inventario',
    '1 usuario incluido',
    '1 almacén',
    'Almacenamiento: 0,5 GB',
    'Almacenes flotantes habilitados'
  ].join('\n'),
  INV_BASICO: [
    'Hasta 500 ítems de inventario',
    '2 usuarios incluidos',
    '2 almacenes',
    'Hasta 250 equipos seriados',
    'Almacenamiento: 2 GB',
    'Almacenes flotantes y gestión de activos incluidos'
  ].join('\n'),
  INV_MEDIO: [
    'Hasta 1.000 ítems de inventario',
    '5 usuarios incluidos',
    '3 almacenes',
    'Hasta 1.000 equipos seriados',
    'Almacenamiento: 5 GB',
    'Almacenes flotantes y gestión de activos incluidos'
  ].join('\n'),
  INV_AVANZADO: [
    'Hasta 3.500 ítems de inventario',
    '12 usuarios incluidos',
    '6 almacenes',
    'Hasta 2.500 equipos seriados',
    'Almacenamiento: 10 GB',
    'Almacenes flotantes, gestión de activos, valorización y depreciación incluidos'
  ].join('\n'),
  INV_FULL: [
    'Ítems de inventario ilimitados desde 10.000',
    'Hasta 9.999 usuarios',
    '15 almacenes',
    'Hasta 20.000 equipos seriados',
    'Almacenamiento: 15 GB',
    'Almacenes flotantes, gestión de activos, valorización y depreciación incluidos'
  ].join('\n'),
  CFG_ADV: [
    'Horas de configuración y adaptación de la plataforma a los requerimientos acordados.',
    'El alcance de las tareas se define según la implementación contratada.'
  ].join('\n'),
  SETUP: 'Horas de habilitación y puesta en marcha de la solución contratada.',
  INV_APP: 'Acceso móvil adicional para usuarios de la gestión de inventario.',
  INV_USER_ADD: 'Capacidad para incorporar un usuario adicional a Inventario.',
  INV_ALMACEN_ADD: 'Capacidad para incorporar una ubicación de almacenamiento adicional.',
  INV_DEP: 'Funcionalidad de valorización y depreciación de activos registrados.',
  STORAGE_1GB: 'Ampliación de almacenamiento documental en 1 GB.',
  TRAIN_REM: 'Horas de capacitación a distancia en el uso de la solución.',
  TRAIN_PRE_RM: 'Capacitación presencial en Santiago, según horas contratadas.'
});

const fmtCount = (n) => new Intl.NumberFormat('es-CL', {maximumFractionDigits: 0}).format(Number(n) || 0);

export function clientServiceName(item = {}) {
  const code = String(item.code || '');
  if (CLIENT_SERVICE_NAMES[code]) return CLIENT_SERVICE_NAMES[code];
  if (/^PACK_INV_\d+$/.test(code))
    return 'Inventario - capacidad adicional para ' + fmtCount(code.slice(9)) + ' ítems';
  if (/^PACK_SER_\d+$/.test(code))
    return 'Capacidad adicional para ' + fmtCount(code.slice(9)) + ' equipos seriados';
  return String(item.name || 'Servicio contratado');
}

export function clientServiceScope(item = {}) {
  const explicit = String(item.description || '').trim();
  if (explicit) return explicit;
  const code = String(item.code || '');
  if (CLIENT_SERVICE_SCOPES[code]) return CLIENT_SERVICE_SCOPES[code];
  if (/^PACK_INV_\d+$/.test(code))
    return 'Amplía la capacidad contratada en ' + fmtCount(code.slice(9)) + ' ítems de inventario.';
  if (/^PACK_SER_\d+$/.test(code))
    return 'Amplía la capacidad contratada en ' + fmtCount(code.slice(9)) + ' equipos seriados.';
  return 'Servicio contratado según la cantidad y condiciones de esta propuesta. El alcance específico se confirma con la implementación.';
}

export function clientServiceQuantity(item = {}) {
  const quantity = fmtCount(item.quantity || 0);
  const code = String(item.code || '');
  if (code === 'GE_APP' || code === 'GI_WEB' || code === 'INV_APP' || code === 'INV_USER_ADD')
    return quantity + (Number(item.quantity) === 1 ? ' acceso de usuario' : ' accesos de usuario');
  if (code === 'CFG_ADV' || code === 'SETUP' || code.startsWith('TRAIN_'))
    return quantity + (Number(item.quantity) === 1 ? ' hora contratada' : ' horas contratadas');
  if (/^(INV_(ENTRADA|BASICO|MEDIO|AVANZADO|FULL)|GE_BASE|GI_BASE)$/.test(code))
    return quantity + (Number(item.quantity) === 1 ? ' plan contratado' : ' planes contratados');
  return quantity + (Number(item.quantity) === 1 ? ' unidad contratada' : ' unidades contratadas');
}
