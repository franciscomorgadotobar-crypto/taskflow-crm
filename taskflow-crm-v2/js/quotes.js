import { supabase } from './supabase.js';
import { session } from './auth.js';
import { IVA_RATE } from './catalog.js';
import { fmtDate, fmtMoney, fmtNumber, nowISO, toast, uid } from './utils.js';

/**
 * Cotizador. Vive separado de store.js por prolijidad, pero sigue el mismo
 * patrón: `state` en memoria, mutaciones optimistas + escritura async en
 * Supabase, Realtime para que todos vean lo mismo. Cada cotización que se edita
 * genera una VERSIÓN nueva (no se pisa la anterior): `rootId` agrupa todas las
 * versiones de una misma cotización y `isCurrent` marca la vigente.
 */
export const state = { services: [], quotes: [] };

const listeners = new Set();
export const onChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const notify = () => listeners.forEach((fn) => fn(state));

/* ---------- Mapeo ---------- */

const fromDbService = (r) => ({
  id: r.id,
  name: r.name,
  description: r.description || '',
  unit: r.unit || 'unidad',
  netPrice: Number(r.net_price || 0),
  category: r.category || '',
  active: r.active !== false
});

const toDbService = (s) => ({
  name: s.name || '',
  description: s.description || '',
  unit: s.unit || 'unidad',
  net_price: Number(s.netPrice || 0),
  category: s.category || '',
  active: s.active !== false
});

const fromDbItem = (r) => ({
  id: r.id,
  serviceId: r.service_id || '',
  name: r.name,
  unit: r.unit || 'unidad',
  quantity: Number(r.quantity || 0),
  unitPrice: Number(r.unit_price || 0),
  subtotal: Number(r.subtotal || 0),
  position: r.position || 0
});

function fromDbQuote(r, items = []) {
  return {
    id: r.id,
    rootId: r.root_id || r.id,
    version: r.version,
    isCurrent: r.is_current,
    leadId: r.lead_id,
    ownerId: r.owner_id || '',
    owner: r.owner_name || '',
    status: r.status,
    client: r.client_snapshot || {},
    subtotalNeto: Number(r.subtotal_neto || 0),
    iva: Number(r.iva || 0),
    total: Number(r.total || 0),
    notes: r.notes || '',
    validUntil: r.valid_until || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    sentAt: r.sent_at || '',
    items: items.map(fromDbItem).sort((a, b) => a.position - b.position)
  };
}

/* ---------- Hidratación + Realtime ---------- */

let channel = null;

export async function hydrate() {
  const [svcR, qR, itR] = await Promise.all([
    supabase.from('services').select('*').order('name'),
    supabase.from('quotes').select('*').order('created_at', { ascending: false }),
    supabase.from('quote_items').select('*')
  ]);
  [svcR, qR, itR].forEach((r) => r.error && console.error(r.error));

  const itemsByQuote = new Map();
  (itR.data || []).forEach((it) => {
    const arr = itemsByQuote.get(it.quote_id) || [];
    arr.push(it);
    itemsByQuote.set(it.quote_id, arr);
  });

  state.services = (svcR.data || []).map(fromDbService);
  state.quotes = (qR.data || []).map((q) => fromDbQuote(q, itemsByQuote.get(q.id) || []));
  notify();
}

export function startRealtime() {
  if (channel) return;
  channel = supabase
    .channel('crm-quotes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'services' }, () => hydrate())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'quotes' }, () => hydrate())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'quote_items' }, () => hydrate())
    .subscribe();
}

export function stopRealtime() {
  if (channel) supabase.removeChannel(channel);
  channel = null;
}

export function clearLocal() {
  state.services = [];
  state.quotes = [];
  notify();
}

function reportError(action, err) {
  console.error(action, err);
  toast(`${action}: ${err.message || 'no se pudo guardar en el servidor'}`, 'error');
}

/* ---------- Servicios (catálogo) ---------- */

export const getService = (id) => state.services.find((s) => s.id === id) || null;

export function upsertService(input) {
  const id = input.id || uid();
  const existing = getService(id);
  const record = { active: true, description: '', category: '', unit: 'unidad', ...existing, ...input, id };
  const idx = state.services.findIndex((s) => s.id === id);
  if (idx >= 0) state.services[idx] = record;
  else state.services.unshift(record);
  notify();

  const write = existing
    ? supabase.from('services').update(toDbService(record)).eq('id', id)
    : supabase.from('services').insert({ id, ...toDbService(record) });
  write.then(({ error }) => error && reportError('No se pudo guardar el servicio', error));
  return record;
}

export function deleteService(id) {
  state.services = state.services.filter((s) => s.id !== id);
  notify();
  supabase
    .from('services')
    .delete()
    .eq('id', id)
    .then(({ error }) => error && reportError('No se pudo eliminar el servicio', error));
}

/* ---------- Cotizaciones ---------- */

export const getQuote = (id) => state.quotes.find((q) => q.id === id) || null;

export const quotesOf = (leadId) => state.quotes.filter((q) => q.leadId === leadId).sort((a, b) => b.version - a.version);

/** Todas las versiones de una cotización (mismo rootId), la más nueva primero. */
export const versionsOf = (rootId) => state.quotes.filter((q) => q.rootId === rootId).sort((a, b) => b.version - a.version);

export const currentQuoteOf = (rootId) => versionsOf(rootId).find((q) => q.isCurrent) || versionsOf(rootId)[0] || null;

export function computeTotals(items) {
  const subtotalNeto = items.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unitPrice || 0), 0);
  const iva = Math.round(subtotalNeto * IVA_RATE);
  return { subtotalNeto, iva, total: subtotalNeto + iva };
}

/**
 * Guarda una cotización. Sin `baseId` crea la versión 1. Con `baseId` (la
 * versión que se estaba editando) crea la siguiente versión del mismo grupo y
 * deja la anterior marcada como no vigente — nunca se pisa una cotización ya
 * guardada, según lo pedido.
 */
export function saveQuote({ baseId = '', leadId, status, notes = '', validUntil = '', client = {}, items }) {
  const base = baseId ? getQuote(baseId) : null;
  const id = uid();
  // La versión 1 es su propia raíz (root_id null en la base, FK a quotes.id no puede
  // apuntar a un uuid inventado que no exista todavía).
  const rootId = base ? base.rootId : id;
  const version = base ? base.version + 1 : 1;
  const totals = computeTotals(items);
  const owner = session.profile?.name || '';

  const quote = {
    id,
    rootId,
    version,
    isCurrent: true,
    leadId,
    ownerId: session.user?.id || '',
    owner,
    status: status || 'borrador',
    client,
    ...totals,
    notes,
    validUntil,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    sentAt: '',
    items: items.map((it, i) => ({ ...it, id: it.id || uid(), position: i }))
  };

  if (base) base.isCurrent = false;
  state.quotes = state.quotes.filter((q) => q.id !== id);
  state.quotes.unshift(quote);
  notify();

  (async () => {
    try {
      if (base) {
        const { error } = await supabase.from('quotes').update({ is_current: false }).eq('id', base.id);
        if (error) throw error;
      }
      const { error: qErr } = await supabase.from('quotes').insert({
        id,
        root_id: rootId === id ? null : rootId,
        version,
        is_current: true,
        lead_id: leadId,
        owner_id: quote.ownerId || null,
        owner_name: owner,
        status: quote.status,
        client_snapshot: client,
        subtotal_neto: totals.subtotalNeto,
        iva: totals.iva,
        total: totals.total,
        notes,
        valid_until: validUntil || null
      });
      if (qErr) throw qErr;
      if (quote.items.length) {
        const { error: itErr } = await supabase.from('quote_items').insert(
          quote.items.map((it) => ({
            id: it.id,
            quote_id: id,
            service_id: it.serviceId || null,
            name: it.name,
            unit: it.unit,
            quantity: it.quantity,
            unit_price: it.unitPrice,
            subtotal: Number(it.quantity || 0) * Number(it.unitPrice || 0),
            position: it.position
          }))
        );
        if (itErr) throw itErr;
      }
    } catch (err) {
      reportError('No se pudo guardar la cotización', err);
      hydrate();
    }
  })();

  return quote;
}

export function setQuoteStatus(id, status) {
  const q = getQuote(id);
  if (!q) return null;
  q.status = status;
  q.updatedAt = nowISO();
  notify();
  supabase
    .from('quotes')
    .update({ status })
    .eq('id', id)
    .then(({ error }) => error && reportError('No se pudo actualizar el estado', error));
  return q;
}

export function markQuoteSent(id) {
  const q = getQuote(id);
  if (!q) return null;
  q.status = 'enviada';
  q.sentAt = nowISO();
  notify();
  supabase
    .from('quotes')
    .update({ status: 'enviada', sent_at: q.sentAt })
    .eq('id', id)
    .then(({ error }) => error && reportError('No se pudo marcar como enviada', error));
  return q;
}

/** Borra una versión. Si era la vigente, la versión anterior pasa a serlo. */
export function deleteQuote(id) {
  const q = getQuote(id);
  if (!q) return;
  state.quotes = state.quotes.filter((x) => x.id !== id);
  if (q.isCurrent) {
    const next = versionsOf(q.rootId)[0];
    if (next) next.isCurrent = true;
  }
  notify();
  (async () => {
    const { error } = await supabase.from('quotes').delete().eq('id', id);
    if (error) return reportError('No se pudo eliminar la cotización', error);
    if (q.isCurrent) {
      const next = versionsOf(q.rootId)[0];
      if (next) {
        const { error: e2 } = await supabase.from('quotes').update({ is_current: true }).eq('id', next.id);
        if (e2) reportError('No se pudo reactivar la versión anterior', e2);
      }
    }
  })();
}

/* ---------- Correo de cotización ---------- */

const firstName = (full) => String(full || '').trim().split(/\s+/)[0] || '';

/** Cuerpo y asunto por defecto: se muestran en un editor antes de enviar, así que son solo el punto de partida. */
export function buildQuoteEmail(quote, lead) {
  const name = firstName(lead?.contact) || 'equipo';
  const lines = quote.items.map(
    (it) => `- ${it.name} · ${fmtNumber(it.quantity)} ${it.unit} x ${fmtMoney(it.unitPrice)} = ${fmtMoney(it.subtotal ?? it.quantity * it.unitPrice)}`
  );
  const body = [
    `Hola ${name},`,
    '',
    `Te comparto la cotización de servicios para ${lead?.company || 'tu empresa'}:`,
    '',
    ...lines,
    '',
    `Subtotal neto: ${fmtMoney(quote.subtotalNeto)}`,
    `IVA (19%): ${fmtMoney(quote.iva)}`,
    `Total: ${fmtMoney(quote.total)}`,
    quote.validUntil ? `` : '',
    quote.validUntil ? `Válida hasta ${fmtDate(quote.validUntil)}.` : '',
    quote.notes ? '' : '',
    quote.notes || '',
    '',
    'Quedo atento/a a tus comentarios.'
  ]
    .filter((l, i, arr) => !(l === '' && arr[i - 1] === ''))
    .join('\n');
  return { subject: `Cotización TaskFlow — ${lead?.company || ''}`, body };
}
