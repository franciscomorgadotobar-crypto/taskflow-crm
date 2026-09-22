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
  const t = state.team.find((x) => x.name === name);
  return t ? t.id : null;
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
  owner_id: resolveOwnerId(l.owner) || (l.owner && l.owner === session.profile?.name ? session.user.id : null),
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
  owner_id: resolveOwnerId(a.owner) || (a.owner && a.owner === session.profile?.name ? session.user.id : null),
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

function scheduleHydrate() {
  clearTimeout(realtimeHydrateTimer);
  realtimeHydrateTimer = setTimeout(() => {
    hydrate().catch((err) => reportError('No se pudo sincronizar el CRM', err));
  }, 250);
}

export async function hydrate() {
  const [leadsR, discR, actR, tplR, teamR] = await Promise.all([
    supabase.from('leads').select('*').order('updated_at', { ascending: false }),
    supabase.from('discoveries').select('*'),
    supabase.from('activities').select('*').order('date', { ascending: false }),
    supabase.from('templates').select('*').order('name'),
    supabase.from('profiles').select('*').order('name')
  ]);
  [leadsR, discR, actR, tplR, teamR].forEach((r) => r.error && console.error(r.error));

  state.leads = (leadsR.data || []).map(fromDbLead);
  state.discoveries = Object.fromEntries((discR.data || []).map((r) => [r.lead_id, fromDbDiscovery(r)]));
  state.activities = (actR.data || []).map(fromDbActivity);
  state.templates = (tplR.data || []).map(fromDbTemplate);
  if (!state.templates.length) await seedDefaultTemplates();
  state.team = (teamR.data || []).map(fromDbProfile);
  state.me = state.team.find((t) => t.id === session.user?.id) || null;
  state.meta.lastSyncAt = nowISO();
  persist();
}

/** La primera vez que alguien entra no hay plantillas: se cargan las de fábrica una sola vez. */
async function seedDefaultTemplates() {
  const rows = DEFAULT_TEMPLATES.map(({ id, ...t }) => toDbTemplate(t));
  const { data, error } = await supabase.from('templates').insert(rows).select();
  if (error) return console.error(error);
  state.templates = (data || []).map(fromDbTemplate);
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
  if (channel) supabase.removeChannel(channel);
  channel = null;
  clearTimeout(realtimeHydrateTimer);
  realtimeHydrateTimer = null;
}

export function clearLocal() {
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

export function upsertLead(input) {
  const id = input.id || uid();
  const existing = getLead(id);
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

  const idx = state.leads.findIndex((l) => l.id === id);
  if (idx >= 0) state.leads[idx] = lead;
  else state.leads.unshift(lead);

  if (reassigned) {
    const actor = session.profile?.name || 'Usuario sin identificar';
    addActivity(
      {
        leadId: id,
        type: 'Asignación',
        date: nowISO(),
        owner: actor,
        detail: `${actor} cambió el responsable de ${existing.owner || 'sin asignar'} a ${lead.owner || 'sin asignar'}.`,
        system: true
      },
      { silent: true }
    );
  }

  persist();

  const write = existing
    ? supabase.from('leads').update(toDbLead(lead)).eq('id', id)
    : supabase.from('leads').insert({ id, ...toDbLead(lead) });
  write.then(({ error }) => error && reportError('No se pudo guardar el lead', error));

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

  return lead;
}

export function setStage(id, stage, { lossReason = '', remarketingReason = '' } = {}) {
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
  supabase
    .from('leads')
    .update(toDbLead(lead))
.eq('id', id)
    .then(({ error }) => {
      if (!error) return;
      Object.assign(lead, before);
      persist();
      reportError('No se pudo mover la oportunidad', error);
    });
  return lead;
}

export function updateLead(id, patch) {
  const lead = getLead(id);
  if (!lead) return null;
  const before = structuredClone(lead);
  Object.assign(lead, patch, { updatedAt: nowISO() });
  persist();
  supabase
    .from('leads')
    .update(toDbLead(lead))
.eq('id', id)
    .then(({ error }) => {
      if (!error) return;
      Object.assign(lead, before);
      persist();
      reportError('No se pudo actualizar el lead', error);
    });
  return lead;
}

export function deleteLead(id) {
  const lead = getLead(id);
  if (!lead) return;
  state.leads = state.leads.filter((l) => l.id !== id);
  delete state.discoveries[id];
  state.activities = state.activities.filter((a) => a.leadId !== id);
  state.activities.push({
    id: uid(),
    leadId: '',
    company: lead.company,
    type: 'Eliminación',
    date: nowISO(),
    owner: lead.owner || '',
    detail: `Se eliminó la oportunidad "${lead.company}" (etapa ${lead.stage}) con su levantamiento e historial.`,
    task: '',
    system: true
  });
  persist();
  supabase
    .from('leads')
    .delete()
    .eq('id', id)
    .then(({ error }) => error && reportError('No se pudo eliminar en el servidor', error));
}

/** Elimina todas las oportunidades visibles para quien ejecuta (RLS decide el alcance real). */
export function deleteAllVisibleLeads() {
  const ids = state.leads.map((l) => l.id);
  ids.forEach((id) => deleteLead(id));
}

/**
 * Importa un respaldo JSON (exportado desde acá mismo) creando cada registro de
 * nuevo — no reemplaza la base, la complementa. Útil para recuperar un respaldo
 * o mover datos entre ambientes. Cada fila pasa por el mismo camino que crearla
 * a mano, así que RLS decide qué se puede crear.
 */
export function replaceState(data) {
  const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
  const idMap = new Map();
  (data.leads || []).forEach((raw) => {
    const oldId = raw.id;
    const lead = upsertLead({ ...raw, id: isUuid(oldId) ? oldId : undefined });
    if (oldId) idMap.set(oldId, lead.id);
  });
  Object.entries(data.discoveries || {}).forEach(([leadId, d]) => {
    const newId = idMap.get(leadId) || leadId;
    if (getLead(newId)) saveDiscovery(newId, d);
  });
  (data.activities || []).forEach((a) => {
    addActivity({ ...a, leadId: idMap.get(a.leadId) || a.leadId, id: undefined });
  });
  toast('Importación completada.');
}

export function findDuplicate(company, excludeId = '') {
  const key = String(company || '').trim().toLowerCase();
  if (!key) return null;
  return state.leads.find((l) => l.id !== excludeId && l.company.trim().toLowerCase() === key) || null;
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

export function addContact(leadId, contact) {
  const lead = getLead(leadId);
  if (!lead) return null;
  const record = { id: uid(), name: '', role: '', email: '', phone: '', ...contact };
  const beforeContacts = structuredClone(lead.contacts || []);
  lead.contacts = [...(lead.contacts || []), record];
  lead.updatedAt = nowISO();
  persist();
  supabase
    .from('leads')
    .update({ contacts: lead.contacts })
    .eq('id', leadId)
    .then(({ error }) => {
      if (!error) return;
      lead.contacts = beforeContacts;
      persist();
      reportError('No se pudo guardar el contacto', error);
    });
  return record;
}

export function updateContact(leadId, key, patch) {
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
  supabase
    .from('leads')
    .update(toDbLead(lead))
    .eq('id', leadId)
    .then(({ error }) => {
      if (!error) return;
      Object.assign(lead, before);
      persist();
      reportError('No se pudo actualizar el contacto', error);
    });
  return lead;
}

export function deleteContact(leadId, contactId) {
  const lead = getLead(leadId);
  if (!lead) return;
  const beforeContacts = structuredClone(lead.contacts || []);
  lead.contacts = (lead.contacts || []).filter((c) => c.id !== contactId);
  lead.updatedAt = nowISO();
  persist();
  supabase
    .from('leads')
    .update({ contacts: lead.contacts })
    .eq('id', leadId)
    .then(({ error }) => {
      if (!error) return;
      lead.contacts = beforeContacts;
      persist();
      reportError('No se pudo eliminar el contacto', error);
    });
}

/* ---------- Levantamiento ---------- */

export const getDiscovery = (leadId) => state.discoveries[leadId] || null;

export function saveDiscovery(leadId, payload) {
  const before = state.discoveries[leadId] ? structuredClone(state.discoveries[leadId]) : null;
  state.discoveries[leadId] = { ...payload, updatedAt: nowISO() };
  persist();
  supabase
    .from('discoveries')
    .upsert(toDbDiscovery(leadId, state.discoveries[leadId]))
    .then(({ error }) => {
      if (!error) return;
      if (before) state.discoveries[leadId] = before;
      else delete state.discoveries[leadId];
      persist();
      reportError('No se pudo guardar el levantamiento', error);
    });
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

export function updateActivity(id, patch) {
  const act = state.activities.find((a) => a.id === id);
  if (!act) return null;
  Object.assign(act, patch);
  persist();
  supabase
    .from('activities')
    .update(toDbActivity(act))
    .eq('id', id)
    .then(({ error }) => error && reportError('No se pudo actualizar la actividad', error));
  return act;
}

export const getActivity = (id) => state.activities.find((a) => a.id === id) || null;

export function deleteActivity(id) {
  state.activities = state.activities.filter((a) => a.id !== id);
  persist();
  supabase
    .from('activities')
    .delete()
    .eq('id', id)
    .then(({ error }) => error && reportError('No se pudo eliminar la actividad', error));
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

/* ---------- Plantillas ---------- */

export function saveTemplate(id, patch) {
  const t = state.templates.find((x) => x.id === id);
  if (!t) return null;
  Object.assign(t, patch);
  persist();
  supabase
    .from('templates')
    .update(toDbTemplate(t))
    .eq('id', id)
    .then(({ error }) => error && reportError('No se pudo guardar la plantilla', error));
  return t;
}

export function addTemplate(channel_ = 'both') {
  const record = { id: uid(), name: 'Nueva plantilla', channel: channel_, subject: '', body: '' };
  state.templates.push(record);
  persist();
  supabase
    .from('templates')
    .insert({ id: record.id, ...toDbTemplate(record) })
    .then(({ error }) => error && reportError('No se pudo crear la plantilla', error));
  return record;
}

export function deleteTemplate(id) {
  if (state.templates.length <= 1) return false;
  state.templates = state.templates.filter((t) => t.id !== id);
  persist();
  supabase
    .from('templates')
    .delete()
    .eq('id', id)
    .then(({ error }) => error && reportError('No se pudo eliminar la plantilla', error));
  return true;
}

/* ---------- Equipo ---------- */

/** Nombres seleccionables como responsable: el equipo activo + cualquiera ya asignado a un lead. */
export function ownerNames() {
  const names = [...state.team.filter((t) => t.active && t.name).map((t) => t.name), ...state.leads.map((l) => l.owner)].filter(
    Boolean
  );
  return [...new Set(names)];
}

/** Guarda mi propio nombre/teléfono (el correo lo gestiona la sesión, no se edita acá). */
export function saveProfile(patch) {
  if (!state.me) return null;
  Object.assign(state.me, patch);
  const idx = state.team.findIndex((t) => t.id === state.me.id);
  if (idx >= 0) state.team[idx] = state.me;
  persist();
  supabase
    .from('profiles')
    .update({ name: patch.name ?? state.me.name, phone: patch.phone ?? state.me.phone })
    .eq('id', state.me.id)
    .then(({ error }) => error && reportError('No se pudo guardar tu perfil', error));
  return state.me;
}

/** Edita el perfil de otra persona del equipo (rol/activo/nombre/teléfono) — solo admin/super por RLS. */
export function updateUser(id, patch) {
  const t = state.team.find((x) => x.id === id);
  if (!t) return null;
  Object.assign(t, patch);
  persist();
  const payload = {};
  if ('name' in patch) payload.name = patch.name;
  if ('phone' in patch) payload.phone = patch.phone;
  if ('role' in patch) payload.role = patch.role;
  if ('active' in patch) payload.active = patch.active;
  supabase
    .from('profiles')
    .update(payload)
    .eq('id', id)
    .then(({ error }) => error && reportError('No se pudo actualizar a esa persona', error));
  return t;
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
