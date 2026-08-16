export const STAGES = ['Lead', 'Contactado', 'Reunión / Demo', 'Propuesta', 'Negociación', 'Ganado', 'Perdido'];
export const CLOSED_STAGES = ['Ganado', 'Perdido'];
export const OPEN_STAGES = STAGES.filter((s) => !CLOSED_STAGES.includes(s));
/** Tablero de Prospectos: todo lo calificado, sin la etapa Lead (que vive en la sección Leads). */
export const PIPELINE_STAGES = STAGES.filter((s) => s !== 'Lead');

/** Plantilla sugerida por defecto al escribirle a un contacto, según la etapa de su oportunidad. */
export const STAGE_TEMPLATE = {
  Lead: 'general',
  Contactado: 'general',
  'Reunión / Demo': 'demo',
  Propuesta: 'followup',
  Negociación: 'followup',
  Ganado: 'general',
  Perdido: 'reactivation'
};

export const DEFAULT_PROBABILITY = {
  Lead: 5,
  Contactado: 15,
  'Reunión / Demo': 35,
  Propuesta: 55,
  Negociación: 75,
  Ganado: 100,
  Perdido: 0
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

export const FILE_TYPES = ['Propuesta', 'Cotización', 'Presentación', 'Contrato', 'Levantamiento', 'Otro'];

export const CURRENT_MANAGEMENT = ['WhatsApp / papel', 'Excel / formularios', 'Software parcial', 'ERP / CMMS integrado'];

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
  }
];

export const TEMPLATE_VARIABLES = ['{{contacto}}', '{{empresa}}', '{{cargo}}', '{{dolor}}', '{{modulos}}', '{{responsable}}'];
