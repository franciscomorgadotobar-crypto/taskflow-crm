export const STAGES = ['Lead', 'Contactado', 'Reunión / Demo', 'Propuesta', 'Negociación', 'Ganado', 'Perdido', 'Remarketing'];
export const CLOSED_STAGES = ['Ganado', 'Perdido', 'Remarketing'];
export const OPEN_STAGES = STAGES.filter((s) => !CLOSED_STAGES.includes(s));
/** Tablero de Prospectos: todo lo calificado, sin Lead (vive en Leads) ni Remarketing (vive en su propia sección). */
export const PIPELINE_STAGES = STAGES.filter((s) => s !== 'Lead' && s !== 'Remarketing');

/** Motivos por los que un prospecto pasa a Remarketing: un "no" temporal, no definitivo. */
export const REMARKETING_REASONS = [
  'No es el momento',
  'Revisar el próximo año',
  'Sin presupuesto por ahora',
  'Prioridades internas cambiaron',
  'Otro'
];

/** Plantilla sugerida por defecto al escribirle a un contacto, según la etapa de su oportunidad. */
export const STAGE_TEMPLATE = {
  Lead: 'general',
  Contactado: 'general',
  'Reunión / Demo': 'demo',
  Propuesta: 'followup',
  Negociación: 'followup',
  Ganado: 'general',
  Perdido: 'reactivation',
  Remarketing: 'remarketing1'
};

export const DEFAULT_PROBABILITY = {
  Lead: 5,
  Contactado: 15,
  'Reunión / Demo': 35,
  Propuesta: 55,
  Negociación: 75,
  Ganado: 100,
  Perdido: 0,
  Remarketing: 10
};

export const INDUSTRIES = [
  'HVAC / Climatización',
  'Ascensores / Transporte vertical',
  'Grupos electrógenos',
  'Facility Management',
  'Construcción / Instalaciones',
  'Telecomunicaciones',
  'Servicios técnicos / Laboratorio',
  'Seguridad industrial',
  'Equipos médicos',
  'Arriendo de maquinaria',
  'Educación',
  'Reparación / Postventa',
  'Otro'
];

export const SOURCES = [
  'Prospección en frío',
  'Referido',
  'Web',
  'Google Ads',
  'LinkedIn',
  'Evento / Feria',
  'Base de datos',
  'Cliente existente',
  'Otro'
];

export const BUY_TRIGGERS = [
  'Nuevo contrato o licitación',
  'Crecimiento de cuadrillas',
  'Auditoría o certificación',
  'Incidente, reclamo o multa',
  'Cambio de jefatura',
  'Implementación de ERP',
  'Pérdida de inventario',
  'Presupuesto anual',
  'Otro'
];

export const MODULES = [
  'Órdenes de trabajo',
  'Técnicos en terreno',
  'Equipos / Activos',
  'Inventario / Bodegas',
  'Checklists / Formularios',
  'Fotografías / Firmas',
  'Geolocalización',
  'Trazabilidad / Reportes',
  'Laboratorio técnico',
  'Integraciones / API'
];

export const LOSS_REASONS = [
  'Precio fuera de presupuesto',
  'Eligió a un competidor',
  'Sin urgencia / lo postergaron',
  'No calificaba (tamaño u operación)',
  'Resolvió con desarrollo interno',
  'Sin respuesta del contacto',
  'Cambio de prioridades',
  'Otro'
];

export const ACTIVITY_TYPES = ['Llamada', 'Reunión', 'Demo', 'Correo', 'WhatsApp', 'Seguimiento', 'Propuesta', 'Otro'];

/**
 * Tipos de la siguiente tarea. Se eligen con botón, no se escriben: así la tarea
 * queda como un dato uniforme y el texto libre vive en la nota.
 */
export const TASK_TYPES = [
  { value: 'Llamada', label: 'Llamar' },
  { value: 'WhatsApp', label: 'WhatsApp' },
  { value: 'Correo', label: 'Correo' }
];

export const CURRENT_MANAGEMENT = ['WhatsApp / papel', 'Excel / formularios', 'Software parcial', 'ERP / CMMS integrado'];

/**
 * Equipo comercial precargado. Sin contraseñas: el sitio es público y todo lo que
 * viva en el código queda a la vista. Se definen en Configuración.
 */
export const DEFAULT_PROFILE = {
  name: 'Francisco Morgado',
  email: 'franciscomorgado@taskflow.cl',
  phone: '+56939453804',
  password: ''
};

export const DEFAULT_USERS = [
  { name: 'Cristóbal', email: '', phone: '', role: 'comercial', active: true },
  { name: 'Yazmín', email: '', phone: '', role: 'comercial', active: true },
  { name: 'Paula', email: '', phone: '', role: 'comercial', active: true }
];

/** Dimensiones que puede mostrar cada gráfico del resumen. */
export const CHART_DIMENSIONS = [
  { id: 'stage', label: 'Etapa', title: 'Prospectos por etapa' },
  { id: 'taskState', label: 'Estado de la tarea', title: 'Prospectos por estado de la tarea' },
  { id: 'taskType', label: 'Tipo de tarea', title: 'Tareas por tipo' },
  { id: 'industry', label: 'Rubro', title: 'Prospectos por rubro' },
  { id: 'owner', label: 'Responsable', title: 'Prospectos por responsable' },
  { id: 'source', label: 'Origen', title: 'Prospectos por origen' }
];

/** Perfiles de acceso. El detalle describe qué puede hacer cada uno dentro del CRM. */
export const USER_ROLES = [
  { id: 'super', label: 'Súper administrador', detail: 'Control total: configuración, usuarios, datos y borrado.' },
  { id: 'admin', label: 'Administrador', detail: 'Gestiona oportunidades, plantillas y respaldos. No administra usuarios.' },
  { id: 'comercial', label: 'Comercial', detail: 'Trabaja sus leads, actividades y comunicación. Sin acceso a configuración.' },
  { id: 'visita', label: 'Visita', detail: 'Solo lectura: puede mirar el embudo y los reportes, sin editar.' }
];

/**
 * Mapa del flujo comercial: cada nodo es una parada del proceso, con lo que se
 * hace ahí y hacia dónde puede seguir. Alimenta el diagrama de Configuración.
 */
export const CRM_FLOW = [
  {
    id: 'leads',
    step: '1',
    title: 'Leads',
    tagline: 'Empresas sin calificar',
    detail: 'Puerta de entrada. Todo contacto nuevo nace acá con la etapa “Lead” y todavía no cuenta como oportunidad del embudo.',
    does: ['Crear la empresa con su contacto principal', 'Sumar más contactos de la misma empresa', 'Registrar actividades y llamar, escribir o mandar WhatsApp', 'Completar el levantamiento comercial'],
    goes: ['<strong>Calificar</strong> → entra al Embudo Comercial en “Contactado”', 'Eliminar si no aplica']
  },
  {
    id: 'pipeline',
    step: '2',
    title: 'Embudo Comercial',
    tagline: 'Contactado → Reunión / Demo → Propuesta → Negociación',
    detail: 'El tablero de las oportunidades vivas. Se ve como embudo (arrastrando tarjetas) o como lista con filtros y exportación a Excel.',
    does: ['Mover de etapa arrastrando o desde la ficha', 'Registrar actividades con su próxima acción', 'Enviar mensajes con plantillas', 'Exportar la vista filtrada a Excel'],
    goes: ['<strong>Ganado</strong> → pasa a Implementación', '<strong>Perdido</strong> → pide motivo y queda archivado', '<strong>Remarketing</strong> → si el “no” es temporal']
  },
  {
    id: 'remarketing',
    step: '3',
    title: 'Remarketing',
    tagline: 'El “no” temporal',
    detail: 'Prospectos que dijeron “ahora no”, “el próximo año” o “sin presupuesto”. No se pierden: quedan en lista con su motivo para retomarlos cuando corresponda.',
    does: ['Guardar el motivo del “no” temporal', 'Enviar los correos de seguimiento 1, 2 y 3', 'Agendar cuándo retomar'],
    goes: ['<strong>Pasar a prospecto</strong> → vuelve al Embudo en “Contactado”', 'Mover a cualquier otra etapa']
  },
  {
    id: 'implementation',
    step: '4',
    title: 'Implementación',
    tagline: 'Clientes ganados',
    detail: 'Las oportunidades ganadas pasan a puesta en marcha, con el alcance que quedó registrado en el levantamiento.',
    does: ['Ver el alcance y las integraciones levantadas', 'Coordinar el kick-off', 'Seguir registrando actividades'],
    goes: ['Se mantiene como cliente activo']
  }
];

/** Piezas que cruzan todo el flujo, no una etapa puntual. */
export const CRM_CROSS = [
  {
    title: 'Actividades y tareas',
    detail: 'Cada actividad (llamada, reunión, demo, correo…) puede dejar una <strong>próxima acción con fecha</strong>. Esa fecha es la que agenda la tarea y define si está vencida. Al marcarla realizada el CRM pide el resultado y cuál es la siguiente.'
  },
  {
    title: 'Resumen',
    detail: 'Junta todas las tareas abiertas del CRM en tres pestañas: <strong>Vencidas</strong> (ya pasó su fecha o no tienen), <strong>Próximas a vencer</strong> (hoy o mañana) y <strong>Agendadas</strong> (más adelante). “Gestionar” las recorre una por una.'
  },
  {
    title: 'Comunicación y plantillas',
    detail: 'Las plantillas se escriben en su propia sección con variables que se completan solas. El envío siempre ocurre en la ficha de la empresa, eligiendo contacto y canal (llamada, WhatsApp o correo), y queda registrado como actividad.'
  },
  {
    title: 'Levantamiento',
    detail: 'Vive dentro de cada ficha: dolor, gestión actual, tamaño del equipo, módulos de interés e integraciones. Alimenta las variables de las plantillas y el alcance que se ve en Implementación.'
  }
];

export const TEMPLATE_CHANNELS = [
  { id: 'both', label: 'WhatsApp + Correo' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'email', label: 'Correo' }
];

export const DEFAULT_TEMPLATES = [
  {
    id: 'general',
    name: 'Presentación general',
    channel: 'both',
    subject: 'TaskFlow — gestión de OTs, inventario y operación técnica',
    body:
      'Hola {{contacto}},\n\nQuisiera presentarte TaskFlow, una plataforma modular para centralizar órdenes de trabajo, técnicos en terreno, equipos, inventario, checklists, evidencias y trazabilidad operativa.\n\nPodemos revisar la operación de {{empresa}} en una demo breve y enfocada en sus procesos.\n\nSaludos,\n{{responsable}}'
  },
  {
    id: 'demo',
    name: 'Coordinación de demo',
    channel: 'both',
    subject: 'Coordinemos una demo de TaskFlow',
    body:
      'Hola {{contacto}},\n\nComo conversamos, propongo coordinar una demo de TaskFlow enfocada en {{dolor}}. La idea es revisar el flujo real de su operación y mostrar solo los módulos que les aportan valor: {{modulos}}.\n\nQuedo atento a día y horario.\n\n{{responsable}}'
  },
  {
    id: 'followup',
    name: 'Seguimiento de propuesta',
    channel: 'both',
    subject: 'Seguimiento propuesta TaskFlow — {{empresa}}',
    body:
      'Hola {{contacto}},\n\nQuería hacer seguimiento a la propuesta de TaskFlow enviada para {{empresa}}. ¿Pudieron revisarla?\n\nSi hay observaciones técnicas, comerciales o de alcance, las revisamos juntos.\n\n{{responsable}}'
  },
  {
    id: 'reactivation',
    name: 'Reactivación de contacto frío',
    channel: 'both',
    subject: '¿Retomamos la conversación, {{contacto}}?',
    body:
      'Hola {{contacto}},\n\nQuedamos en pausa con el proyecto de {{empresa}}. Desde entonces sumamos mejoras en {{modulos}}.\n\nSi el tema sigue vigente, puedo mostrarte en 20 minutos qué cambia hoy respecto a lo que viste.\n\n{{responsable}}'
  },
  {
    id: 'remarketing1',
    name: 'Remarketing — Seguimiento 1',
    channel: 'both',
    subject: '¿Seguimos en contacto, {{contacto}}?',
    body:
      'Hola {{contacto}},\n\nSé que por ahora no era el momento para avanzar con TaskFlow en {{empresa}}. Quería dejar la puerta abierta: si la situación cambia o surge una nueva necesidad, quedo disponible para retomar la conversación cuando les acomode.\n\nUn saludo,\n{{responsable}}'
  },
  {
    id: 'remarketing2',
    name: 'Remarketing — Seguimiento 2',
    channel: 'both',
    subject: 'Novedades de TaskFlow para {{empresa}}',
    body:
      'Hola {{contacto}},\n\nTe escribo para contarte que seguimos sumando mejoras en {{modulos}}. Si el contexto en {{empresa}} cambió, me encantaría mostrarte qué hay de nuevo.\n\n¿Tenés unos minutos esta semana?\n\n{{responsable}}'
  },
  {
    id: 'remarketing3',
    name: 'Remarketing — Seguimiento 3',
    channel: 'both',
    subject: 'Última consulta, {{contacto}}',
    body:
      'Hola {{contacto}},\n\nNo quiero ser insistente, así que este es mi último mensaje por ahora. Si en algún momento {{empresa}} necesita retomar el tema de {{dolor}}, sabés dónde encontrarme.\n\n¡Éxito con todo!\n\n{{responsable}}'
  }
];

export const TEMPLATE_VARIABLES = ['{{contacto}}', '{{empresa}}', '{{cargo}}', '{{dolor}}', '{{modulos}}', '{{responsable}}'];
