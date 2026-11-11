import { supabase } from './supabase.js';
import { fmtAmount, fmtCurrency, fmtDate, fmtNumber, nowISO, toast } from './utils.js';
import { clientServiceName, clientServiceScope } from './quote-client-copy.js';
import { optionalItemSnapshot, readOptionalQuoteData } from './quote-optionals.js';
import { quoteDiscountPercent } from './quote-commercial-pricing.js';

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
  organizationId: r.organization_id || '',
  name: r.name,
  currency: r.currency || 'UF',
  status: r.status || 'vigente',
  sourceFile: r.source_file || '',
  issuerProfile: r.issuer_profile || {},
  commercialInfo: Array.isArray(r.commercial_info) ? r.commercial_info : [],
  createdBy: r.created_by || '',
  createdAt: r.created_at,
  updatedAt: r.updated_at
});

const fromDbPriceListItem = (r) => ({
  id: r.id,
  priceListId: r.price_list_id,
  code: r.code,
  name: r.name,
  description: r.description || '',
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
  description: r.description || '',
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
    alternativeOfRootId: r.alternative_of_root_id || '',
    version: r.version,
    isCurrent: r.is_current,
    leadId: r.lead_id || '',
    ownerId: r.owner_id || '',
    owner: r.owner_name || '',
    sellerName: r.seller_name || r.owner_name || '',
    status: r.status,
    number: r.number || '',
    priceListId: r.price_list_id || '',
    currency: r.currency || 'UF',
    absorbIva: r.absorb_iva === true,
    ufValue: r.uf_value == null ? null : Number(r.uf_value),
    usdValue: r.usd_value == null ? null : Number(r.usd_value),
    ufDate: r.uf_date || '',
    usdDate: r.usd_date || '',
    quoteDate: r.quote_date || '',
    contractMonths: Number(r.contract_months || 12),
    paymentMethod: r.payment_method || '',
    paymentTerms: r.payment_terms || '',
    ivaRate: Number(r.iva_rate ?? 0.19),
    totals: r.totals || {},
    client: r.client_snapshot || {},
    issuer: r.issuer_snapshot || {},
    commercialInfo: Array.isArray(r.commercial_snapshot) ? r.commercial_snapshot : [],
    subtotalNeto: Number(r.subtotal_neto || 0),
    iva: Number(r.iva || 0),
    total: Number(r.total || 0),
    notes: r.notes || '',
    optionalItems: readOptionalQuoteData(r.notes).items,
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

/** Crea una lista nueva; cada ítem conserva su alcance comercial para futuras cotizaciones. */
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
  if ('issuerProfile' in patch) row.issuer_profile = patch.issuerProfile || {};
  if ('commercialInfo' in patch) row.commercial_info = Array.isArray(patch.commercialInfo) ? patch.commercialInfo : [];
  const { data, error: updateError } = await supabase.from('price_lists').update(row).eq('id', id).select('id');
  const error = updateError || (!data?.length ? new Error('El servidor no confirmó el cambio.') : null);
  if (error) {
    reportError('No se pudo actualizar la lista', friendlyListError(error));
    return false;
  }
  await hydrate();
  return true;
}

export async function uploadPriceListLogo(id, file) {
  const list = getPriceList(id);
  if (!list?.organizationId) throw new Error('No se pudo identificar la organización de la lista.');
  if (!file) return list.issuerProfile?.logoUrl || '';
  if (!/^image\/(png|jpeg|webp)$/i.test(file.type || '')) {
    throw new Error('El logo debe ser PNG, JPG o WEBP.');
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error('El logo no puede superar 2 MB.');
  }

  const path = `${list.organizationId}/${id}/logo`;
  const { error } = await supabase.storage.from('quote-branding').upload(path, file, {
    upsert: true,
    contentType: file.type,
    cacheControl: '3600'
  });
  if (error) throw error;

  const { data } = supabase.storage.from('quote-branding').getPublicUrl(path);
  return data?.publicUrl ? `${data.publicUrl}?v=${Date.now()}` : '';
}

export async function deletePriceList(id) {
  const list = getPriceList(id);
  const { data, error: deleteError } = await supabase.from('price_lists').delete().eq('id', id).select('id');
  const error = deleteError || (!data?.length ? new Error('El servidor no confirmó la eliminación.') : null);
  if (error) {
    reportError('No se pudo eliminar la lista', friendlyListError(error));
    return false;
  }
  if (list?.organizationId) {
    supabase.storage.from('quote-branding').remove([`${list.organizationId}/${id}/logo`]).catch(() => {});
  }
  await hydrate();
  return true;
}

export async function savePriceListItem(input) {
  const row = {
    code: input.code,
    name: input.name,
    description: String(input.description || '').trim().slice(0, 1500),
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

/** Complementos de catálogo con precio congelado por cada versión, fuera de los totales RPC. */
export function buildQuoteOptionalItems(draft) {
  const list = getPriceList(draft.priceListId);
  const cfg = {
    currency: draft.currency,
    listCurrency: list?.currency || draft.currency,
    ufValue: draft.ufValue,
    usdValue: draft.usdValue,
    absorbIva: draft.absorbIva === true
  };
  return (draft.optionalItems || []).map((line) => {
    const current = getPriceListItem(line.priceListItemId);
    const catalogItem = current?.priceListId === draft.priceListId ? current : null;
    if (catalogItem) return optionalItemSnapshot(catalogItem, line.quantity, cfg);
    // Preservar precios ya comunicados cuando un ítem del catálogo fue archivado.
    if (line.currency !== draft.currency) return null;
    return optionalItemSnapshot({ ...line, price: line.unitPrice }, line.quantity, {
      ...cfg, listCurrency: draft.currency
    });
  }).filter(Boolean);
}

export const getQuote = (id) => state.quotes.find((q) => q.id === id) || null;

export const quotesOf = (leadId) => state.quotes.filter((q) => q.leadId === leadId).sort((a, b) => b.version - a.version);

/** Todas las versiones de una cotización (mismo rootId), la más nueva primero. */
export const versionsOf = (rootId) => state.quotes.filter((q) => q.rootId === rootId).sort((a, b) => b.version - a.version);

export const currentQuoteOf = (rootId) => versionsOf(rootId).find((q) => q.isCurrent) || versionsOf(rootId)[0] || null;

/** La relación de alternativas es explícita: NO agrupar por nombre del cliente.
 * Cada raíz de cotización representa una opción; alternativeOfRootId vincula
 * esas opciones a la propuesta original. El historial no crea nuevas opciones.
 */
export const quoteFamilyKey = (quote) =>
  String(quote?.alternativeOfRootId || quote?.rootId || quote?.id || '');

/** Una ficha por grupo de alternativas vigentes, sin duplicar versiones.
 * Un filtro por estado selecciona GRUPOS con alguna opción coincidente;
 * dentro del grupo se siguen viendo todas las opciones y sus estados.
 */
export function quoteGroupsOf(quotes = state.quotes, { status = '' } = {}) {
  const groups = new Map();
  for (const q of quotes) {
    if (!q?.isCurrent) continue;
    const key = quoteFamilyKey(q);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q);
  }
  return [...groups.entries()]
    .filter(([, options]) => !status || options.some((q) => q.status === status))
    .map(([key, options]) => ({
      key,
      options: options.sort((a, b) => {
        if (Boolean(a.alternativeOfRootId) !== Boolean(b.alternativeOfRootId))
          return a.alternativeOfRootId ? 1 : -1;
        return String(a.number || '').localeCompare(String(b.number || ''), 'es', { numeric: true });
      }),
      updatedAt: Math.max(...options.map((q) => Date.parse(q.updatedAt || '') || 0))
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key));
}

/** Alternativas ya existentes: agrupa la vigente de cada opción, no las versiones históricas. */
export function quoteFamilyOf(quote) {
  if (!quote) return [];
  const key = quoteFamilyKey(quote);
  return quoteGroupsOf().find((group) => group.key === key)?.options || [];
}

export function quotePlanLabel(quote) {
  const plan = (quote?.items || []).find((item) =>
    /^INV_(ENTRADA|BASICO|MEDIO|AVANZADO|FULL)$/.test(item.code || ''));
  if (!plan) return '';
  return 'Plan ' + ({ INV_ENTRADA: 'Entrada', INV_BASICO: 'Básico',
    INV_MEDIO: 'Medio', INV_AVANZADO: 'Avanzado', INV_FULL: 'Full' })[plan.code];
}


/**
 * Convierte el borrador del constructor al formato de las RPC quote_preview /
 * save_quote. Precios, conversión de moneda y totales los resuelve el servidor:
 * aquí solo viajan servicio, cantidad y descuentos.
 */
function toRpcPayload(draft) {
  return {
    p_quote: {
      lead_id: draft.leadId,
      alternative_of_root_id: draft.alternativeOfRootId || '',
      seller_name: draft.sellerName || draft.owner || '',
      price_list_id: draft.priceListId,
      currency: draft.currency,
      absorb_iva: draft.currency === 'USD' && draft.absorbIva === true,
      uf_value: draft.ufValue ?? '',
      usd_value: draft.usdValue ?? '',
      uf_date: draft.ufDate || '',
      usd_date: draft.usdDate || '',
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
 * Guarda una cotización. Sin `baseId` crea un número independiente y mantiene
 * vigentes las demás propuestas. Si `alternativeOfRootId` tiene un origen, la
 * nueva cotización será otra opción comercial vinculada, sin reemplazarlo.
 * Con `baseId` se crea solo una revisión de la MISMA opción (historial).
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

/* ---------- Correo de cotización: propuesta comercial ejecutiva ---------- */
const quoteFirstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const nQuote = (value) => Number(value) || 0;
const sumQuote = (items, prop) => items.reduce((acc, item) => acc + nQuote(item[prop]), 0);
const pctQuote = (totals) => quoteDiscountPercent(100 * nQuote(totals.discount) / (nQuote(totals.subtotal) || 1));
const trimQuoteText = (value) => String(value || '').trim().replace(/[.;]+$/, '');
const planQuoteName = (item) => clientServiceName(item).replace(/^Inventario\s*[-–]\s*/i, '');

function quoteProjectionStable(totals, months) {
  const projection = totals?.projection;
  return months > 0 && Array.isArray(projection) && projection.length >= months &&
    projection.slice(0, months).every((row) =>
      Math.abs(nQuote(row.total) - nQuote(totals.monthly?.total)) < 0.015);
}

function quoteScopeBullets(items) {
  const bullets = [];
  const web = items.find((item) => item.code === 'GE_BASE');
  const app = items.find((item) => item.code === 'GE_APP');
  if (web || app) {
    const parts = [];
    if (web) parts.push('Plan Base (plataforma administrativa)');
    if (app) parts.push(fmtNumber(app.quantity) + ' usuarios App para personal en terreno');
    bullets.push('Gestión Externa: ' + parts.join(' y ') + '.');
  }
  for (const item of items) {
    if (item === web || item === app) continue;
    if (/^INV_(ENTRADA|BASICO|MEDIO|AVANZADO|FULL)$/.test(item.code || '')) {
      const details = clientServiceScope(item).split(/\r?\n/)
        .map(trimQuoteText).filter(Boolean).slice(0, 6);
      bullets.push('Inventario ' + planQuoteName(item) +
        (details.length ? ': ' + details.join(', ') : '') + '.');
    } else {
      const quantity = nQuote(item.quantity);
      bullets.push(clientServiceName(item) + (quantity > 1 ? ' (' + fmtNumber(quantity) + ' unidades)' : '') + '.');
    }
  }
  return bullets;
}

function quoteEmailOptionalPack(quote, money) {
  const optional = Array.isArray(quote.optionalItems)
    ? quote.optionalItems : readOptionalQuoteData(quote.notes).items;
  const packs = optional.filter((item) =>
    /ítems|items|inventario/i.test(item.name || '') || /PACK_?(INV|ITEMS)/i.test(item.code || ''));
  if (!packs.length) return '';
  const pack = [...packs].sort((a, b) => nQuote(a.unitPrice) - nQuote(b.unitPrice))[0];
  const label = String(pack.name || '').trim();
  const count = label.match(/(?:inventario|ítems|items)\s*(\d[\d.,]*)/i) ||
    label.match(/(\d[\d.,]*)\s*(?:ítems|items)/i);
  const tax = pack.includesIva ? ' IVA incluido' : ' + IVA';
  const finalPrice = !pack.includesIva && nQuote(pack.total) > 0
    ? ' (' + money(pack.total) + ' IVA incluido)' : '';
  return 'Si más adelante necesitan mayor capacidad, pueden agregar packs de inventario desde ' +
    money(pack.unitPrice) + tax + finalPrice +
    (pack.periodicity === 'unico' ? ' (pago único)' : ' mensuales') +
    ' (' + (count ? count[1] + ' ítems' : label) + ').';
}

/** Plantilla editable con datos de la cotización; no simula descuentos ni vigencias. */
export function buildQuoteEmail(quote, lead) {
  const contact = quoteFirstName(quote.client?.contact || lead?.contact);
  const company = lead?.company || quote.client?.company || 'tu empresa';
  const money = (value) => fmtCurrency(value, quote.currency || 'UF');
  const absorbed = quote.absorbIva === true;
  const items = Array.isArray(quote.items) ? quote.items : [];
  const setupItems = items.filter((item) => item.periodicity === 'unico');
  const monthlyItems = items.filter((item) => item.periodicity !== 'unico');
  const totals = quote.totals || {};
  const setup = totals.setup || {
    subtotal: sumQuote(setupItems, 'subtotal'), discount: sumQuote(setupItems, 'discount'),
    total: sumQuote(setupItems, 'total')
  };
  const monthly = totals.monthly || {
    subtotal: sumQuote(monthlyItems, 'subtotal'), discount: sumQuote(monthlyItems, 'discount'),
    net: sumQuote(monthlyItems, 'total'), total: sumQuote(monthlyItems, 'total')
  };
  const months = nQuote(quote.contractMonths);
  const stable = quoteProjectionStable(totals, months);
  const version = nQuote(quote.version);
  const plan = monthlyItems.find((item) => /^INV_(ENTRADA|BASICO|MEDIO|AVANZADO|FULL)$/.test(item.code || ''));
  const versionText = version ? ', versión ' + version : '';
  const planText = plan ? ', considerando el ' + planQuoteName(plan) + ' de Inventario' : '';
  const body = [
    contact ? 'Estimado ' + contact + ':' : 'Estimados:', '',
    'Junto con saludar, te comparto la ' + (version > 1 ? 'cotización ajustada' : 'propuesta comercial') +
      ' de TaskFlow para ' + company + ' (' + (quote.number || 'sin número') + versionText + ')' + planText + '.', ''
  ];
  const discounts = [];
  if (nQuote(setup.discount) > 0 && nQuote(setup.subtotal) > 0) {
    const fully = nQuote(setup.discount) >= nQuote(setup.subtotal) - 0.005;
    const configuration = setupItems.length === 1 && setupItems[0].code === 'CFG_ADV';
    const work = configuration
      ? 'las ' + fmtNumber(setupItems[0].quantity) + ' horas de configuración avanzada'
      : 'la puesta en marcha';
    const base = ' (valor de lista ' + money(setup.subtotal) +
      (absorbed ? ' IVA incluido' : ' netos + IVA') + ').';
    discounts.push(pctQuote(setup) + ' de descuento en la implementación: ' + work +
      (fully ? (configuration ? ' quedan sin costo' : ' queda sin costo') : ' tienen un precio reducido') + base);
  }
  if (nQuote(monthly.discount) > 0 && nQuote(monthly.subtotal) > 0) {
    discounts.push(pctQuote(monthly) +
      ' de descuento en los servicios mensuales' +
      (stable ? ' durante los ' + months + ' meses del contrato' : ' en la mensualidad presentada') + '.');
  }
  if (discounts.length) body.push(
    'Para ajustarnos a sus requerimientos, aplicamos los siguientes descuentos:', '',
    ...discounts.map((item) => '• ' + item), ''
  );
  if (monthlyItems.length && totals.monthly) {
    const final = absorbed
      ? money(monthly.total) + ' IVA incluido'
      : money(monthly.net) + ' netos + IVA (' + money(monthly.total) + ' IVA incluido)';
    const list = nQuote(monthly.subtotal) > 0
      ? ', en lugar de ' + money(monthly.subtotal) + (absorbed ? ' IVA incluido' : ' netos + IVA')
      : '';
    body.push('Con esto, el valor mensual queda en ' + final +
      (stable ? ', fijo durante todo el contrato' : '') + list + '.');
  }
  if (setupItems.length && !nQuote(setup.discount) && nQuote(setup.total) > 0)
    body.push('La puesta en marcha tiene un valor de pago único de ' + money(setup.total) + ' IVA incluido.');
  const contract = nQuote(quote.total) > 0 ? nQuote(quote.total) : nQuote(totals.contract?.total);
  if (contract > 0) body.push('El valor total del contrato es de ' + money(contract) + ' IVA incluido.');
  if (!stable && Array.isArray(totals.projection) && totals.projection.length > 1)
    body.push('Los valores de los meses siguientes se detallan en la proyección de la cotización.');

  const scope = quoteScopeBullets(monthlyItems);
  const included = Array.isArray(quote.commercialInfo)
    ? quote.commercialInfo.map(trimQuoteText).filter(Boolean) : [];
  if (scope.length || included.length) {
    body.push('', 'La propuesta incluye:', '', ...scope.map((line) => '• ' + line));
    if (included.length) body.push('• ' + included.join('; ') + '.');
  }
  const optional = quoteEmailOptionalPack(quote, money);
  if (optional) body.push('', optional);
  const notes = readOptionalQuoteData(quote.notes).notes.replace(/\[\[TF_EARLY:.*?\]\]/g, '').trim();
  if (notes) body.push('', 'Observaciones: ' + notes);
  if (quote.validUntil) body.push('', 'Propuesta válida hasta ' + fmtDate(quote.validUntil) + '.');
  body.push('', 'Quedo atento a tus comentarios.', '', 'Un cordial saludo.');
  return {
    subject: ('Cotización ' + (quote.number || '') + (version > 1 ? ' v' + version : '') + ' — ' + company).trim(),
    body: body.join('\n').replace(/\n{3,}/g, '\n\n')
  };
}
