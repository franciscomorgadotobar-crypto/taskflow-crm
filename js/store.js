import { CLOSED_STAGES, DEFAULT_PROBABILITY, DEFAULT_PROFILE, DEFAULT_TEMPLATES, DEFAULT_USERS, STAGES } from './catalog.js';
import { addDaysISO, daysBetween, nowISO, todayISO, uid } from './utils.js';

const CFG = window.TASKFLOW_CRM_CONFIG;
const SCHEMA_VERSION = 2;

const listeners = new Set();
export const onChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const notify = () => listeners.forEach((fn) => fn(state));

export function emptyData() {
  return {
    leads: [],
    discoveries: {},
    activities: [],
    templates: structuredClone(DEFAULT_TEMPLATES),
    settings: {
      profile: { ...DEFAULT_PROFILE },
      users: DEFAULT_USERS.map((u) => ({ id: uid('user'), password: '', ...u })),
      seeded: true
    },
    meta: { version: SCHEMA_VERSION, updatedAt: nowISO(), lastSyncAt: '' }
  };
}

/** Normaliza datos antiguos (v1 sin historial de etapa ni motivo de pérdida). */
export function migrate(raw) {
  const base = emptyData();
  const data = { ...base, ...raw, meta: { ...base.meta, ...(raw?.meta || {}) } };

  data.leads = (data.leads || []).map((l) => {
    const lead = {
      lossReason: '',
      remarketingReason: '',
      expectedCloseDate: '',
      nextType: '',
      contacts: [],
      ...l,
      value: Number(l.value || 0),
      probability: l.probability === '' || l.probability == null ? DEFAULT_PROBABILITY[l.stage] ?? 10 : Number(l.probability),
      stage: STAGES.includes(l.stage) ? l.stage : 'Lead',
      createdAt: l.createdAt || nowISO(),
      updatedAt: l.updatedAt || l.createdAt || nowISO()
    };
    if (!Array.isArray(lead.stageHistory) || !lead.stageHistory.length) {
      lead.stageHistory = [{ stage: lead.stage, at: lead.createdAt }];
    }
    if (!Array.isArray(lead.contacts)) lead.contacts = [];
    return lead;
  });

  data.discoveries = data.discoveries || {};
  data.activities = (data.activities || []).map((a) => ({ task: '', company: '', system: false, ...a, id: a.id || uid('act') }));

  // v2: las tareas dejaron de vivir en los compromisos de cada actividad y pasaron
  // a ser la única próxima acción del prospecto. Rescatamos los que quedaron abiertos.
  data.activities.forEach((a) => {
    if (!a.commitment || a.commitmentDone) return;
    const lead = data.leads.find((l) => l.id === a.leadId);
    if (!lead || lead.nextAction) return;
    lead.nextAction = a.commitment;
    lead.nextDate = a.commitmentDate || '';
  });
  if (!Array.isArray(data.templates) || !data.templates.length) data.templates = structuredClone(DEFAULT_TEMPLATES);
  data.templates = data.templates.map((t) => ({ channel: 'both', ...t }));

  const rawSettings = data.settings || {};
  data.settings = { ...base.settings, ...rawSettings };
  data.settings.profile = { ...base.settings.profile, ...(rawSettings.profile || {}) };
  // El equipo se precarga una sola vez; si después lo editan o lo vacían, se respeta.
  const rawUsers = Array.isArray(rawSettings.users) ? rawSettings.users : null;
  const users = rawUsers ?? (rawSettings.seeded ? [] : base.settings.users);
  data.settings.users = users.map((u) => ({
    id: u.id || uid('user'),
    name: '',
    email: '',
    phone: '',
    password: '',
    role: 'comercial',
    active: true,
    ...u
  }));
  data.settings.seeded = true;
  data.meta.version = SCHEMA_VERSION;
  return data;
}

function load() {
  try {
    const raw = localStorage.getItem(CFG.storageKey);
    return raw ? migrate(JSON.parse(raw)) : emptyData();
  } catch {
    return emptyData();
  }
}

export let state = load();

export function persist({ silent = false } = {}) {
  state.meta.updatedAt = nowISO();
  try {
    localStorage.setItem(CFG.storageKey, JSON.stringify(state));
  } catch (err) {
    console.error('No se pudo guardar en este navegador', err);
  }
  if (!silent) notify();
}

export function replaceState(next, { silent = false } = {}) {
  state = migrate(next);
  persist({ silent });
}

/* ---------- Leads ---------- */

export const getLead = (id) => state.leads.find((l) => l.id === id) || null;

export function upsertLead(input) {
  const id = input.id || uid('lead');
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
  else state.leads.push(lead);

  // Reasignar es una decisión comercial: queda registrada con quién, a quién y cuándo.
  if (reassigned) {
    const actor = state.settings.profile.name || 'Usuario sin identificar';
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
  return lead;
}

export function setStage(id, stage, { lossReason = '', remarketingReason = '' } = {}) {
  const lead = getLead(id);
  if (!lead || lead.stage === stage) return lead;
  lead.stage = stage;
  lead.lossReason = stage === 'Perdido' ? lossReason : '';
  lead.remarketingReason = stage === 'Remarketing' ? remarketingReason : '';
  lead.probability = DEFAULT_PROBABILITY[stage] ?? lead.probability;
  lead.stageHistory = [...(lead.stageHistory || []), { stage, at: nowISO() }];
  if (stage === 'Ganado' && !lead.nextAction) lead.nextAction = 'Coordinar kick-off e implementación';
  lead.updatedAt = nowISO();
  persist();
  return lead;
}

/** Actualiza campos puntuales del lead sin tocar el resto (a diferencia de upsertLead, no resetea value/probability). */
export function updateLead(id, patch) {
  const lead = getLead(id);
  if (!lead) return null;
  Object.assign(lead, patch, { updatedAt: nowISO() });
  persist();
  return lead;
}

export function deleteLead(id) {
  const lead = getLead(id);
  if (!lead) return;
  state.leads = state.leads.filter((l) => l.id !== id);
  delete state.discoveries[id];
  state.activities = state.activities.filter((a) => a.leadId !== id);
  // El borrado queda registrado suelto (sin leadId) para que sobreviva a la limpieza.
  state.activities.push({
    id: uid('act'),
    leadId: '',
    company: lead.company,
    type: 'Eliminación',
    date: nowISO(),
    owner: lead.owner || '',
    detail: `Se eliminó la oportunidad “${lead.company}” (etapa ${lead.stage}) con su levantamiento e historial.`,
    task: '',
    system: true
  });
  persist();
}

export function findDuplicate(company, excludeId = '') {
  const key = String(company || '').trim().toLowerCase();
  if (!key) return null;
  return state.leads.find((l) => l.id !== excludeId && l.company.trim().toLowerCase() === key) || null;
}

/* ---------- Contactos ---------- */

/** Todos los contactos de un lead: el principal (campos del lead) + los adicionales. */
export function contactsOf(lead) {
  if (!lead) return [];
  const primary = lead.contact || lead.email || lead.phone
    ? [{ key: 'primary', name: lead.contact || 'Contacto principal', role: lead.role, email: lead.email, phone: lead.phone, primary: true }]
    : [];
  const extra = (lead.contacts || []).map((c) => ({ key: c.id, name: c.name, role: c.role, email: c.email, phone: c.phone }));
  return [...primary, ...extra];
}

export const findContact = (lead, key) => contactsOf(lead).find((c) => c.key === key) || null;

export function addContact(leadId, contact) {
  const lead = getLead(leadId);
  if (!lead) return null;
  const record = { id: uid('contact'), name: '', role: '', email: '', phone: '', ...contact };
  lead.contacts = [...(lead.contacts || []), record];
  lead.updatedAt = nowISO();
  persist();
  return record;
}

/** Edita un contacto. El principal vive en los campos del lead, los demás en lead.contacts. */
export function updateContact(leadId, key, patch) {
  const lead = getLead(leadId);
  if (!lead) return null;
  if (key === 'primary') {
    Object.assign(lead, { contact: patch.name, role: patch.role, email: patch.email, phone: patch.phone });
  } else {
    const contact = (lead.contacts || []).find((c) => c.id === key);
    if (!contact) return null;
    Object.assign(contact, patch);
  }
  lead.updatedAt = nowISO();
  persist();
  return lead;
}

export function deleteContact(leadId, contactId) {
  const lead = getLead(leadId);
  if (!lead) return;
  lead.contacts = (lead.contacts || []).filter((c) => c.id !== contactId);
  lead.updatedAt = nowISO();
  persist();
}

/* ---------- Levantamiento ---------- */

export const getDiscovery = (leadId) => state.discoveries[leadId] || null;

export function saveDiscovery(leadId, payload) {
  state.discoveries[leadId] = { ...payload, updatedAt: nowISO() };
  persist();
}

/* ---------- Actividades ---------- */

/** Registra lo que ocurrió. No agenda nada: la próxima acción se define al cerrar una tarea. */
export function addActivity(activity, { silent = false } = {}) {
  const record = { id: uid('act'), task: '', ...activity };
  state.activities.push(record);
  if (!silent) persist();
  return record;
}

/** Edita una actividad ya registrada (fecha, detalle, compromiso o su estado). */
export function updateActivity(id, patch) {
  const act = state.activities.find((a) => a.id === id);
  if (!act) return null;
  Object.assign(act, patch);
  persist();
  return act;
}

export const getActivity = (id) => state.activities.find((a) => a.id === id) || null;

export function deleteActivity(id) {
  state.activities = state.activities.filter((a) => a.id !== id);
  persist();
}

export const activitiesOf = (leadId) =>
  state.activities.filter((a) => a.leadId === leadId).sort((a, b) => String(b.date).localeCompare(String(a.date)));

/* ---------- Tareas ----------
 * Cada prospecto tiene como máximo UNA tarea abierta: su próxima acción con
 * fecha. Se define al crear el prospecto y se renueva al cerrar la anterior.
 */

/** La tarea abierta de un prospecto, o null si no tiene. */
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

/** Todas las tareas abiertas del CRM, la más urgente primero. */
export const openTasks = () =>
  state.leads
    .map((lead) => taskOf(lead))
    .filter(Boolean)
    .sort((a, b) => (a.date || '9999-12-31').localeCompare(b.date || '9999-12-31'));

/** Cierra la tarea del prospecto: deja constancia de lo ocurrido y agenda la siguiente. */
export function completeTask(leadId, { type, date, result, nextType = '', nextAction = '', nextDate = '' }) {
  const lead = getLead(leadId);
  if (!lead) return null;
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
  return record;
}

/* ---------- Plantillas ---------- */

export function saveTemplate(id, patch) {
  const t = state.templates.find((x) => x.id === id);
  if (!t) return null;
  Object.assign(t, patch);
  persist();
  return t;
}

export function addTemplate(channel = 'both') {
  const record = { id: uid('tpl'), name: 'Nueva plantilla', channel, subject: '', body: '' };
  state.templates.push(record);
  persist();
  return record;
}

export function deleteTemplate(id) {
  if (state.templates.length <= 1) return false;
  state.templates = state.templates.filter((t) => t.id !== id);
  persist();
  return true;
}

/* ---------- Configuración ---------- */

/**
 * Responsables seleccionables: mi usuario, los invitados activos y cualquiera que
 * ya esté asignado a un prospecto (para no perder responsables antiguos).
 */
export function ownerNames() {
  const { profile, users } = state.settings;
  const names = [
    profile.name,
    ...users.filter((u) => u.active && u.name).map((u) => u.name),
    ...state.leads.map((l) => l.owner)
  ].filter(Boolean);
  return [...new Set(names)];
}

export function saveProfile(patch) {
  state.settings.profile = { ...state.settings.profile, ...patch };
  persist();
  return state.settings.profile;
}

export function addUser(user = {}) {
  const record = { id: uid('user'), name: '', email: '', phone: '', password: '', role: 'comercial', active: true, ...user };
  state.settings.users.push(record);
  persist();
  return record;
}

export function updateUser(id, patch) {
  const user = state.settings.users.find((u) => u.id === id);
  if (!user) return null;
  Object.assign(user, patch);
  persist();
  return user;
}

export function deleteUser(id) {
  state.settings.users = state.settings.users.filter((u) => u.id !== id);
  persist();
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

/** Agrupa los prospectos según la dimensión elegida en el gráfico. */
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

