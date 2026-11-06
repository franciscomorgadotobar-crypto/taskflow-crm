/**
 * Itinerario único de puesta en marcha para las cotizaciones PDF y Word.
 * Mantener las cinco etapas, incluida la salida a producción.
 */
export const QUOTE_IMPLEMENTATION_STEPS = Object.freeze([
  Object.freeze({ period: 'Kickoff', title: 'Inicio del proyecto', body: 'Con la reunión de inicio arranca formalmente la implementación. Activamos al superadministrador y acordamos junto al cliente el calendario de trabajo.' }),
  Object.freeze({ period: 'Semana 1', title: 'Carga de información', body: 'El cliente entrega en una planilla estándar los datos de clientes, inventario, usuarios, activos, formularios y logo. Nuestro equipo carga la información y configura la plataforma según su operación.' }),
  Object.freeze({ period: 'Semanas 2 y 3', title: 'Capacitación', body: 'Capacitamos primero al personal administrativo y luego al técnico, de acuerdo con sus funciones, para que el equipo opere TaskFlow con autonomía.' }),
  Object.freeze({ period: 'Semana 4', title: 'Marcha blanca', body: 'El equipo utiliza la plataforma en su operación real con acompañamiento de TaskFlow. Ajustamos detalles y resolvemos dudas antes del cierre de esta etapa.' }),
  Object.freeze({ period: 'Salida a producción', title: 'Operación regular', body: 'Al cerrar la marcha blanca, la plataforma queda 100% operativa. El cliente dispone de soporte permanente de lunes a viernes, de 09:00 a 18:00 hrs.' }),
]);
