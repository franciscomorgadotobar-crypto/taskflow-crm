/*
 * TaskFlow Defender - pricing based on the Las Condes v2 workbook (10 Nov 2026).
 * Source workbook: Cotizacion_TaskFlow_Defender_Las_Condes_v2.xlsx
 * All prices are NET UF. The workbook calls hardware "UF/month" in its
 * parameter sheet, but its quote summary divides hardware by 12.
 * Both interpretations are therefore explicit, not silently conflated.
 */
export const DEFENDER_HARDWARE = [
  { key: 'tunnel', code: 'DEF_HW_TUNNEL', name: 'Túnel RFID Defender (huella, QR y computador)', price: 90 },
  { key: 'controller', code: 'DEF_HW_CONTROL', name: 'Controlador RFID TaskFlow', price: 35 },
  { key: 'indoor', code: 'DEF_HW_INDOOR', name: 'Antena RFID interior', price: 8 },
  { key: 'outdoor', code: 'DEF_HW_OUTDOOR', name: 'Antena RFID exterior IP67', price: 10 },
  { key: 'alarm', code: 'DEF_HW_ALARM', name: 'Kit alarma (sirena y baliza)', price: 4 },
  { key: 'biometric', code: 'DEF_HW_BIOMETRIC', name: 'Lector biométrico de enrolamiento', price: 5 },
  { key: 'portable', code: 'DEF_HW_PORTABLE', name: 'Lector RFID portátil', price: 5 },
  { key: 'printer', code: 'DEF_HW_PRINTER', name: 'Codificador / impresora RFID', price: 10 },
  { key: 'ups', code: 'DEF_HW_UPS', name: 'UPS', price: 6 },
  { key: 'router', code: 'DEF_HW_ROUTER', name: 'Router 4G respaldo', price: 2 }
];

export const DEFENDER_TAGS = [
  { key: 'tagMini', code: 'DEF_TAG_MINI', name: 'Tag on-metal mini (cámaras corporales)', price: 0.15 },
  { key: 'tagStandard', code: 'DEF_TAG_STD', name: 'Tag on-metal estándar (radios)', price: 0.14 },
  { key: 'tagTextile', code: 'DEF_TAG_TEXT', name: 'Tag textil (chalecos)', price: 0.10 }
];

export const DEFENDER_IMPLEMENTATION = [
  { key: 'sites', code: 'DEF_SETUP_SITE', name: 'Instalación, configuración y capacitación (por local)', price: 400 },
  { key: 'tagged', code: 'DEF_SETUP_TAGGED', name: 'Etiquetado y registro (por elemento)', price: 0.10 }
];

export const DEFENDER_SOFTWARE = [
  { key: 'tier1', code: 'DEF_SW_001_100', name: 'Software Defender · usuarios 1 a 100', price: 1 },
  { key: 'tier2', code: 'DEF_SW_101_500', name: 'Software Defender · usuarios 101 a 500', price: 0.8 },
  { key: 'tier3', code: 'DEF_SW_501_PLUS', name: 'Software Defender · usuarios sobre 500', price: 0.65 }
];

export const DEFENDER_DEFAULT = {
  users: 100, sites: 1, months: 12, hardwareMode: 'reference',
  tunnel: 1, controller: 1, indoor: 2, outdoor: 2,
  alarm: 2, biometric: 1, portable: 1, printer: 0, ups: 1, router: 1,
  tagMini: 100, tagStandard: 100, tagTextile: 100
};

export const DEFENDER_MONTHS = [12, 24, 36];
export const DEFENDER_SOURCE = 'TaskFlow Defender - Las Condes v2 (10-11-2026)';

const whole = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1000000, Math.floor(n))) : fallback;
};
const round10 = (n) => Math.round((n + Number.EPSILON) * 1e10) / 1e10;
export const defenderConfig = (input = {}) => {
  const config = { ...DEFENDER_DEFAULT, ...input };
  const out = { users: Math.max(1, whole(config.users, 100)), sites: Math.max(1, whole(config.sites, 1)) };
  out.months = DEFENDER_MONTHS.includes(Number(config.months)) ? Number(config.months) : 12;
  out.hardwareMode = config.hardwareMode === 'monthly' ? 'monthly' : 'reference';
  for (const part of [...DEFENDER_HARDWARE, ...DEFENDER_TAGS]) out[part.key] = whole(config[part.key]);
  return out;
};

export function defenderSoftwareQuantities(users) {
  const n = Math.max(1, whole(users, 1));
  return {
    tier1: Math.min(n, 100),
    tier2: Math.max(0, Math.min(n - 100, 400)),
    tier3: Math.max(0, n - 500)
  };
}

export function defenderPriceListName(configInput) {
  const config = defenderConfig(configInput);
  const mode = config.hardwareMode === 'monthly' ? 'arriendo mensual' : 'referencia Las Condes';
  return 'TaskFlow Defender · ' + mode + ' · ' + config.months + ' meses';
}

/** Returns catalogue items with the exact unit tariff applicable to the chosen duration. */
export function defenderPriceListItems(configInput) {
  const c = defenderConfig(configInput);
  const term = c.months;
  const hardwareFactor = c.hardwareMode === 'monthly' ? 1 : 1 / term;
  const descHardware = c.hardwareMode === 'monthly'
    ? 'Arriendo mensual de hardware; incluye mantención y garantía durante el contrato.'
    : 'Cuota mensual prorrateada de hardware según el resumen de la referencia Las Condes; incluye mantención y garantía. Validar modalidad comercial antes de ofertar.';
  const rows = [
    ...DEFENDER_HARDWARE.map((x) => ({ ...x, group: 'Hardware RFID', price: round10(x.price * hardwareFactor), description: descHardware })),
    ...DEFENDER_TAGS.map((x) => ({ ...x, group: 'Tags RFID', price: round10(x.price / term), description: 'Cuota mensual del tag, distribuida en ' + term + ' meses.' })),
    ...DEFENDER_IMPLEMENTATION.map((x) => ({ ...x, group: 'Implementación', price: round10(x.price / term), description: 'Implementación prorrateada en ' + term + ' cuotas mensuales, sin pago inicial.' })),
    ...DEFENDER_SOFTWARE.map((x) => ({ ...x, group: 'Software Defender', description: 'Tarifa mensual por usuario activo del tramo indicado. Incluye soporte 8×5.' }))
  ];
  return rows.map((x, index) => ({
    code: x.code, name: x.name, description: x.description,
    category: x.group, periodicity: 'mensual', active: true,
    position: index, price: x.price
  }));
}

export function defenderQuoteLines(input = {}) {
  const c = defenderConfig(input);
  const tier = defenderSoftwareQuantities(c.users);
  const tagged = DEFENDER_TAGS.reduce((n, item) => n + c[item.key], 0);
  return [
    ...DEFENDER_HARDWARE.map((x) => ({ code: x.code, quantity: c[x.key] })),
    ...DEFENDER_TAGS.map((x) => ({ code: x.code, quantity: c[x.key] })),
    { code: 'DEF_SETUP_SITE', quantity: c.sites },
    { code: 'DEF_SETUP_TAGGED', quantity: tagged },
    ...DEFENDER_SOFTWARE.map((x) => ({ code: x.code, quantity: tier[x.key] }))
  ].filter((x) => x.quantity > 0);
}

export function calculateDefender(input = {}) {
  const c = defenderConfig(input);
  const hardwareReference = DEFENDER_HARDWARE.reduce((n, x) => n + c[x.key] * x.price, 0);
  const tagsReference = DEFENDER_TAGS.reduce((n, x) => n + c[x.key] * x.price, 0);
  const tagged = DEFENDER_TAGS.reduce((n, x) => n + c[x.key], 0);
  const implementationReference = 400 * c.sites + 0.10 * tagged;
  const tier = defenderSoftwareQuantities(c.users);
  const software = DEFENDER_SOFTWARE.reduce((n, x) => n + tier[x.key] * x.price, 0);
  const hardware = c.hardwareMode === 'monthly' ? hardwareReference : hardwareReference / c.months;
  const tags = tagsReference / c.months;
  const implementation = implementationReference / c.months;
  return {
    config: c, tagged, softwareTierUsers: tier, hardwareReference, tagsReference,
    implementationReference, hardware, tags, implementation, software,
    monthlyNet: hardware + tags + implementation + software,
    contractNet: (hardware + tags + implementation + software) * c.months,
    monthlyWithVat: (hardware + tags + implementation + software) * 1.19,
    lines: defenderQuoteLines(c)
  };
}

export function defenderNotes(input = {}) {
  const c = defenderConfig(input);
  const model = c.hardwareMode === 'monthly'
    ? 'hardware en arriendo mensual'
    : 'hardware prorrateado según referencia Las Condes (validar antes de emitir)';
  return [
    'TaskFlow Defender · control y trazabilidad del equipamiento de seguridad municipal.',
    c.users + ' usuarios activos; ' + c.sites + ' locales; ' +
      (c.tagMini + c.tagStandard + c.tagTextile) + ' elementos etiquetados.',
    'Modalidad: ' + model + '; tags e implementación prorrateados en ' + c.months + ' meses, sin pago inicial.',
    'Incluye soporte 8×5, mantención y garantía del hardware.',
    'Valores netos en UF, más IVA. Conversión a CLP al valor UF del día de facturación.',
    'No incluye obras civiles, cableado estructurado ni red del cliente. Solución SaaS o híbrida; on-premise se cotiza aparte.',
    'Plazo de instalación y condiciones de término anticipado sujetos a validación comercial.'
  ].join('\n');
}
