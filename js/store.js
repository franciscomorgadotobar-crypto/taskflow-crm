import { CLOSED_STAGES, DEFAULT_PROBABILITY, DEFAULT_TEMPLATES, STAGES } from './catalog.js';
import { addDaysISO, daysBetween, nowISO, todayISO, uid, toast } from './utils.js';
import { supabase } from './supabase.js';
import { session } from './auth.js';

const CFG = window.TASKFLOW_CRM_CONFIG;
const SCHEMA_VERSION = 3;

const listeners = new Set();
export const onChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const notify = () => listeners.forEach((fn) => fn(state));

/**
 * Fuente de verdad: Supabase (Postgres + RLS). `state` es una copia en memoria
 * que se hidrata al iniciar sesión y se mantiene al día con Realtime. Cada
 * función que muta algo actualiza `state` al instante (UI sin esperar la red) y
 * dispara la escritura real en segundo plano — si esa escritura falla (por
 * ejemplo, por RLS) se avisa con un toast y se vuelve a hidratar esa tabla para
 * no quedar con datos fantasma en pantalla.
 */
export let state = emptyData();

export function emptyData() {
  return {
    leads: [],
    discoveries: {},
    activities: [],
    templates: structuredClone(DEFAULT_TEMPLATES),
    team: [],
    me: null,
    meta: { version: SCHEMA_VERSION, updatedAt: nowISO(), lastSyncAt: '' }
  };
}

export function persist({ silent = false } = {}) {
  state.meta.updatedAt = nowISO();
  try {
    localStorage.setItem(CFG.storageKey, JSON.stringify(state));
  } catch {
    /* cache best-effort, no es la fuente de verdad */
  }
  if (!silent) notify();
}

function reportError(action, err) {
  console.error(action, err);
  toast(`${action}: ${err.message || 'no se pudo guardar en el servidor'}`, 'error');
}

/* ---------- Mapeo DB <-> estado ---------- */

const fromDbLead = (r) => ({
  id: r.id,
  company: r.company,
  rut: r.rut || '',
  industry: r.industry || '',
  source: r.source || '',
  contact: r.contact || '',
  role: r.role || '',
  email: r.email || '',
  phone: r.phone || '',
  stage: r.stage,
  priority: r.priority || '',
  value: Number(r.value || 0),
  probability: Number(r.probability || 0),
  expectedCloseDate: r.expected_close_date || '',
  nextAction: r.next_action || '',
  nextDate: r.next_date || '',
  nextType: r.next_type || '',
  ownerId: r.owner_id || '',
  owner: r.owner_name || '',
  lossReason: r.loss_reason || '',
  remarketingReason: r.remarketing_reason || '',
  isPrivate: Boolean(r.is_private),
  notes: r.notes || '',
  stageHistory: r.stage_history || [],
  contacts: r.contacts || [],
  createdAt: r.created_at,
  updatedAt: r.updated_at
});

function resolveOwnerId(name) {
  if (!name) return null;
  // Si el nombre coincide con quien tiene la sesión, su UUID es inequívoco aunque
  // exista otra persona con el mismo nombre visible en el equipo.
  if (name === session.profile?.name && session.user?.id) return session.user.id;
  const matches = state.team.filter((x) => x.name === name);
  return matches.length === 1 ? matches[0].id : null;
}

function validatedOwnerId(name, candidateId = '') {
  if (candidateId && state.team.some((x) => x.id === candidateId && x.name === name)) return candidateId;
  return resolveOwnerId(name);
}

const toDbLead = (l) => ({
  company: l.company,
  rut: l.rut || '',
  industry: l.industry || '',
  source: l.source || '',
  contact: l.contact || '',
  role: l.role || '',
  email: l.email || '',
  phone: l.phone || '',
  stage: l.stage,
  priority: l.priority || '',
  value: Number(l.value || 0),
  probability: Number(l.probability || 0),
  expected_close_date: l.expectedCloseDate || null,
  next_action: l.nextAction || '',
  next_date: l.nextDate || null,
  next_type: l.nextType || '',
  owner_id: validatedOwnerId(l.owner, l.ownerId),
  owner_name: l.owner || '',
  loss_reason: l.lossReason || '',
  remarketing_reason: l.remarketingReason || '',
  is_private: Boolean(l.isPrivate),
  notes: l.notes || '',
  stage_history: l.stageHistory || [],
  contacts: l.contacts || []
});

const fromDbDiscovery = (r) => ({
  pain: r.pain || '',
  currentManagement: r.current_management || '',
  technicians: r.technicians || '',
  locations: r.locations || '',
  buyTrigger: r.buy_trigger || '',
  modules: r.modules || [],
  integrations: r.integrations || '',
  successCriteria: r.success_criteria || '',
  technicalNotes: r.technical_notes || '',
  updatedAt: r.updated_at
});

const toDbDiscovery = (leadId, d) => ({
  lead_id: leadId,
  pain: d.pain || '',
  current_management: d.currentManagement || '',
  technicians: d.technicians || '',
  locations: d.locations || '',
  buy_trigger: d.buyTrigger || '',
  modules: d.modules || [],
  integrations: d.integrations || '',
  success_criteria: d.successCriteria || '',
  technical_notes: d.technicalNotes || ''
});

const fromDbActivity = (r) => ({
  id: r.id,
  leadId: r.lead_id || '',
  contactId: r.contact_key || '',
  company: r.company || '',
  type: r.type || '',
  date: r.date,
  owner: r.owner_name || '',
  detail: r.detail || '',
  task: r.task || '',
  system: Boolean(r.system)
});

const toDbActivity = (a) => ({
  lead_id: a.leadId || null,
  contact_key: a.contactId || '',
  company: a.company || '',
  type: a.type || '',
  date: a.date || nowISO(),
  owner_id: validatedOwnerId(a.owner, a.ownerId),
  owner_name: a.owner || '',
  detail: a.detail || '',
  task: a.task || '',
  system: Boolean(a.system)
});

const fromDbTemplate = (r) => ({ id: r.id, name: r.name, channel: r.channel, subject: r.subject || '', body: r.body || '' });
const toDbTemplate = (t) => ({ name: t.name || '', channel: t.channel || 'both', subject: t.subject || '', body: t.body || '' });

const fromDbProfile = (r) => ({ id: r.id, name: r.name || '', email: r.email || '', phone: r.phone || '', role: r.role, active: r.active });

/* ---------- Hidratación + Realtime ---------- */

let channel = null;
let realtimeHydrateTimer = null;
let hydrateGeneration = 0;
let seedTemplatesPromise = null;

function scheduleHydrate() {
  clearTimeout(realtimeHydrateTimer);
  realtimeHydrateTimer = setTimeout(() => {
    hydrate().catch((err) => reportError('No se pudo sincronizar el CRM', err));
  }, 250);
}

export async function hydrate() {
  const generation = ++hydrateGeneration;
  const [leadsR, discR, actR, tplR, teamR] = await Promise.all([
    supabase.from('leads').select('*').order('updated_at', { ascending: false }),
    supabase.from('discoveries').select('*'),
    supabase.from('activities').select('*').order('date', { ascending: false }),
    supabase.from('templates').select('*').order('name'),
    supabase.from('profiles').select('*').order('name')
  ]);
  [leadsR, discR, actR, tplR, teamR].forEach((r) => r.error && console.error(r.error));
  if (generation !== hydrateGeneration) return;

  let nextTemplates = null;
  if (!tplR.error) {
    nextTemplates = (tplR.data || []).map(fromDbTemplate);
    // Si dos hidrataciones detectan una organización vacía casi al mismo tiempo,
    // ambas comparten la misma siembra para no duplicar las plantillas de fábrica.
    if (!nextTemplates.length && ['super', 'admin'].includes(session.profile?.role)) {
      nextTemplates = await seedDefaultTemplates();
      if (generation !== hydrateGeneration) return;
    }
  }

  // Publicamos el snapshot en un solo tramo, después de cualquier await adicional.
  // Así una hidratación antigua nunca deja estado parcial mientras llega otra más nueva.
  if (!leadsR.error) state.leads = (leadsR.data || []).map(fromDbLead);
  if (!discR.error) state.discoveries = Object.fromEntries((discR.data || []).map((r) => [r.lead_id, fromDbDiscovery(r)]));
  if (!actR.error) state.activities = (actR.data || []).map(fromDbActivity);
  if (nextTemplates) state.templates = nextTemplates;
  if (!teamR.error) {
    state.team = (teamR.data || []).map(fromDbProfile);
    state.me = state.team.find((t) => t.id === session.user?.id) || null;
  }

  const syncOk = [leadsR, discR, actR, tplR, teamR].every((r) => !r.error);
  if (syncOk) state.meta.lastSyncAt = nowISO();
  persist();
}

/** La primera vez que alguien entra no hay plantillas: se cargan las de fábrica una sola vez. */
async function seedDefaultTemplates() {
  if (!seedTemplatesPromise) {
    seedTemplatesPromise = (async () => {
      const rows = DEFAULT_TEMPLATES.map(({ id, ...t }) => toDbTemplate(t));
      const { data, error } = await supabase.from('templates').insert(rows).select();
      if (error) throw error;
      if (data?.length !== rows.length) {
        throw new Error(`El servidor confirmó ${data?.length || 0} de ${rows.length} plantillas iniciales.`);
      }
      return data.map(fromDbTemplate);
    })();
  }
  try {
    return await seedTemplatesPromise;
  } finally {
    seedTemplatesPromise = null;
  }
}

export function startRealtime() {
  if (channel) return;
  channel = supabase
    .channel('crm-core')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, scheduleHydrate)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'discoveries' }, scheduleHydrate)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'activities' }, scheduleHydrate)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'templates' }, scheduleHydrate)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, scheduleHydrate)
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
  state = emptyData();
  try {
    localStorage.removeItem(CFG.storageKey);
  } catch {
    /* noop */
  }
  notify();
}

/* ---------- Leads ---------- */

export const getLead = (id) => state.leads.find((l) => l.id === id) || null;

export function canEditLeadLocally(leadOrId) {
  const lead = typeof leadOrId === 'string' ? getLead(leadOrId) : leadOrId;
  if (!lead) return false;
  if (['super', 'admin'].includes(session.profile?.role)) return true;
  return session.profile?.role === 'comercial' && Boolean(lead.ownerId) && lead.ownerId === session.user?.id;
}

export function upsertLead(input) {
  const id = input.id || uid();
  const existing = getLead(id);
  const before = existing ? structuredClone(existing) : null;
  const lead = {
    ...(existing || { createdAt: nowISO(), stageHistory: [{ stage: input.stage || 'Lead', at: nowISO() }], contacts: [] }),
    ...input,
    id,
    value: Number(input.value || 0),
    probability: Number(input.probability || 0),
    updatedAt: nowISO()
  };

  if (existing && existing.stage !== lead.stage) {
    lead.stageHistory = [...(existing.stageHistory || []), { stage: lead.stage, at: nowISO() }];
  }
  if (lead.stage !== 'Perdido') lead.lossReason = '';

  const reassigned = existing && existing.owner !== lead.owner;
  const previousOwner = existing?.owner || '';
  const actor = reassigned ? session.profile?.name || 'Usuario sin identificar' : '';

  const idx = state.leads.findIndex((l) => l.id === id);
  if (idx >= 0) state.leads[idx] = lead;
  else state.leads.unshift(lead);

  persist();

  const write = existing
    ? supabase.from('leads').update(toDbLead(lead)).eq('id', id)
    : supabase.from('leads').insert({ id, ...toDbLead(lead) });
  write.then(({ error }) => {
    if (!error) {
      // La trazabilidad se registra solo después de confirmar el cambio del lead.
      // Así nunca se crea en Supabase una reasignación que finalmente fue rechazada.
      if (reassigned) {
        addActivity({
          leadId: id,
          type: 'Asignación',
          date: nowISO(),
          owner: actor,
          detail: `${actor} cambió el responsable de ${previousOwner || 'sin asignar'} a ${lead.owner || 'sin asignar'}.`,
          system: true
        });
      }
      return;
    }
    if (before) {
      const current = state.leads.findIndex((l) => l.id === id);
      if (current >= 0) state.leads[current] = before;
      else state.leads.unshift(before);
    } else {
      state.leads = state.leads.filter((l) => l.id !== id);
    }
    persist();
    reportError('No se pudo guardar el lead', error);
  });

  return lead;
}

/**
 * Variante confirmada para flujos transaccionales (p. ej. Híper Foco).
 * A diferencia de `upsertLead`, espera la respuesta de Postgres antes de dar la
 * operación por cerrada y revierte la copia local si RLS/red rechazan el cambio.
 */
export async function upsertLeadConfirmed(input) {
  const id = input.id || uid();
  const existing = getLead(id);
  const before = existing ? structuredClone(existing) : null;
  const lead = {
    ...(existing || { createdAt: nowISO(), stageHistory: [{ stage: input.stage || 'Lead', at: nowISO() }], contacts: [] }),
    ...input,
    id,
    value: Number(input.value || 0),
    probability: Number(input.probability || 0),
    updatedAt: nowISO()
  };

  if (existing && existing.stage !== lead.stage) {
    lead.stageHistory = [...(existing.stageHistory || []), { stage: lead.stage, at: nowISO() }];
  }
  if (lead.stage !== 'Perdido') lead.lossReason = '';

  const reassigned = existing && existing.owner !== lead.owner;
  const previousOwner = existing?.owner || '';
  const actor = reassigned ? session.profile?.name || 'Usuario sin identificar' : '';

  const idx = state.leads.findIndex((l) => l.id === id);
  if (idx >= 0) state.leads[idx] = lead;
  else state.leads.unshift(lead);
  persist();

  const query = existing
    ? supabase.from('leads').update(toDbLead(lead)).eq('id', id).select('id').single()
    : supabase.from('leads').insert({ id, ...toDbLead(lead) }).select('id').single();
  const { error } = await query;

  if (error) {
    if (before) {
      const current = state.leads.findIndex((l) => l.id === id);
      if (current >= 0) state.leads[current] = before;
    } else {
      state.leads = state.leads.filter((l) => l.id !== id);
    }
    persist();
    reportError('No se pudo confirmar el prospecto en el servidor', error);
    throw error;
  }

  if (reassigned) {
    try {
      await addActivityConfirmed({
        leadId: id,
        type: 'Asignación',
        date: nowISO(),
        owner: actor,
        detail: `${actor} cambió el responsable de ${previousOwner || 'sin asignar'} a ${lead.owner || 'sin asignar'}.`,
        system: true
      });
    } catch (auditError) {
      // La reasignación ya fue confirmada por Postgres. La auditoría es
      // secundaria: no fingimos que el cambio falló, pero tampoco ocultamos
      // que su registro de trazabilidad no pudo persistirse.
      console.error('No se pudo registrar la auditoría de reasignación', auditError);
    }
  }

  return lead;
}

export async function setStage(id, stage, { lossReason = '', remarketingReason = '' } = {}) {
  const lead = getLead(id);
  if (!lead || lead.stage === stage) return lead;
  const before = structuredClone(lead);
  lead.stage = stage;
  lead.lossReason = stage === 'Perdido' ? lossReason : '';
  lead.remarketingReason = stage === 'Remarketing' ? remarketingReason : '';
  lead.probability = DEFAULT_PROBABILITY[stage] ?? lead.probability;
  lead.stageHistory = [...(lead.stageHistory || []), { stage, at: nowISO() }];
  if (stage === 'Ganado' && !lead.nextAction) lead.nextAction = 'Coordinar kick-off e implementación';
  lead.updatedAt = nowISO();
  persist();
  const { data, error: updateError } = await supabase.from('leads').update(toDbLead(lead)).eq('id', id).select('id');
  const error = updateError || (!data?.length ? new Error('El servidor no confirmó el cambio de etapa.') : null);
  if (!error) return lead;
  Object.assign(lead, before);
  persist();
  reportError('No se pudo mover la oportunidad', error);
  return null;
}

export async function updateLead(id, patch) {
  const lead = getLead(id);
  if (!lead) return null;
  const before = structuredClone(lead);
  Object.assign(lead, patch, { updatedAt: nowISO() });
  persist();
  const { data, error: updateError } = await supabase.from('leads').update(toDbLead(lead)).eq('id', id).select('id');
  const error = updateError || (!data?.length ? new Error('El servidor no confirmó la actualización del lead.') : null);
  if (!error) return lead;
  Object.assign(lead, before);
  persist();
  reportError('No se pudo actualizar el lead', error);
  return null;
}

export async function deleteLead(id) {
  const lead = getLead(id);
  if (!lead) return false;

  const leadIndex = state.leads.findIndex((l) => l.id === id);
  const beforeLead = structuredClone(lead);
  const hadDiscovery = Object.prototype.hasOwnProperty.call(state.discoveries, id);
  const beforeDiscovery = hadDiscovery ? structuredClone(state.discoveries[id]) : null;
  const beforeActivities = state.activities.filter((a) => a.leadId === id).map((a) => structuredClone(a));
  const deletionActivityId = uid();
  const actor = session.profile?.name || state.me?.name || 'Usuario sin identificar';

  state.leads = state.leads.filter((l) => l.id !== id);
  delete state.discoveries[id];
  state.activities = state.activities.filter((a) => a.leadId !== id);

  const deletionActivity = {
    id: deletionActivityId,
    leadId: '',
    company: lead.company,
    type: 'Eliminación',
    date: nowISO(),
    owner: actor,
    detail: `${actor} eliminó la oportunidad "${lead.company}" (etapa ${lead.stage}) con su levantamiento e historial.`,
    task: '',
    system: true
  };
  state.activities.push(deletionActivity);
  persist();

  const { data: deletedRows, error: deleteError } = await supabase.from('leads').delete().eq('id', id).select('id');
  const error = deleteError || (!deletedRows?.length ? new Error('El servidor no confirmó la eliminación de la oportunidad.') : null);
  if (error) {
    // Restaura únicamente lo perteneciente a este lead; no revive eliminaciones
    // paralelas que sí hayan sido confirmadas por el servidor.
    if (!state.leads.some((l) => l.id === id)) {
      state.leads.splice(Math.min(Math.max(leadIndex, 0), state.leads.length), 0, beforeLead);
    }
    if (hadDiscovery) state.discoveries[id] = beforeDiscovery;
    else delete state.discoveries[id];

    state.activities = state.activities.filter((a) => a.id !== deletionActivityId && a.leadId !== id);
    state.activities.push(...beforeActivities);
    persist();
    reportError('No se pudo eliminar en el servidor', error);
    return false;
  }

  // La auditoría es global (lead_id NULL) para sobrevivir al cascade del lead.
  const { data: auditRows, error: auditWriteError } = await supabase
    .from('activities')
    .insert({ id: deletionActivity.id, ...toDbActivity(deletionActivity) })
    .select('id');
  const auditError = auditWriteError || (!auditRows?.length ? new Error('El servidor no confirmó la auditoría de eliminación.') : null);

  if (auditError) {
    state.activities = state.activities.filter((a) => a.id !== deletionActivityId);
    persist();
    reportError('La oportunidad se eliminó, pero no se pudo registrar la auditoría', auditError);
  }

  return true;
}

/** Elimina todas las oportunidades visibles para quien ejecuta (RLS decide el alcance real). */
export async function deleteAllVisibleLeads() {
  const ids = state.leads.map((l) => l.id);
  const results = await Promise.allSettled(ids.map((id) => deleteLead(id)));
  const deleted = results.filter((r) => r.status === 'fulfilled' && r.value === true).length;
  return { total: ids.length, deleted, failed: ids.length - deleted };
}

/**
 * Importa un respaldo JSON (exportado desde acá mismo) creando cada registro de
 * nuevo — no reemplaza la base, la complementa. Útil para recuperar un respaldo
 * o mover datos entre ambientes. Cada fila pasa por el mismo camino que crearla
 * a mano, así que RLS decide qué se puede crear.
 */
export async function replaceState(data) {
  const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
  const idMap = new Map();
  const summary = { leads: 0, discoveries: 0, activities: 0, failed: 0 };

  // La importación es deliberadamente secuencial: un respaldo puede contener
  // relaciones entre leads, levantamientos y actividades. Confirmamos cada lead
  // antes de importar sus dependencias y contamos los rechazos en vez de declarar
  // éxito mientras aún hay escrituras pendientes.
  for (const raw of data.leads || []) {
    const oldId = raw.id;
    try {
      const lead = await upsertLeadConfirmed({ ...raw, id: isUuid(oldId) ? oldId : undefined });
      if (oldId) idMap.set(oldId, lead.id);
      summary.leads += 1;
    } catch {
      summary.failed += 1;
    }
  }

  for (const [leadId, d] of Object.entries(data.discoveries || {})) {
    const newId = idMap.get(leadId) || leadId;
    if (!getLead(newId)) {
      summary.failed += 1;
      continue;
    }
    if (await saveDiscovery(newId, d)) summary.discoveries += 1;
    else summary.failed += 1;
  }

  for (const a of data.activities || []) {
    const mappedLeadId = a.leadId ? idMap.get(a.leadId) || a.leadId : '';
    // No importamos una actividad ligada a un lead que no existe: evita crear
    // huérfanos accidentales cuando un lead del respaldo fue rechazado.
    if (mappedLeadId && !getLead(mappedLeadId)) {
      summary.failed += 1;
      continue;
    }
    const record = { task: '', ...a, id: uid(), leadId: mappedLeadId };
    try {
      await addActivityConfirmed(record);
      summary.activities += 1;
    } catch {
      summary.failed += 1;
    }
  }

  return summary;
}

function normalizeDuplicateText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeDuplicateCompany(value) {
  return normalizeDuplicateText(value)
    .replace(/\b(sociedad por acciones|sociedad anonima|limitada|spa|s a|sa|ltda|eirl)\b$/g, '')
    .trim();
}

function normalizeDuplicateRut(value) {
  return String(value ?? '').toUpperCase().replace(/[^0-9K]/g, '');
}

function normalizeDuplicatePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length > 8 ? digits.slice(-8) : digits;
}

function duplicateEmails(lead) {
  return contactsOf(lead)
    .map((contact) => String(contact.email || '').trim().toLocaleLowerCase('es'))
    .filter(Boolean);
}

function duplicatePhones(lead) {
  return contactsOf(lead)
    .map((contact) => normalizeDuplicatePhone(contact.phone))
    .filter((phone) => phone.length >= 8);
}

export function duplicateSignals(a, b) {
  if (!a || !b || a.id === b.id) return { score: 0, reasons: [] };

  let score = 0;
  const reasons = [];

  const rutA = normalizeDuplicateRut(a.rut);
  const rutB = normalizeDuplicateRut(b.rut);
  if (rutA && rutB && rutA === rutB) {
    score += 100;
    reasons.push('RUT');
  }

  const companyA = normalizeDuplicateCompany(a.company);
  const companyB = normalizeDuplicateCompany(b.company);
  if (companyA && companyB && companyA === companyB) {
    score += 70;
    reasons.push('Empresa');
  }

  const emailsA = duplicateEmails(a);
  const emailsB = new Set(duplicateEmails(b));
  if (emailsA.some((email) => emailsB.has(email))) {
    score += 60;
    reasons.push('Correo');
  }

  const phonesA = duplicatePhones(a);
  const phonesB = new Set(duplicatePhones(b));
  if (phonesA.some((phone) => phonesB.has(phone))) {
    score += 45;
    reasons.push('Teléfono');
  }

  return { score, reasons };
}

export function duplicatePairs() {
  const pairs = [];
  for (let i = 0; i < state.leads.length; i += 1) {
    const a = state.leads[i];
    if (!canEditLeadLocally(a)) continue;

    for (let j = i + 1; j < state.leads.length; j += 1) {
      const b = state.leads[j];
      if (!canEditLeadLocally(b)) continue;

      const match = duplicateSignals(a, b);
      if (match.score < 60) continue;

      pairs.push({ a, b, ...match });
    }
  }

  return pairs.sort(
    (x, y) =>
      y.score - x.score ||
      String(x.a.company || '').localeCompare(String(y.a.company || ''), 'es')
  );
}

export function findDuplicate(candidate, excludeId = '') {
  const input = typeof candidate === 'string' ? { company: candidate } : candidate || {};
  const probe = {
    id: '__probe__',
    company: input.company || '',
    rut: input.rut || '',
    contact: input.contact || '',
    role: input.role || '',
    email: input.email || '',
    phone: input.phone || '',
    contacts: input.contacts || []
  };

  let best = null;
  for (const lead of state.leads) {
    if (lead.id === excludeId) continue;
    const match = duplicateSignals(probe, lead);
    if (match.score < 60) continue;
    if (!best || match.score > best.score) best = { lead, ...match };
  }

  return best;
}

export async function mergeDuplicateLeads(targetId, sourceId) {
  const { data, error } = await supabase.rpc('merge_duplicate_leads', {
    p_target_id: targetId,
    p_source_id: sourceId
  });

  if (error) {
    reportError('No se pudo fusionar las oportunidades', error);
    return null;
  }

  return data || { target_id: targetId, source_id: sourceId };
}

/* ---------- Contactos (viven dentro del lead, jsonb) ---------- */

export function contactsOf(lead) {
  if (!lead) return [];
  const primary = lead.contact || lead.email || lead.phone
    ? [{ key: 'primary', name: lead.contact || 'Contacto principal', role: lead.role || '', email: lead.email || '', phone: lead.phone || '', primary: true }]
    : [];
  const extra = (lead.contacts || []).map((c) => ({ key: c.id, name: c.name || '', role: c.role || '', email: c.email || '', phone: c.phone || '', primary: false }));
  return [...primary, ...extra];
}

export const findContact = (lead, key) => contactsOf(lead).find((c) => c.key === key) || null;

export async function addContact(leadId, contact) {
  const lead = getLead(leadId);
  if (!lead) return null;
  const record = { id: uid(), name: '', role: '', email: '', phone: '', ...contact };
  const beforeContacts = structuredClone(lead.contacts || []);
  lead.contacts = [...(lead.contacts || []), record];
  lead.updatedAt = nowISO();
  persist();
  const { data, error: updateError } = await supabase.from('leads').update({ contacts: lead.contacts }).eq('id', leadId).select('id');
  const error = updateError || (!data?.length ? new Error('El servidor no confirmó el contacto.') : null);
  if (!error) return record;
  lead.contacts = beforeContacts;
  persist();
  reportError('No se pudo guardar el contacto', error);
  return null;
}

export async function updateContact(leadId, key, patch) {
  const lead = getLead(leadId);
  if (!lead) return null;
  const before = structuredClone(lead);
  if (key === 'primary') {
    Object.assign(lead, { contact: patch.name, role: patch.role, email: patch.email, phone: patch.phone });
  } else {
    const contact = (lead.contacts || []).find((c) => c.id === key);
    if (!contact) return null;
    Object.assign(contact, patch);
  }
  lead.updatedAt = nowISO();
  persist();
  const { data, error: updateError } = await supabase.from('leads').update(toDbLead(lead)).eq('id', leadId).select('id');
  const error = updateError || (!data?.length ? new Error('El servidor no confirmó la actualización del contacto.') : null);
  if (!error) return lead;
  Object.assign(lead, before);
  persist();
  reportError('No se pudo actualizar el contacto', error);
  return null;
}

export async function deleteContact(leadId, contactId) {
  const lead = getLead(leadId);
  if (!lead) return;
  const beforeContacts = structuredClone(lead.contacts || []);
  lead.contacts = (lead.contacts || []).filter((c) => c.id !== contactId);
  lead.updatedAt = nowISO();
  persist();
  const { data, error: updateError } = await supabase.from('leads').update({ contacts: lead.contacts }).eq('id', leadId).select('id');
  const error = updateError || (!data?.length ? new Error('El servidor no confirmó la eliminación del contacto.') : null);
  if (!error) return true;
  lead.contacts = beforeContacts;
  persist();
  reportError('No se pudo eliminar el contacto', error);
  return false;
}

/* ---------- Levantamiento ---------- */

export const getDiscovery = (leadId) => state.discoveries[leadId] || null;

export async function saveDiscovery(leadId, payload) {
  const before = state.discoveries[leadId] ? structuredClone(state.discoveries[leadId]) : null;
  state.discoveries[leadId] = { ...payload, updatedAt: nowISO() };
  persist();
  const { data, error: writeError } = await supabase.from('discoveries').upsert(toDbDiscovery(leadId, state.discoveries[leadId])).select('lead_id');
  const error = writeError || (!data?.length ? new Error('El servidor no confirmó el levantamiento.') : null);
  if (!error) return true;
  if (before) state.discoveries[leadId] = before;
  else delete state.discoveries[leadId];
  persist();
  reportError('No se pudo guardar el levantamiento', error);
  return false;
}

/* ---------- Actividades ---------- */

export function addActivity(activity, { silent = false } = {}) {
  const record = { id: uid(), task: '', ...activity };
  state.activities.unshift(record);
  if (!silent) persist();
  supabase
    .from('activities')
    .insert({ id: record.id, ...toDbActivity(record) })
    .then(({ error }) => {
      if (!error) return;
      state.activities = state.activities.filter((a) => a.id !== record.id);
      persist();
      reportError('No se pudo registrar la actividad', error);
    });
  return record;
}


export async function addActivityConfirmed(activity, { silent = false } = {}) {
  const record = {
    id: activity.id || uid(),
    task: '',
    ...activity
  };
  state.activities.unshift(record);
  persist();
  const { data, error: insertError } = await supabase.from('activities').insert({ id: record.id, ...toDbActivity(record) }).select('id');
  const error = insertError || (!data?.length ? new Error('El servidor no confirmó la actividad.') : null);
  if (error) {
    state.activities = state.activities.filter((a) => a.id !== record.id);
    persist();
    if (!silent) reportError('No se pudo registrar la actividad', error);
    throw error;
  }
  return record;
}


export async function recordActivityWithFollowupAtomic(
  activity,
  { resolveCurrentTask = false, setFollowup = false, nextType = '', nextAction = '', nextDate = '' } = {}
) {
  const lead = getLead(activity.leadId);
  if (!lead) return null;

  const currentTask = taskOf(lead);
  const record = { id: activity.id || uid(), task: '', ...activity };
  const ownerId = resolveOwnerId(record.owner) || (record.owner && record.owner === session.profile?.name ? session.user.id : null);

  const { error } = await supabase.rpc('record_activity_with_followup', {
    p_lead_id: record.leadId,
    p_activity_id: record.id,
    p_contact_key: record.contactId || '',
    p_type: record.type || '',
    p_date: record.date || nowISO(),
    p_owner_id: ownerId,
    p_owner_name: record.owner || '',
    p_detail: record.detail || '',
    p_resolve_current_task: Boolean(resolveCurrentTask),
    p_set_followup: Boolean(setFollowup),
    p_next_type: setFollowup ? nextType || '' : '',
    p_next_action: setFollowup ? nextAction || '' : '',
    p_next_date: setFollowup ? nextDate || null : null
  });

  if (error) {
    reportError('No se pudo registrar la actividad', error);
    return null;
  }

  record.task = resolveCurrentTask ? currentTask?.title || '' : '';
  state.activities.unshift(record);

  if (setFollowup) {
    lead.nextType = nextType || '';
    lead.nextAction = nextAction || '';
    lead.nextDate = nextDate || '';
    lead.updatedAt = nowISO();
  } else if (resolveCurrentTask) {
    lead.nextType = '';
    lead.nextAction = '';
    lead.nextDate = '';
    lead.updatedAt = nowISO();
  }

  persist();
  return record;
}

export async function resolveTaskWithActivityAtomic(activity) {
  const lead = getLead(activity.leadId);
  if (!lead) return null;
  const before = structuredClone(lead);
  const record = { id: activity.id || uid(), task: '', ...activity };
  const ownerId = resolveOwnerId(record.owner) || (record.owner && record.owner === session.profile?.name ? session.user.id : null);

  state.activities.unshift(record);
  lead.nextType = '';
  lead.nextAction = '';
  lead.nextDate = '';
  lead.updatedAt = nowISO();
  persist();

  const { error } = await supabase.rpc('resolve_task_with_activity', {
    p_lead_id: record.leadId,
    p_activity_id: record.id,
    p_contact_key: record.contactId || '',
    p_type: record.type || '',
    p_date: record.date || nowISO(),
    p_owner_id: ownerId,
    p_owner_name: record.owner || '',
    p_detail: record.detail || '',
    p_task: record.task || ''
  });
  if (!error) return record;

  state.activities = state.activities.filter((a) => a.id !== record.id);
  Object.assign(lead, before);
  persist();
  reportError('No se pudo registrar la actividad y resolver la tarea', error);
  return null;
}

export async function updateActivity(id, patch) {
  const act = state.activities.find((a) => a.id === id);
  if (!act) return null;
  const before = structuredClone(act);
  Object.assign(act, patch);
  persist();
  const { data, error: updateError } = await supabase.from('activities').update(toDbActivity(act)).eq('id', id).select('id');
  const error = updateError || (!data?.length ? new Error('El servidor no confirmó la actualización de la actividad.') : null);
  if (!error) return act;
  Object.assign(act, before);
  persist();
  reportError('No se pudo actualizar la actividad', error);
  return null;
}

export const getActivity = (id) => state.activities.find((a) => a.id === id) || null;
export const hasActivity = (id) => Boolean(getActivity(id));

export async function deleteActivity(id) {
  const index = state.activities.findIndex((a) => a.id === id);
  const before = index >= 0 ? state.activities[index] : null;
  state.activities = state.activities.filter((a) => a.id !== id);
  persist();
  const { data, error: deleteError } = await supabase.from('activities').delete().eq('id', id).select('id');
  const error = deleteError || (!data?.length ? new Error('El servidor no confirmó la eliminación de la actividad.') : null);
  if (!error) return true;
  if (before && !state.activities.some((a) => a.id === id)) {
    state.activities.splice(Math.min(Math.max(index, 0), state.activities.length), 0, before);
  }
  persist();
  reportError('No se pudo eliminar la actividad', error);
  return false;
}

export const activitiesOf = (leadId) =>
  state.activities.filter((a) => a.leadId === leadId).sort((a, b) => String(b.date).localeCompare(String(a.date)));

/* ---------- Tareas (viven en el propio lead) ---------- */

export function taskOf(lead) {
  if (!lead || lead.stage === 'Perdido') return null;
  if (!lead.nextAction && !lead.nextDate && !lead.nextType) return null;
  return {
    key: lead.id,
    lead,
    type: lead.nextType || '',
    note: lead.nextAction || '',
    title: [lead.nextType, lead.nextAction].filter(Boolean).join(' · ') || 'Sin detalle',
    date: lead.nextDate || ''
  };
}

export const openTasks = () =>
  state.leads
    .map((lead) => taskOf(lead))
    .filter(Boolean)
    .sort((a, b) => (a.date || '9999-12-31').localeCompare(b.date || '9999-12-31'));

export function completeTask(leadId, { type, date, result, nextType = '', nextAction = '', nextDate = '' }) {
  const lead = getLead(leadId);
  if (!lead) return null;
  const before = structuredClone(lead);
  const closed = taskOf(lead);
  const record = addActivity(
    { leadId, type, date: date || nowISO(), owner: lead.owner || '', detail: result, task: closed?.title || '' },
    { silent: true }
  );
  const hasNext = Boolean(nextType || nextAction);
  lead.nextType = hasNext ? nextType : '';
  lead.nextAction = hasNext ? nextAction : '';
  lead.nextDate = hasNext ? nextDate : '';
  lead.updatedAt = nowISO();
  persist();
  supabase
    .from('leads')
    .update(toDbLead(lead))
    .eq('id', leadId)
    .then(({ error }) => {
      if (!error) return;
      Object.assign(lead, before);
      persist();
      reportError('No se pudo cerrar la tarea', error);
    });
  return record;
}

/**
 * Cierre transaccional para el flujo normal mediante el RPC de 0010.
 * Gestionar pendientes continúa usando completeTask() y conserva exactamente
 * su comportamiento.
 */
export async function completeTaskAtomic(leadId, { type, date, result, nextType = '', nextAction = '', nextDate = '' }) {
  const lead = getLead(leadId);
  if (!lead) return null;

  const before = structuredClone(lead);
  const closed = taskOf(lead);
  const hasNext = Boolean(nextType || nextAction);
  const record = {
    id: uid(),
    leadId,
    type,
    date: date || nowISO(),
    owner: lead.owner || '',
    detail: result,
    task: closed?.title || ''
  };

  state.activities.unshift(record);
  lead.nextType = hasNext ? nextType : '';
  lead.nextAction = hasNext ? nextAction : '';
  lead.nextDate = hasNext ? nextDate : '';
  lead.updatedAt = nowISO();
  persist();

  const { error } = await supabase.rpc('complete_task', {
    p_lead_id: leadId,
    p_activity_id: record.id,
    p_type: record.type || '',
    p_date: record.date,
    p_result: result,
    p_task: record.task || '',
    p_next_type: hasNext ? nextType : '',
    p_next_action: hasNext ? nextAction : '',
    p_next_date: hasNext ? nextDate || null : null
  });
  if (error) {
    state.activities = state.activities.filter((a) => a.id !== record.id);
    Object.assign(lead, before);
    persist();
    reportError('No se pudo cerrar la tarea', error);
    return null;
  }

  return record;
}

/* ---------- Plantillas ---------- */

export async function saveTemplate(id, patch) {
  const t = state.templates.find((x) => x.id === id);
  if (!t) return null;
  const before = structuredClone(t);
  Object.assign(t, patch);
  persist();
  const { data, error: updateError } = await supabase.from('templates').update(toDbTemplate(t)).eq('id', id).select('id');
  const error = updateError || (!data?.length ? new Error('El servidor no confirmó la plantilla.') : null);
  if (!error) return t;
  Object.assign(t, before);
  persist();
  reportError('No se pudo guardar la plantilla', error);
  return null;
}

export async function addTemplate(channel_ = 'both') {
  const record = { id: uid(), name: 'Nueva plantilla', channel: channel_, subject: '', body: '' };
  state.templates.push(record);
  persist();
  const { data, error: insertError } = await supabase.from('templates').insert({ id: record.id, ...toDbTemplate(record) }).select('id');
  const error = insertError || (!data?.length ? new Error('El servidor no confirmó la nueva plantilla.') : null);
  if (!error) return record;
  state.templates = state.templates.filter((t) => t.id !== record.id);
  persist();
  reportError('No se pudo crear la plantilla', error);
  return null;
}

export async function deleteTemplate(id) {
  if (state.templates.length <= 1) return false;
  const index = state.templates.findIndex((t) => t.id === id);
  const before = index >= 0 ? state.templates[index] : null;
  state.templates = state.templates.filter((t) => t.id !== id);
  persist();
  const { data, error: deleteError } = await supabase.from('templates').delete().eq('id', id).select('id');
  const error = deleteError || (!data?.length ? new Error('El servidor no confirmó la eliminación de la plantilla.') : null);
  if (!error) return true;
  if (before && !state.templates.some((t) => t.id === id)) {
    state.templates.splice(Math.min(Math.max(index, 0), state.templates.length), 0, before);
  }
  persist();
  reportError('No se pudo eliminar la plantilla', error);
  return false;
}

/* ---------- Equipo ---------- */

/** Nombres para filtros: equipo activo + responsables históricos todavía presentes en leads. */
export function ownerNames() {
  const names = [...state.team.filter((t) => t.active && t.name).map((t) => t.name), ...state.leads.map((l) => l.owner)].filter(
    Boolean
  );
  return [...new Set(names)];
}

/** Guarda mi propio nombre/teléfono (el correo lo gestiona la sesión, no se edita acá). */
export async function saveProfile(patch) {
  if (!state.me) return null;
  const before = structuredClone(state.me);
  Object.assign(state.me, patch);
  const idx = state.team.findIndex((t) => t.id === state.me.id);
  if (idx >= 0) state.team[idx] = state.me;
  persist();
  const { data, error: updateError } = await supabase
    .from('profiles')
    .update({ name: patch.name ?? state.me.name, phone: patch.phone ?? state.me.phone })
    .eq('id', state.me.id)
    .select('id');
  const error = updateError || (!data?.length ? new Error('El servidor no confirmó tu perfil.') : null);
  if (!error) return state.me;
  Object.assign(state.me, before);
  const current = state.team.findIndex((t) => t.id === state.me.id);
  if (current >= 0) state.team[current] = state.me;
  persist();
  reportError('No se pudo guardar tu perfil', error);
  return null;
}

/** Edita el perfil de otra persona del equipo (rol/activo/nombre/teléfono) — solo admin/super por RLS. */
export async function updateUser(id, patch) {
  const t = state.team.find((x) => x.id === id);
  if (!t) return null;
  const before = structuredClone(t);
  Object.assign(t, patch);
  persist();
  const payload = {};
  if ('name' in patch) payload.name = patch.name;
  if ('phone' in patch) payload.phone = patch.phone;
  if ('role' in patch) payload.role = patch.role;
  if ('active' in patch) payload.active = patch.active;
  const { data, error: updateError } = await supabase.from('profiles').update(payload).eq('id', id).select('id');
  const error = updateError || (!data?.length ? new Error('El servidor no confirmó la actualización del usuario.') : null);
  if (!error) return t;
  Object.assign(t, before);
  persist();
  reportError('No se pudo actualizar a esa persona', error);
  return null;
}

/* ---------- Métricas ---------- */

export const openLeads = () => state.leads.filter((l) => !CLOSED_STAGES.includes(l.stage));

export function metrics() {
  const open = openLeads();
  const won = state.leads.filter((l) => l.stage === 'Ganado');
  const lost = state.leads.filter((l) => l.stage === 'Perdido');
  const closed = won.length + lost.length;

  const pipelineValue = open.reduce((s, l) => s + Number(l.value || 0), 0);
  const weighted = open.reduce((s, l) => s + Number(l.value || 0) * (Number(l.probability || 0) / 100), 0);
  const wonValue = won.reduce((s, l) => s + Number(l.value || 0), 0);
  const overdue = open.filter((l) => l.nextDate && l.nextDate < todayISO());
  const stale = open.filter((l) => !l.nextDate && daysBetween(l.updatedAt) > 14);

  const cycles = won
    .map((l) => {
      const end = l.stageHistory?.find((h) => h.stage === 'Ganado')?.at;
      return end ? daysBetween(l.createdAt, end) : null;
    })
    .filter((n) => n != null);

  return {
    open,
    won,
    lost,
    pipelineValue,
    weighted,
    wonValue,
    avgTicket: won.length ? wonValue / won.length : 0,
    winRate: closed ? (won.length / closed) * 100 : 0,
    overdue,
    stale,
    avgCycleDays: cycles.length ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : 0,
    stageCounts: STAGES.map((s) => ({ stage: s, count: state.leads.filter((l) => l.stage === s).length })),
    lossReasons: Object.entries(
      lost.reduce((acc, l) => {
        const key = l.lossReason || 'Sin motivo registrado';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1])
  };
}

export function groupLeads(dimension) {
  const today = todayISO();
  const limit = addDaysISO(today, 1);

  if (dimension === 'stage') {
    return STAGES.map((s) => ({ label: s, value: state.leads.filter((l) => l.stage === s).length }));
  }

  if (dimension === 'taskState') {
    const order = ['Vencidas', 'Vencen hoy o mañana', 'Agendadas', 'Sin tarea'];
    const counts = Object.fromEntries(order.map((k) => [k, 0]));
    state.leads.forEach((lead) => {
      const task = taskOf(lead);
      if (!task) counts['Sin tarea'] += 1;
      else if (!task.date || task.date < today) counts['Vencidas'] += 1;
      else if (task.date <= limit) counts['Vencen hoy o mañana'] += 1;
      else counts['Agendadas'] += 1;
    });
    return order.map((k) => ({ label: k, value: counts[k] }));
  }

  const tally = new Map();
  if (dimension === 'taskType') {
    state.leads.forEach((lead) => {
      const task = taskOf(lead);
      if (!task) return;
      const key = task.type || 'Sin tipo';
      tally.set(key, (tally.get(key) || 0) + 1);
    });
  } else {
    const field = { industry: 'industry', owner: 'owner', source: 'source' }[dimension];
    if (!field) return [];
    state.leads.forEach((lead) => {
      const key = lead[field] || 'Sin definir';
      tally.set(key, (tally.get(key) || 0) + 1);
    });
  }
  return [...tally]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
}
