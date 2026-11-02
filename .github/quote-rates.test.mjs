import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/quote-rates.js', import.meta.url), 'utf8');
const { parseQuoteRate, formatQuoteRate, findPublishedRate, fetchQuoteRate } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
);

for (const [input, expected] of [
  ['41.258', 41258], ['41.258,26', 41258.26], ['41258.26', 41258.26],
  ['41,258.26', 41258.26], ['992,66', 992.66], ['992.66', 992.66],
  ['1.000', 1000], ['1.002,75', 1002.75],
  ['0', null], ['cualquier cosa', null], ['', null]
]) {
  assert.equal(parseQuoteRate(input), expected, 'parseQuoteRate: ' + input);
}
assert.equal(formatQuoteRate(41258.26), '41.258,26');
assert.equal(formatQuoteRate(992.66), '992,66');
assert.deepEqual(
  findPublishedRate({ serie: [
    { fecha: '2026-10-30', valor: 993.22 },
    { fecha: '2026-11-02', valor: 992.66 },
    { fecha: '2026-11-03', valor: 1000 }
  ] }, '2026-11-02'),
  { date: '2026-11-02', value: 992.66 }
);
assert.deepEqual(
  findPublishedRate({ serie: [
    { fecha: '2026-10-30', valor: 993.22 },
    { fecha: '2026-11-02', valor: 992.66 }
  ] }, '2026-11-01'),
  { date: '2026-10-30', value: 993.22 },
  'sábado, domingo y feriados usan la última publicación anterior'
);
assert.equal(
  findPublishedRate({ serie: [{ fecha: '2026-10-20', valor: 920 }] }, '2026-11-02'),
  null,
  'no inventar valores con más de 7 días de antigüedad'
);

const fetcher = async (url) => {
  if (url.includes('mindicador.cl')) return { ok: true, json: async () => ({ serie: [] }) };
  return { ok: true, json: async () => ({ serie: [
    { fecha: '2026-10-30', valor: 993.22 },
    { fecha: '2026-11-02', valor: 992.66 }
  ] }) };
};
assert.deepEqual(
  await fetchQuoteRate('dolar', '2026-11-02', { fetcher }),
  { date: '2026-11-02', value: 992.66, source: 'indicadores.cl' }
);
const brokenPrimary = async (url) => {
  if (url.includes('mindicador.cl')) throw new Error('Sin acceso');
  return { ok: true, json: async () => ({ serie: [{ fecha: '2026-10-30', valor: 993.22 }] }) };
};
assert.deepEqual(
  await fetchQuoteRate('dolar', '2026-11-01', { fetcher: brokenPrimary }),
  { date: '2026-10-30', value: 993.22, source: 'indicadores.cl' }
);
assert.equal(
  await fetchQuoteRate('dolar', '2026-11-02', { fetcher: async () => { throw new Error('offline'); } }),
  null,
  'sin conexión debe permitir ingreso manual'
);

console.log('quote-rates: PASS');
