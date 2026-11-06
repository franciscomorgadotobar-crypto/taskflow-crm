/**
 * Complementos opcionales de cotizaciones: valores informativos sin efecto en
 * el total contractual. Se persisten como metadatos en notes, igual que la
 * modalidad de acceso anticipado, para no alterar las RPC financieras.
 */
const OPTIONAL_TAG = /\[\[TF_OPTIONALS:([^\]]+)\]\]/g;
const round = (value, precision) => Math.round((value + Number.EPSILON) * 10 ** precision) / 10 ** precision;
const digits = (currency) => currency === 'CLP' ? 0 : currency === 'USD' ? 2 : 4;

export function readOptionalQuoteData(rawNotes = '') {
  const raw = String(rawNotes || '');
  let items = [];
  for (const match of raw.matchAll(OPTIONAL_TAG)) {
    try {
      const parsed = JSON.parse(decodeURIComponent(match[1]));
      if (Array.isArray(parsed)) items = parsed.filter((x) =>
        x && typeof x.name === 'string' && Number.isFinite(Number(x.quantity)) &&
        Number(x.quantity) >= 1 && Number.isFinite(Number(x.unitPrice)));
    } catch {
      // Un bloque antiguo o malformado no puede impedir abrir la cotización.
    }
  }
  return { notes: raw.replace(OPTIONAL_TAG, '').trim(), items };
}

export function writeOptionalQuoteData(rawNotes, items = []) {
  const notes = readOptionalQuoteData(rawNotes).notes;
  const valid = Array.isArray(items) ? items.filter((x) =>
    x && typeof x.name === 'string' && x.name.trim() &&
    Number.isFinite(Number(x.unitPrice)) && Number(x.unitPrice) >= 0 &&
    Number.isInteger(Number(x.quantity)) && Number(x.quantity) >= 1).slice(0, 50) : [];
  return valid.length
    ? [notes, '[[TF_OPTIONALS:' + encodeURIComponent(JSON.stringify(valid)) + ']]'].filter(Boolean).join('\n')
    : notes;
}

/** Convierte a la moneda de la cotización a partir de precios de catálogo. */
export function optionalUnitPrice(price, sourceCurrency, targetCurrency, ufValue, usdValue) {
  const n = Number(price);
  if (!Number.isFinite(n) || n < 0) return null;
  if (!['UF', 'CLP', 'USD'].includes(sourceCurrency) || !['UF', 'CLP', 'USD'].includes(targetCurrency)) return null;
  if (sourceCurrency === targetCurrency) return round(n, digits(targetCurrency));
  const uf = Number(ufValue);
  const usd = Number(usdValue);
  if ((sourceCurrency === 'UF' || targetCurrency === 'UF') && !(uf > 0)) return null;
  if ((sourceCurrency === 'USD' || targetCurrency === 'USD') && !(usd > 0)) return null;
  const clp = sourceCurrency === 'UF' ? n * uf : sourceCurrency === 'USD' ? n * usd : n;
  const result = targetCurrency === 'UF' ? clp / uf : targetCurrency === 'USD' ? clp / usd : clp;
  return round(result, digits(targetCurrency));
}

/**
 * Copia el precio vigente a la cotización. Así el PDF histórico mantiene
 * los valores comunicados aunque la lista cambie después.
 */
export function optionalItemSnapshot(item, quantity, config = {}) {
  if (!item?.name) return null;
  const qty = Math.min(100000, Math.max(1, Math.trunc(Number(quantity) || 1)));
  const currency = config.currency || 'UF';
  const unitPrice = optionalUnitPrice(item.price, config.listCurrency || currency, currency, config.ufValue, config.usdValue);
  if (unitPrice === null) return null;
  const includesIva = currency === 'USD' && config.absorbIva === true;
  const total = round(unitPrice * qty * (includesIva ? 1 : 1.19), digits(currency));
  return {
    priceListItemId: item.id || '',
    code: item.code || '',
    name: item.name,
    description: item.description || '',
    periodicity: item.periodicity || 'mensual',
    quantity: qty,
    currency,
    unitPrice,
    total,
    includesIva
  };
}
