// Mapeo de planillas de leads (formularios de Meta Ads y similares) al formato del CRM.
// Módulo puro: lo usan la Edge Function (Deno) y las pruebas (Node).

const PLATFORMS = {
  ig: 'Instagram',
  fb: 'Facebook',
  an: 'Audience Network',
  msg: 'Messenger',
  messenger: 'Messenger',
  wa: 'WhatsApp'
};

// Respuestas del formulario → rubros del catálogo del CRM (js/catalog.js).
// El orden importa: "mantenimiento" es genérico y queda al final.
const INDUSTRY_RULES = [
  [/hvac|climatiz|refrigera/, 'HVAC / Climatización'],
  [/telecom/, 'Telecomunicaciones'],
  [/ascensor|transporte vertical/, 'Ascensores / Transporte vertical'],
  [/electrogen|generador/, 'Grupos electrógenos'],
  [/facility/, 'Facility Management'],
  [/laboratorio|servicios? tecnicos?/, 'Servicios técnicos / Laboratorio'],
  [/seguridad/, 'Seguridad industrial'],
  [/medic/, 'Equipos médicos'],
  [/maquinaria|arriendo/, 'Arriendo de maquinaria'],
  [/educa/, 'Educación'],
  [/postventa|reparacion/, 'Reparación / Postventa'],
  [/instalacion|construc|mantenimiento|mantencion/, 'Construcción / Instalaciones']
];

// Columnas técnicas de Meta que no se copian a las notas del lead.
const IGNORED_KEYS = new Set([
  'ad id', 'adset id', 'campaign id', 'form id', 'is organic', 'lead status', 'platform',
  'ad name', 'adset name', 'campaign name', 'form name'
]);

// Campo del CRM → [encabezados exactos, encabezados aproximados]. Se prueban en este
// orden y cada columna se usa una sola vez: así "¿A qué rubro pertenece tu empresa?"
// queda como rubro y no como nombre de empresa.
const FIELD_RULES = [
  ['external_id', (k) => k === 'id' || k === 'lead id' || k === 'leadgen id'],
  ['created_at', (k) => k === 'created time' || k === 'fecha', (k) => k.startsWith('fecha ')],
  ['industry', (k) => k === 'rubro' || k === 'industria' || k === 'industry', (k) => /\b(rubro|industria|industry|sector)\b/.test(k)],
  ['technicians', (k) => k === 'tecnicos' || k === 'dotacion', (k) => /\b(terreno|tecnicos|cuadrillas?|dotacion)\b/.test(k)],
  ['email', (k) => k === 'email' || k === 'correo' || k === 'correo electronico' || k === 'e mail', (k) => /\b(correo|email|e mail)\b/.test(k)],
  ['phone', (k) => k === 'phone number' || k === 'telefono' || k === 'numero de telefono' || k === 'celular', (k) => /\b(telefono|phone|celular|movil|whatsapp)\b/.test(k)],
  ['role', (k) => k === 'cargo' || k === 'job title', (k) => /\b(cargo|puesto)\b/.test(k)],
  [
    'company',
    (k) => k === 'empresa' || k === 'nombre de la empresa' || k === 'nombre empresa' || k === 'company name' || k === 'company' || k === 'razon social',
    (k) => /\b(empresa|compania|company|razon social)\b/.test(k)
  ],
  [
    'contact',
    (k) => k === 'nombre completo' || k === 'full name' || k === 'nombre' || k === 'name' || k === 'nombre y apellido',
    (k) => k.startsWith('nombre') && !/\b(empresa|compania)\b/.test(k)
  ]
];

/** Clave comparable de un encabezado: sin tildes, signos ni guiones bajos. */
export function normalizeKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Texto limpio: NFKC (convierte letras decorativas Unicode), espacios simples. */
export function cleanText(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

/** Respuesta de opción de Meta ("más_de_50") → texto legible ("Más de 50"). El texto libre no se toca. */
export function prettyAnswer(value) {
  const text = cleanText(value);
  if (!text || !/^[\p{Ll}\d_/-]+$/u.test(text)) return text;
  return capitalize(text.replace(/_/g, ' ').replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ').trim());
}

/** Encabezado de pregunta ("¿qué_software_usas?_") → etiqueta ("Qué software usas"). */
export function prettyHeader(value) {
  return capitalize(cleanText(value).replace(/[¿?]/g, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim());
}

/** Teléfono con código de país: "p:+56 9 8728 4044" → "+56987284044"; "945382731" → "+56945382731". */
export function normalizePhone(value) {
  const raw = cleanText(value).replace(/^p:\s*/i, '');
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (raw.startsWith('+')) return '+' + digits;
  if (digits.startsWith('00') && digits.length > 10) return '+' + digits.slice(2);
  if (digits.length === 9) return '+56' + digits;
  if (digits.length === 11 && digits.startsWith('56')) return '+' + digits;
  return digits;
}

export function normalizeEmail(value) {
  return cleanText(value).replace(/^mailto:/i, '').replace(/\s+/g, '');
}

/** Rubro declarado → rubro del catálogo del CRM. */
export function mapIndustry(value) {
  const key = normalizeKey(value);
  if (!key) return '';
  const match = INDUSTRY_RULES.find(([rule]) => rule.test(key));
  return match ? match[1] : 'Otro';
}

export function platformLabel(value) {
  return PLATFORMS[normalizeKey(value)] || cleanText(value);
}

/** ISO → "11-11-2026 11:42" en hora de Chile. */
export function chileDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const part = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${part('day')}-${part('month')}-${part('year')} ${part('hour')}:${part('minute')}`;
}

function toIso(value) {
  const text = cleanText(value);
  if (!text) return '';
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

/** CSV (RFC 4180) → arreglo de filas. Soporta comillas, comas y saltos de línea dentro de celdas. */
export function parseCsv(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((value) => String(value).trim() !== ''));
}

/** Detecta qué columna corresponde a cada campo del CRM según su encabezado. */
export function detectColumns(headers) {
  const keys = headers.map(normalizeKey);
  const used = new Set();
  const columns = {};
  const pick = (test) => keys.findIndex((key, i) => key && !used.has(i) && test(key));
  for (const [field, exact, loose] of FIELD_RULES) {
    let index = pick(exact);
    if (index < 0 && loose) index = pick(loose);
    if (index >= 0) {
      columns[field] = index;
      used.add(index);
    }
  }
  return {
    ...columns,
    platform: keys.indexOf('platform'),
    form: keys.indexOf('form name'),
    campaign: keys.indexOf('campaign name'),
    ad: keys.indexOf('ad name'),
    used,
    keys
  };
}

/**
 * Filas de la planilla (la primera trae los encabezados) → leads listos para
 * lead_sheet_import(). Omite filas sin id y leads de prueba de Meta, y entrega
 * los leads ordenados por fecha de llegada (así el turno rotativo sigue ese orden).
 */
export function mapSheetRows(table, { sourceLabel = 'Meta Ads' } = {}) {
  const [headers = [], ...data] = Array.isArray(table) ? table : [];
  const cols = detectColumns(headers);
  const cell = (row, index) => (Number.isInteger(index) && index >= 0 ? cleanText(row[index]) : '');
  const skipped = { withoutId: 0, test: 0 };
  const rows = [];

  data.forEach((row, order) => {
    if (row.some((value) => /^<test lead/i.test(String(value ?? '').trim()))) {
      skipped.test += 1;
      return;
    }
    const externalId = cell(row, cols.external_id);
    if (!externalId) {
      skipped.withoutId += 1;
      return;
    }

    const createdAt = toIso(cell(row, cols.created_at));
    const industryAnswer = prettyAnswer(cell(row, cols.industry));
    const technicians = prettyAnswer(cell(row, cols.technicians));
    const form = cell(row, cols.form);
    const campaign = cell(row, cols.campaign);
    const ad = cell(row, cols.ad);
    const origin = [platformLabel(cell(row, cols.platform)), createdAt ? chileDateTime(createdAt) : '']
      .filter(Boolean)
      .join(', ');

    const extras = headers
      .map((header, i) => {
        if (cols.used.has(i) || !cols.keys[i] || IGNORED_KEYS.has(cols.keys[i])) return '';
        const value = prettyAnswer(row[i]);
        return value ? `${prettyHeader(header)}: ${value}` : '';
      })
      .filter(Boolean);

    const notes = [
      `Lead recibido desde ${sourceLabel}${form ? ` · formulario "${form}"` : ''}${origin ? ` (${origin})` : ''}.`,
      [campaign && `Campaña: ${campaign}`, ad && `Anuncio: ${ad}`].filter(Boolean).join(' · '),
      industryAnswer && `Rubro declarado: ${industryAnswer}`,
      technicians && `Personas en terreno: ${technicians}`,
      ...extras
    ]
      .filter(Boolean)
      .join('\n');

    const summary = [
      form && `formulario "${form}"`,
      origin,
      industryAnswer && `rubro ${industryAnswer.toLowerCase()}`,
      technicians && `${technicians.toLowerCase()} personas en terreno`
    ]
      .filter(Boolean)
      .join(' · ');

    rows.push({
      order,
      lead: {
        external_id: externalId,
        created_at: createdAt,
        company: cell(row, cols.company),
        contact: cell(row, cols.contact),
        role: cell(row, cols.role),
        email: normalizeEmail(cell(row, cols.email)),
        phone: normalizePhone(cell(row, cols.phone)),
        industry: industryAnswer ? mapIndustry(industryAnswer) : '',
        technicians,
        notes,
        summary,
        payload: Object.fromEntries(headers.map((header, i) => [String(header), String(row[i] ?? '')]))
      }
    });
  });

  rows.sort((a, b) => (a.lead.created_at || '9999').localeCompare(b.lead.created_at || '9999') || a.order - b.order);
  return { rows: rows.map((r) => r.lead), skipped };
}
