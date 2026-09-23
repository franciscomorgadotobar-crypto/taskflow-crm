import { supabase } from './supabase.js';
import { fmtAmount, fmtDate, fmtNumber, nowISO, toast } from './utils.js';

/**
 * Cotizador. Vive separado de store.js por prolijidad: `state` en memoria y
 * Realtime para que todos vean lo mismo. Los montos los calcula el servidor
 * (quote_preview / save_quote, migración 0029), así que las escrituras de
 * cotizaciones y listas van primero a Supabase y luego se rehidrata. Cada
 * cotización que se edita genera una VERSIÓN nueva (no se pisa la anterior):
 * `rootId` agrupa las versiones, comparten número y `isCurrent` marca la vigente.
 */
export const state = { priceLists: [], priceListItems: [], quotes: [] };

const listeners = new Set();
export const onChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const notify = () => listeners.forEach((fn) => fn(state));

/* ---------- Mapeo ---------- */

const fromDbPriceList = (r) => ({
  id: r.id,
  name: r.name,
  currency: r.currency || 'UF',
  status: r.status || 'vigente',
  sourceFile: r.source_file || '',
  createdBy: r.created_by || '',
  createdAt: r.created_at,
  updatedAt: r.updated_at
});

const fromDbPriceListItem = (r) => ({
  id: r.id,
  priceListId: r.price_list_id,
  code: r.code,
  name: r.name,
  price: Number(r.price || 0),
  periodicity: r.periodicity,
  category: r.category || '',
  active: r.active !== false,
  position: r.position || 0
});

const fromDbItem = (r) => ({
  id: r.id,
  priceListItemId: r.price_list_item_id || '',
  code: r.code || '',
  name: r.name,
  periodicity: r.periodicity || 'mensual',
  quantity: Number(r.quantity || 0),
  unitPrice: Number(r.unit_price || 0),
  listPrice: Number(r.list_price || 0),
  listCurrency: r.list_currency || 'UF',
  subtotal: Number(r.subtotal || 0),
  discount: Number(r.discount || 0),
  total: Number(r.total || 0),
  discountMonths: Number(r.discount_months || 0),
  position: r.position || 0
});

const fromDbDiscount = (r) => ({
  id: r.id,
  position: r.position,
  scope: r.scope,
  quoteItemId: r.quote_item_id || '',
  kind: r.kind,
  value: Number(r.value || 0),
  months: r.months == null ? null : Number(r.months)
});

function fromDbQuote(r, items = [], discounts = []) {
  return {
    id: r.id,
    rootId: r.root_id || r.id,
    version: r.version,
    isCurrent: r.is_current,
    leadId: r.lead_id,
    ownerId: r.owner_id || '',
    owner: r.owner_name || '',
    status: r.status,
    number: r.number || '',
    priceListId: r.price_list_id || '',
    currency: r.currency || 'UF',
    ufValue: r.uf_value == null ? null : Number(r.uf_value),
    ufDate: r.uf_date || '',
    quoteDate: r.quote_date || '',
    contractMonths: Number(r.contract_months || 12),
    paymentMethod: r.payment_method || '',
    paymentTerms: r.payment_terms || '',
    ivaRate: Number(r.iva_rate ?? 0.19),
    totals: r.totals || {},
    client: r.client_snapshot || {},
    subtotalNeto: Number(r.subtotal_neto || 0),
    iva: Number(r.iva || 0),
    total: Number(r.total || 0),
    notes: r.notes || '',
    validUntil: r.valid_until || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    sentAt: r.sent_at || '',
    items: items.map(fromDbItem).sort((a, b) => a.position - b.position),
    discounts: discounts.map(fromDbDiscount).sort((a, b) => a.position - b.position)
  };
}

/* ---------- Hidratación + Realtime ---------- */

let channel = null;
let realtimeHydrateTimer = null;
let hydrateGeneration = 0;

function scheduleHydrate() {
  clearTimeout(realtimeHydrateTimer);
  realtimeHydrateTimer = setTimeout(() => {
    hydrate().catch((err) => reportError('No se pudo sincronizar el cotizador', err));
  }, 250);
}

export async function hydrate() {
  const generation = ++hydrateGeneration;
  const [plR, pliR, qR, itR, dR] = await Promise.all([
    supabase.from('price_lists').select('*').order('created_at', { ascending: false }),
    supabase.from('price_list_items').select('*').order('position'),
    supabase.from('quotes').select('*').order('created_at', { ascending: false }),
    supabase.from('quote_items').select('*'),
    supabase.from('quote_discounts').select('*')
  ]);
  [plR, pliR, qR, itR, dR].forEach((r) => r.error && console.error(r.error));
  if (generation !== hydrateGeneration) return;

  // Una lectura fallida no debe interpretarse como una colección vacía.
  // Conservamos la última copia válida y actualizamos cada bloque solo cuando
  // Supabase respondió correctamente. Listas + servicios y quotes + items se
  // tratan como unidades.
  if (!plR.error && !pliR.error) {
    state.priceLists = (plR.data || []).map(fromDbPriceList);
    state.priceListItems = (pliR.data || []).map(fromDbPriceListItem);
  }

  if (!qR.error && !itR.error && !dR.error) {
    const byQuote = (rows) => {
      const map = new Map();
      (rows || []).forEach((row) => map.set(row.quote_id, [...(map.get(row.quote_id) || []), row]));
      return map;
    };
    const itemsByQuote = byQuote(itR.data);
    const discountsByQuote = byQuote(dR.data);
    state.quotes = (qR.data || []).map((q) => fromDbQuote(q, itemsByQuote.get(q.id) || [], discountsByQuote.get(q.id) || []));
  }

  notify();
}

export function startRealtime() {
  if (channel) return;
  channel = supabase
    .channel('crm-quotes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'price_lists' }, scheduleHydrate)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'price_list_items' }, scheduleHydrate)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'quotes' }, scheduleHydrate)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'quote_items' }, scheduleHydrate)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'quote_discounts' }, scheduleHydrate)
    .subscribe();
}

export function stopRealtime() {
  hydrateGeneration += 1;
  if (channel) supabase.removeChannel(channel);
  channel = null;
  clearTimeout(realtimeHydrateTimer);
  realtimeHydrateTimer = null;
}

export function clearLocal() {
  hydrateGeneration += 1;
  state.priceLists = [];
  state.priceListItems = [];
  state.quotes = [];
  notify();
}

function reportError(action, err) {
  console.error(action, err);
  toast(`${action}: ${err.message || 'no se pudo guardar en el servidor'}`, 'error');
}

/* ---------- Listas de precios ---------- */

// Las listas son de baja frecuencia y solo las modifica un administrador: se
// escribe primero en el servidor y luego se rehidrata, sin copia optimista.

export const getPriceList = (id) => state.priceLists.find((l) => l.id === id) || null;

export const getPriceListItem = (id) => state.priceListItems.find((it) => it.id === id) || null;

export const itemsOfPriceList = (listId) =>
  state.priceListItems.filter((it) => it.priceListId === listId).sort((a, b) => a.position - b.position || a.code.localeCompare(b.code));

function friendlyListError(err) {
  if (err?.code === '23505') return new Error('Ya existe un servicio con ese código en la lista.');
  if (err?.code === '23503') return new Error('La lista está usada en cotizaciones. Archívala en vez de eliminarla.');
  return err;
}

/** Crea una lista nueva desde un archivo ya validado. `items` usa code/name/price/periodicity/category/active. */
export async function importPriceList({ name, currency, items, sourceFile = '' }) {
  const { data, error } = await supabase.rpc('import_price_list', {
    p_name: name,
    p_currency: currency,
    p_items: items,
    p_source_file: sourceFile
  });
  if (error || !data) {
    reportError('No se pudo importar la lista', error || new Error('El servidor no confirmó la lista.'));
    return null;
  }
  await hydrate();
  return data;
}

export async function updatePriceList(id, patch) {
  const row = {};
  if ('name' in patch) row.name = patch.name;
  if ('status' in patch) row.status = patch.status;
  const { data, error: updateError } = await supabase.from('price_lists').update(row).eq('id', id).select('id');
  const error = updateError || (!data?.length ? new Error('El servidor no confirmó el cambio.') : null);
  if (error) {
    reportError('No se pudo actualizar la lista', friendlyListError(error));
    return false;
  }
  await hydrate();
  return true;
}

export async function deletePriceList(id) {
  const { data, error: deleteError } = await supabase.from('price_lists').delete().eq('id', id).select('id');
  const error = deleteError || (!data?.length ? new Error('El servidor no confirmó la eliminación.') : null);
  if (error) {
    reportError('No se pudo eliminar la lista', friendlyListError(error));
    return false;
  }
  await hydrate();
  return true;
}

export async function savePriceListItem(input) {
  const row = {
    code: input.code,
    name: input.name,
    price: input.price,
    periodicity: input.periodicity,
    category: input.category || '',
    active: input.active !== false
  };
  const write = input.id
    ? supabase.from('price_list_items').update(row).eq('id', input.id).select('id')
    : supabase
        .from('price_list_items')
        .insert({
          ...row,
          price_list_id: input.priceListId,
          position: Math.max(-1, ...itemsOfPriceList(input.priceListId).map((it) => it.position)) + 1
        })
        .select('id');
  const { data, error: writeError } = await write;
  const error = writeError || (!data?.length ? new Error('El servidor no confirmó el servicio.') : null);
  if (error) {
    reportError('No se pudo guardar el servicio', friendlyListError(error));
    return false;
  }
  await hydrate();
  return true;
}

export async function deletePriceListItem(id) {
  const { data, error: deleteError } = await supabase.from('price_list_items').delete().eq('id', id).select('id');
  const error = deleteError || (!data?.length ? new Error('El servidor no confirmó la eliminación.') : null);
  if (error) {
    reportError('No se pudo eliminar el servicio', friendlyListError(error));
    return false;
  }
  await hydrate();
  return true;
}

/* ---------- Cotizaciones ---------- */

export const getQuote = (id) => state.quotes.find((q) => q.id === id) || null;

export const quotesOf = (leadId) => state.quotes.filter((q) => q.leadId === leadId).sort((a, b) => b.version - a.version);

/** Todas las versiones de una cotización (mismo rootId), la más nueva primero. */
export const versionsOf = (rootId) => state.quotes.filter((q) => q.rootId === rootId).sort((a, b) => b.version - a.version);

export const currentQuoteOf = (rootId) => versionsOf(rootId).find((q) => q.isCurrent) || versionsOf(rootId)[0] || null;

/**
 * Convierte el borrador del constructor al formato de las RPC quote_preview /
 * save_quote. Precios, conversión de moneda y totales los resuelve el servidor:
 * aquí solo viajan servicio, cantidad y descuentos.
 */
function toRpcPayload(draft) {
  return {
    p_quote: {
      lead_id: draft.leadId,
      price_list_id: draft.priceListId,
      currency: draft.currency,
      uf_value: draft.ufValue ?? '',
      uf_date: draft.ufDate || '',
      quote_date: draft.quoteDate || '',
      valid_until: draft.validUntil || '',
      contract_months: draft.contractMonths,
      payment_method: draft.paymentMethod || '',
      payment_terms: draft.paymentTerms || '',
      status: draft.status || 'borrador',
      notes: draft.notes || '',
      client_snapshot: draft.client || {}
    },
    p_items: draft.items.map((it) => ({ ref: it.ref, price_list_item_id: it.priceListItemId, quantity: it.quantity })),
    p_discounts: draft.discounts.map((d) => ({
      scope: d.scope,
      item_ref: d.scope === 'line' ? d.itemRef : '',
      kind: d.kind,
      value: d.kind === 'free' ? 0 : d.value,
      months: d.months ?? ''
    }))
  };
}

/** Cálculo del servidor sin guardar. Lanza el error con el mensaje de la RPC. */
export async function previewQuote(draft) {
  const { p_quote, p_items, p_discounts } = toRpcPayload(draft);
  const { data, error } = await supabase.rpc('quote_preview', { p_quote, p_items, p_discounts });
  if (error) throw error;
  return data;
}

/**
 * Guarda una cotización. Sin `baseId` crea la versión 1 con su número
 * P-AAAAMM-NNNN. Con `baseId` (la versión vigente que se estaba editando) crea la
 * siguiente versión con el mismo número y deja la anterior en el historial.
 */
export async function saveQuote(draft, baseId = '') {
  const { p_quote, p_items, p_discounts } = toRpcPayload(draft);
  const { data, error } = await supabase.rpc('save_quote', { p_quote, p_items, p_discounts, p_base_id: baseId || null });
  if (error || !data?.id) {
    reportError('No se pudo guardar la cotización', error || new Error('El servidor no confirmó la cotización.'));
    return null;
  }
  await hydrate();
  return data;
}

/** Valor UF del día desde mindicador.cl. Devuelve null si no hay conexión o dato. */
export async function fetchUfValue(dateISO) {
  const [y, m, d] = String(dateISO || '').split('-');
  if (!y || !m || !d) return null;
  try {
    const res = await fetch(`https://mindicador.cl/api/uf/${d}-${m}-${y}`);
    if (!res.ok) return null;
    const json = await res.json();
    const value = Number(json?.serie?.[0]?.valor);
    return value > 0 ? value : null;
  } catch {
    return null;
  }
}

export async function setQuoteStatus(id, status) {
  const q = getQuote(id);
  if (!q) return null;
  const before = structuredClone(q);
  q.status = status;
  q.updatedAt = nowISO();
  notify();
  const { data, error: updateError } = await supabase.from('quotes').update({ status }).eq('id', id).select('id');
  const error = updateError || (!data?.length ? new Error('El servidor no confirmó el cambio de estado.') : null);
  if (!error) return q;
  Object.assign(q, before);
  notify();
  reportError('No se pudo actualizar el estado', error);
  return null;
}

/** Borra una versión. Si era la vigente, la versión anterior pasa a serlo. */
export async function deleteQuote(id) {
  const q = getQuote(id);
  if (!q) return;
  const beforeQuotes = structuredClone(state.quotes);
  state.quotes = state.quotes.filter((x) => x.id !== id);
  if (q.isCurrent) {
    const next = versionsOf(q.rootId)[0];
    if (next) next.isCurrent = true;
  }
  notify();
  const { error } = await supabase.rpc('delete_quote_version', { p_quote_id: id });
  if (!error) {
    await hydrate();
    return true;
  }

  state.quotes = beforeQuotes;
  notify();
  reportError('No se pudo eliminar la cotización', error);
  return false;
}

/* ---------- Correo de cotización ---------- */

const firstName = (full) => String(full || '').trim().split(/\s+/)[0] || '';

/** Cuerpo y asunto por defecto: se muestran en un editor antes de enviar, así que son solo el punto de partida. */
export function buildQuoteEmail(quote, lead) {
  const name = firstName(quote.client?.contact || lead?.contact) || 'equipo';
  const cur = quote.currency;
  const money = (n) => (cur === 'CLP' ? fmtAmount(n, cur) : `UF ${fmtAmount(n, cur)}`);
  const line = (it) =>
    `- ${it.name} · ${fmtNumber(it.quantity)} x ${money(it.unitPrice)}${it.discount ? ` (dscto ${money(it.discount)})` : ''} = ${money(it.total)}`;
  const setup = quote.items.filter((it) => it.periodicity === 'unico');
  const monthly = quote.items.filter((it) => it.periodicity !== 'unico');
  const t = quote.totals || {};
  const body = [
    `Hola ${name},`,
    '',
    `Te comparto la cotización ${quote.number || ''} de servicios para ${lead?.company || quote.client?.company || 'tu empresa'}:`,
    '',
    ...(setup.length ? ['Habilitación (pago único):', ...setup.map(line), `Total habilitación: ${money(t.setup?.net)} + IVA`, ''] : []),
    ...(monthly.length ? ['Servicios mensuales (mes 1):', ...monthly.map(line), `Total mensual: ${money(t.monthly?.net)} + IVA`, ''] : []),
    `Contrato ${quote.contractMonths} meses: ${money(quote.subtotalNeto)} neto · IVA ${money(quote.iva)} · Total ${money(quote.total)}`,
    quote.validUntil ? `` : '',
    quote.validUntil ? `Válida hasta ${fmtDate(quote.validUntil)}.` : '',
    quote.notes ? '' : '',
    quote.notes || '',
    '',
    'Quedo atento/a a tus comentarios.'
  ]
    .filter((l, i, arr) => !(l === '' && arr[i - 1] === ''))
    .join('\n');
  return { subject: `Cotización ${quote.number || 'TaskFlow'} — ${lead?.company || quote.client?.company || ''}`, body };
}
