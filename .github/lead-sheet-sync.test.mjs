import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Prueba el mapeo de la Edge Function lead-sheet-sync con datos ficticios.
// No consulta Google ni Supabase.
const source = await readFile(new URL('../supabase/functions/lead-sheet-sync/mapping.js', import.meta.url), 'utf8');
const {
  parseCsv,
  mapSheetRows,
  normalizePhone,
  mapIndustry,
  prettyAnswer,
  chileDateTime,
  detectColumns
} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

// ---------- CSV ----------
assert.deepEqual(
  parseCsv('﻿a,b,c\r\n"uno, dos","con ""comillas""","línea\nnueva"\r\n\r\n'),
  [['a', 'b', 'c'], ['uno, dos', 'con "comillas"', 'línea\nnueva']],
  'CSV con BOM, comas, comillas escapadas, saltos de línea y filas vacías'
);
assert.deepEqual(parseCsv('x,y\n1,'), [['x', 'y'], ['1', '']], 'última celda vacía sin salto final');

// ---------- Normalizaciones ----------
assert.equal(normalizePhone('p:+56911111111'), '+56911111111');
assert.equal(normalizePhone('p:922222222'), '+56922222222', 'móvil chileno sin código de país');
assert.equal(normalizePhone('p:+51 944 444 444'), '+51944444444');
assert.equal(normalizePhone('56933333333'), '+56933333333');
assert.equal(normalizePhone(''), '');
assert.equal(mapIndustry('instalaciones_y_mantenimiento'), 'Construcción / Instalaciones');
assert.equal(mapIndustry('hvac_/_climatización'), 'HVAC / Climatización');
assert.equal(mapIndustry('telecomunicaciones'), 'Telecomunicaciones');
assert.equal(mapIndustry('ascensores'), 'Ascensores / Transporte vertical');
assert.equal(mapIndustry('otro'), 'Otro');
assert.equal(mapIndustry('algo_nuevo'), 'Otro');
assert.equal(prettyAnswer('más_de_50'), 'Más de 50');
assert.equal(prettyAnswer('1_a_5'), '1 a 5');
assert.equal(prettyAnswer('Texto Libre, sin tocar'), 'Texto Libre, sin tocar');
assert.equal(chileDateTime('2026-11-14T21:42:35-05:00'), '14-11-2026 23:42', 'offset -05:00 a hora de Chile (verano)');
assert.equal(chileDateTime('2026-07-01T12:00:00Z'), '01-07-2026 08:00', 'hora de Chile en invierno');

// ---------- Planilla con encabezados reales de Meta y datos ficticios ----------
const headers = [
  'id', 'created_time', 'ad_id', 'ad_name', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name',
  'form_id', 'form_name', 'is_organic', 'platform',
  '¿cuántas_personas_trabajan_en_terreno_en_tu_operación?_', '¿a_qué_rubro_pertenece_tu_empresa?',
  'nombre_completo', 'número_de_teléfono', 'correo_electrónico', 'nombre_de_la_empresa', 'lead_status',
  '¿qué_software_usas_hoy?'
];
const meta = (id, created, platform, people, industry, name, phone, email, company, extra = '') => [
  id, created, 'ag:1', 'anuncio_demo', 'as:1', 'conjunto_demo', 'c:1', 'campana_demo',
  'f:1', 'Formulario demo | nov26', 'false', platform, people, industry, name, phone, email, company, 'CREATED', extra
];
const csv = [
  headers,
  meta('l:300', '2026-11-11T11:42:13-03:00', 'ig', 'más_de_50', 'instalaciones_y_mantenimiento', 'Ana Pérez', 'p:+56911111111', ' ana@demo.cl ', 'Servicios Demo SpA', 'excel'),
  meta('l:100', '2026-11-11T08:49:17-03:00', 'fb', '1_a_5', 'hvac_/_climatización', '𝕭𝖊𝖓𝖏𝖆', 'p:922222222', 'benja@demo.cl', 'Clima, Frío y Calor Ltda.'),
  meta('l:200', '2026-11-14T21:42:35-05:00', 'ig', '6_a_20', 'telecomunicaciones', 'Carla Soto', 'p:+51944444444', 'carla@demo.pe', 'Redes Demo'),
  meta('', '2026-11-15T10:00:00-03:00', 'ig', '1_a_5', 'otro', 'Sin Id', 'p:+56955555555', 'sinid@demo.cl', 'Sin Id SpA'),
  meta('l:999', '2026-11-15T10:00:00-03:00', 'ig', '<test lead: dummy data for ¿cuántas_personas?>', 'otro', '<test lead: dummy data for nombre_completo>', 'p:+56966666666', 'test@fb.com', 'Prueba')
].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');

const cols = detectColumns(headers);
assert.equal(headers[cols.company], 'nombre_de_la_empresa', 'la pregunta de rubro no se confunde con la empresa');
assert.equal(headers[cols.industry], '¿a_qué_rubro_pertenece_tu_empresa?');
assert.equal(headers[cols.technicians], '¿cuántas_personas_trabajan_en_terreno_en_tu_operación?_');
assert.equal(headers[cols.contact], 'nombre_completo');

const { rows, skipped } = mapSheetRows(parseCsv(csv), { sourceLabel: 'Meta Ads' });
assert.deepEqual(skipped, { withoutId: 1, test: 1 }, 'omite filas sin id y leads de prueba de Meta');
assert.deepEqual(rows.map((r) => r.external_id), ['l:100', 'l:300', 'l:200'], 'ordenados por fecha real, no por fila');

const [benja, ana, carla] = rows;
assert.equal(benja.contact, 'Benja', 'letras decorativas Unicode quedan como texto normal');
assert.equal(benja.company, 'Clima, Frío y Calor Ltda.');
assert.equal(benja.phone, '+56922222222');
assert.equal(benja.industry, 'HVAC / Climatización');
assert.equal(benja.technicians, '1 a 5');
assert.equal(benja.created_at, '2026-11-11T11:49:17.000Z');

assert.equal(ana.email, 'ana@demo.cl');
assert.equal(ana.phone, '+56911111111');
assert.equal(ana.industry, 'Construcción / Instalaciones');
assert.equal(ana.technicians, 'Más de 50');
assert.equal(
  ana.notes,
  [
    'Lead recibido desde Meta Ads · formulario "Formulario demo | nov26" (Instagram, 11-11-2026 11:42).',
    'Campaña: campana_demo · Anuncio: anuncio_demo',
    'Rubro declarado: Instalaciones y mantenimiento',
    'Personas en terreno: Más de 50',
    'Qué software usas hoy: Excel'
  ].join('\n')
);
assert.match(ana.summary, /Instagram, 11-11-2026 11:42/);
assert.equal(ana.payload.nombre_completo, 'Ana Pérez', 'la fila original queda en el registro de importación');

assert.equal(carla.phone, '+51944444444');
assert.equal(carla.industry, 'Telecomunicaciones');
assert.match(carla.notes, /\(Instagram, 14-11-2026 23:42\)/);

// ---------- Encabezados en inglés u otro orden ----------
const english = mapSheetRows(parseCsv([
  'full_name,company_name,email,phone_number,id,created_time',
  'Diego Rojas,Empresa Inglesa,diego@demo.cl,+56 9 7777 7777,l:1,2026-11-20T10:00:00-03:00'
].join('\n')));
assert.equal(english.rows.length, 1);
assert.equal(english.rows[0].contact, 'Diego Rojas');
assert.equal(english.rows[0].company, 'Empresa Inglesa');
assert.equal(english.rows[0].phone, '+56977777777');
assert.equal(english.rows[0].industry, '');

console.log('lead-sheet-sync: mapeo de planilla OK');
