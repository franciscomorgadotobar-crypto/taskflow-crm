/**
 * Valor UF y dólar observado: dos proveedores, tiempo máximo por petición
 * y última tasa publicada si la fecha cae en sábado, domingo o feriado.
 * Nunca se usa un dato posterior a la fecha solicitada ni un valor demasiado antiguo.
 */
export function parseQuoteRate(input) {
  let s = String(input ?? '').trim().replace(/\s|\u00a0/g, '').replace(/^(?:US\$|CLP\$?|\$)/i, '');
  if (!s) return null;
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '');
  else if (s.includes('.') && s.includes(',')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) s = s.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function formatQuoteRate(value) {
  return new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

export function findPublishedRate(payload, requestedISO, maxAgeDays = 7) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedISO)) return null;
  const rows = Array.isArray(payload?.serie) ? payload.serie : [];
  const candidates = rows.length ? rows : (payload?.fecha ? [payload] : []);
  const requestedDay = Date.parse(requestedISO + 'T00:00:00Z');
  if (!Number.isFinite(requestedDay)) return null;
  const valid = candidates.map((row) => {
    const date = String(row.fecha || '').slice(0, 10);
    const day = Date.parse(date + 'T00:00:00Z');
    const value = Number(row.valor);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(day) || !Number.isFinite(value) || value <= 0) return null;
    const diff = requestedDay - day;
    if (diff < 0 || diff > maxAgeDays * 86400000) return null;
    return { value, date };
  }).filter(Boolean);
  valid.sort((a, b) => b.date.localeCompare(a.date));
  return valid[0] || null;
}

async function getJson(url, fetcher, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchQuoteRate(indicator, requestedISO, options = {}) {
  if (!['uf', 'dolar'].includes(indicator) || !/^\d{4}-\d{2}-\d{2}$/.test(requestedISO)) return null;
  const fetcher = options.fetcher || fetch;
  const timeoutMs = options.timeoutMs ?? 4500;
  const [year, month, day] = requestedISO.split('-');
  const currentYear = new Date().getFullYear().toString();
  const primaryUrl = 'https://mindicador.cl/api/' + indicator + '/' + day + '-' + month + '-' + year;
  const fallbackUrl = year === currentYear
    ? 'https://indicadores.cl/api/v1/' + indicator + '.json'
    : 'https://indicadores.cl/api/v1/historico/' + indicator + '/' + year + '.json';
  const endpoints = [
    { url: primaryUrl, source: 'mindicador.cl' },
    { url: fallbackUrl, source: 'indicadores.cl' }
  ];
  const results = await Promise.allSettled(endpoints.map(async (entry) => {
    const data = await getJson(entry.url, fetcher, timeoutMs);
    const rate = findPublishedRate(data, requestedISO);
    if (!rate) throw new Error('Sin dato publicado para la fecha');
    return { ...rate, source: entry.source };
  }));
  const available = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  available.sort((a, b) => b.date.localeCompare(a.date));
  return available[0] || null;
}
