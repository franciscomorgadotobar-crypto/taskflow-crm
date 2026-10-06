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
  'ChileCompra',
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
  { id: 'super', label: 'Súper administrador', detail: 'Control total del CRM. Configuración y auditoría quedan habilitadas por el perfil.' },
  { id: 'admin', label: 'Administrador', detail: 'Administra usuarios Comercial y Visita. Configuración y auditoría quedan habilitadas por el perfil.' },
  { id: 'comercial', label: 'Comercial', detail: 'Puede trabajar y editar dentro de los módulos que le habilites.' },
  { id: 'visita', label: 'Visita', detail: 'Solo lectura dentro de los módulos que le habilites.' }
];

export const USER_MODULES = [
  { id: 'dashboard', label: 'Resumen', group: 'General', detail: 'Panel general y métricas de gestión.' },
  { id: 'leads', label: 'Leads', group: 'Comercial', detail: 'Empresas nuevas antes de entrar al pipeline.' },
  { id: 'hyperfocus', label: 'Híper Foco', group: 'Comercial', detail: 'Prospección masiva y tratamiento de bases.' },
  { id: 'pipeline', label: 'Pipeline', group: 'Comercial', detail: 'Oportunidades comerciales activas.' },
  { id: 'remarketing', label: 'Remarketing', group: 'Comercial', detail: 'Prospectos para retomar más adelante.' },
  { id: 'implementation', label: 'Implementación', group: 'Operación', detail: 'Clientes ganados y puesta en marcha.' },
  { id: 'templates', label: 'Plantillas', group: 'Herramientas', detail: 'Mensajes reutilizables para comunicación.' },
  { id: 'chilecompra', label: 'ChileCompra', group: 'Comercial', detail: 'Seguimientos y oportunidades de compras públicas.' },
  { id: 'quotes', label: 'Cotizaciones', group: 'Herramientas', detail: 'Listas de precios y cotizaciones.' }
];

export const DEFAULT_USER_MODULE_IDS = USER_MODULES.map((module) => module.id);

export const DEFAULT_BOTTOM_NAV = ['dashboard', 'chilecompra', 'hyperfocus', 'pipeline', 'remarketing'];

/**
 * Mapa del flujo comercial: cada nodo es una parada del proceso, con lo que se
 * hace ahí y hacia dónde puede seguir. Alimenta el diagrama de Configuración.
 */
export const CRM_FLOW = [
  {
    id: 'hyperfocus',
    step: '0',
    title: 'Híper Foco',
    tagline: 'Bases masivas antes del CRM',
    detail: 'Zona de staging para prospectar bases CSV/Excel sin convertir miles de filas en leads. Se gestiona una empresa a la vez y solo lo que califica entra al CRM.',
    does: ['Importar y mapear bases heterogéneas', 'Consolidar empresas y detectar coincidencias con el CRM', 'Llamar, escribir, reintentar, enriquecer contactos o descartar sin salir de la sesión'],
    goes: ['<strong>Interesado</strong> → entra como prospecto en “Contactado”', '<strong>No por ahora</strong> → pasa a Remarketing', '<strong>Sin contacto</strong> → reintento dentro de Híper Foco']
  },
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
    subject: 'Presentación comercial — {{empresa}}',
    body:
      'Hola {{nombre}},\n\nQuisiera compartirte información sobre nuestra propuesta para {{empresa}}. Podemos revisar su operación, necesidades y los puntos asociados a {{dolor}} en una conversación breve y enfocada en sus procesos.\n\nSaludos,'
  },
  {
    id: 'demo',
    name: 'Coordinación de demo',
    channel: 'both',
    subject: 'Coordinemos una demo',
    body:
      'Hola {{nombre}},\n\nComo conversamos, propongo coordinar una demo enfocada en {{dolor}}. La idea es revisar el flujo real de su operación y mostrar únicamente lo que pueda aportar valor a {{empresa}}.\n\nQuedo atento a día y horario.'
  },
  {
    id: 'followup',
    name: 'Seguimiento de propuesta',
    channel: 'both',
    subject: 'Seguimiento de propuesta — {{empresa}}',
    body:
      'Hola {{nombre}},\n\nQuería hacer seguimiento a la propuesta enviada para {{empresa}}. ¿Pudieron revisarla?\n\nSi hay observaciones técnicas, comerciales o de alcance, las revisamos juntos.'
  },
  {
    id: 'reactivation',
    name: 'Reactivación de contacto frío',
    channel: 'both',
    subject: '¿Retomamos la conversación, {{nombre}}?',
    body:
      'Hola {{nombre}},\n\nQuedamos en pausa con el proyecto de {{empresa}}. Desde entonces sumamos mejoras en {{modulos}}.\n\nSi el tema sigue vigente, puedo mostrarte en 20 minutos qué cambia hoy respecto a lo que viste.'
  },
  {
    id: 'remarketing1',
    name: 'Remarketing — Seguimiento 1',
    channel: 'both',
    subject: '¿Seguimos en contacto, {{nombre}}?',
    body:
      'Hola {{nombre}},\n\nSé que por ahora no era el momento para avanzar con la propuesta en {{empresa}}. Quería dejar la puerta abierta: si la situación cambia o surge una nueva necesidad, quedo disponible para retomar la conversación cuando les acomode.\n\nUn saludo,'
  },
  {
    id: 'remarketing2',
    name: 'Remarketing — Seguimiento 2',
    channel: 'both',
    subject: 'Novedades para {{empresa}}',
    body:
      'Hola {{nombre}},\n\nTe escribo para contarte que seguimos sumando mejoras en {{modulos}}. Si el contexto en {{empresa}} cambió, me encantaría mostrarte qué hay de nuevo.\n\n¿Tenés unos minutos esta semana?'
  },
  {
    id: 'remarketing3',
    name: 'Remarketing — Seguimiento 3',
    channel: 'both',
    subject: 'Última consulta, {{nombre}}',
    body:
      'Hola {{nombre}},\n\nNo quiero ser insistente, así que este es mi último mensaje por ahora. Si en algún momento {{empresa}} necesita retomar el tema de {{dolor}}, sabés dónde encontrarme.\n\n¡Éxito con todo!'
  }
];

export const TEMPLATE_PRESET_PACKS = {
  taskflow: [
    {
      name: 'TaskFlow | Presentación',
      channel: 'both',
      subject: 'TaskFlow para {{empresa}}',
      body:
        'Hola {{nombre}},\n\nQuisiera mostrarte cómo TaskFlow puede apoyar a {{empresa}} en la gestión de órdenes de trabajo, inventario y trazabilidad de la operación. Podemos revisar el flujo actual y enfocar una demo en {{dolor}}.\n\n¿Te acomoda que coordinemos una breve reunión?'
    },
    {
      name: 'TaskFlow | Coordinación de demo',
      channel: 'both',
      subject: 'Demo TaskFlow para {{empresa}}',
      body:
        'Hola {{nombre}},\n\nCoordinemos una demo de TaskFlow enfocada en el proceso real de {{empresa}}. Revisaremos únicamente los módulos relacionados con {{dolor}} y {{modulos}}, para que la sesión sea concreta y útil.\n\nQuedo atento a día y horario.'
    },
    {
      name: 'TaskFlow | Seguimiento de demo',
      channel: 'both',
      subject: 'Seguimiento demo TaskFlow',
      body:
        'Hola {{nombre}},\n\nGracias por el tiempo en la demo. Quería saber si lo revisado en TaskFlow hace sentido para la operación de {{empresa}} y si quedó algún punto técnico o comercial pendiente.\n\nSi te parece, definimos el siguiente paso.'
    },
    {
      name: 'TaskFlow | Reactivación',
      channel: 'both',
      subject: 'Retomemos TaskFlow en {{empresa}}',
      body:
        'Hola {{nombre}},\n\nHace un tiempo conversamos sobre TaskFlow y la necesidad de mejorar {{dolor}} en {{empresa}}. Quería saber si el proyecto sigue vigente.\n\nSi cambió el escenario, podemos revisar nuevamente el alcance y mostrar las mejoras más relevantes.'
    }
  ],
  neoff: [
    {
      name: 'NEOFF | Presentación',
      channel: 'both',
      subject: 'Conectividad operacional para {{empresa}}',
      body:
        'Hola {{nombre}},\n\nQuisiera presentarte NEOFF, una propuesta orientada a conectar equipos, sensores y variables operacionales para obtener información útil en tiempo real. Podemos revisar el caso de {{empresa}} y aterrizarlo sobre {{dolor}}.\n\n¿Te acomoda una conversación breve?'
    },
    {
      name: 'NEOFF | Coordinación de demo',
      channel: 'both',
      subject: 'Demo NEOFF para {{empresa}}',
      body:
        'Hola {{nombre}},\n\nPropongo coordinar una demo de NEOFF usando un caso cercano a la operación de {{empresa}}. La idea es mostrar cómo capturar señales de equipos, integrarlas y convertirlas en estados o alertas accionables.\n\nQuedo atento a día y horario.'
    },
    {
      name: 'NEOFF | Seguimiento de demo',
      channel: 'both',
      subject: 'Seguimiento demo NEOFF',
      body:
        'Hola {{nombre}},\n\nQuería retomar lo revisado en la demo de NEOFF. ¿El caso de conectividad y monitoreo que vimos aplica a la necesidad de {{empresa}}?\n\nSi hay variables, protocolos o equipos que debamos validar, los revisamos en el siguiente paso.'
    },
    {
      name: 'NEOFF | Reactivación',
      channel: 'both',
      subject: 'Retomemos NEOFF en {{empresa}}',
      body:
        'Hola {{nombre}},\n\nHace un tiempo conversamos sobre conectividad operacional para {{empresa}}. Quería saber si la necesidad asociada a {{dolor}} sigue vigente.\n\nSi te parece, retomamos con un alcance actualizado y revisamos los equipos o señales que hoy necesitan integrar.'
    }
  ]
};

export const TEMPLATE_VARIABLES = ['{{nombre}}', '{{nombreCompleto}}', '{{empresa}}', '{{cargo}}', '{{dolor}}', '{{modulos}}', '{{responsable}}'];

/* ---------- Cotizador ---------- */

// Emisor que aparece en el encabezado de la cotización y del PDF.
export const QUOTE_ISSUER = { name: '', rut: '' };

export const CURRENCIES = ['UF', 'CLP'];

// Los id deben coincidir con los check de quotes.payment_method / payment_terms (0029).
export const PAYMENT_METHODS = [
  { id: 'transferencia', label: 'Transferencia Bancaria' },
  { id: 'pac', label: 'PAC' },
  { id: 'pat', label: 'PAT' }
];

export const PAYMENT_TERMS = [
  { id: '5_dias_habiles', label: '5 días hábiles' },
  { id: '30_dias', label: '30 días' },
  { id: '60_dias', label: '60 días' }
];

export const DISCOUNT_KINDS = [
  { id: 'percent', label: 'Porcentaje' },
  { id: 'amount', label: 'Monto' },
  { id: 'fixed_price', label: 'Precio fijo' },
  { id: 'free', label: 'Gratis' }
];

export const QUOTE_STATUSES = [
  { id: 'borrador', label: 'Borrador' },
  { id: 'enviada', label: 'Enviada' },
  { id: 'aceptada', label: 'Aceptada' },
  { id: 'rechazada', label: 'Rechazada' }
];

export const QUOTE_STATUS_LABEL = Object.fromEntries(QUOTE_STATUSES.map((s) => [s.id, s.label]));
