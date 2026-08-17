import { CLOSED_STAGES, DEFAULT_TEMPLATES, DEFAULT_PROBABILITY, STAGES } from './catalog.js';
import { daysBetween, nowISO, todayISO, uid } from './utils.js';

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
    // La contraseña se deja vacía a propósito: el sitio es público y todo lo
    // que viva en el código queda a la vista de cualquiera. Se define en Configuración.
    settings: {
      profile: { name: 'Francisco Morgado', email: 'franciscomorgado@taskflow.cl', phone: '', password: '' },
      users: []
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
  data.activities = (data.activities || []).map((a) => ({ commitmentDone: false, ...a, id: a.id || uid('act') }));
  if (!Array.isArray(data.templates) || !data.templates.length) data.templates = structuredClone(DEFAULT_TEMPLATES);
  data.templates = data.templates.map((t) => ({ channel: 'both', ...t }));

  data.settings = { ...base.settings, ...(data.settings || {}) };
  data.settings.profile = { ...base.settings.profile, ...(data.settings.profile || {}) };
  data.settings.users = (Array.isArray(data.settings.users) ? data.settings.users : []).map((u) => ({
    id: u.id || uid('user'),
    name: '',
    email: '',
    phone: '',
    password: '',
    role: 'comercial',
    active: true,
    ...u
  }));
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

  const idx = state.leads.findIndex((l) => l.id === id);
  if (idx >= 0) state.leads[idx] = lead;
  else state.leads.push(lead);
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
  state.leads = state.leads.filter((l) => l.id !== id);
  delete state.discoveries[id];
  state.activities = state.activities.filter((a) => a.leadId !== id);
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

export function addActivity(activity, { updateNextAction = true } = {}) {
  const record = { id: uid('act'), commitmentDone: false, ...activity };
  state.activities.push(record);
  const lead = getLead(record.leadId);
  if (lead && record.commitment && updateNextAction) {
    lead.nextAction = record.commitment;
    lead.nextDate = record.commitmentDate || todayISO();
    lead.updatedAt = nowISO();
  }
  persist();
  return record;
}

/** Edita una actividad ya registrada (fecha, detalle, compromiso o su estado). */
export function updateActivity(id, patch, { updateNextAction = false } = {}) {
  const act = state.activities.find((a) => a.id === id);
  if (!act) return null;
  Object.assign(act, patch);
  const lead = getLead(act.leadId);
  if (lead && act.commitment && !act.commitmentDone && updateNextAction) {
    lead.nextAction = act.commitment;
    lead.nextDate = act.commitmentDate || todayISO();
    lead.updatedAt = nowISO();
  }
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

/** Compromisos registrados en actividades que todavía no se marcan como hechos. */
export const pendingCommitments = (leadId) =>
  state.activities
    .filter((a) => (!leadId || a.leadId === leadId) && a.commitment && !a.commitmentDone)
    .sort((a, b) => (a.commitmentDate || '9999-12-31').localeCompare(b.commitmentDate || '9999-12-31'));

export function toggleCommitmentDone(id) {
  const act = state.activities.find((a) => a.id === id);
  if (!act) return null;
  act.commitmentDone = !act.commitmentDone;
  persist();
  return act;
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

/** Días promedio que las oportunidades permanecen en cada etapa. */
export function avgDaysPerStage() {
  const totals = {};
  state.leads.forEach((lead) => {
    const history = lead.stageHistory || [];
    history.forEach((entry, i) => {
      const next = history[i + 1];
      const end = next ? next.at : CLOSED_STAGES.includes(lead.stage) && i === history.length - 1 ? null : nowISO();
      if (!end) return;
      const days = daysBetween(entry.at, end);
      totals[entry.stage] = totals[entry.stage] || { days: 0, n: 0 };
      totals[entry.stage].days += days;
      totals[entry.stage].n += 1;
    });
  });
  return STAGES.map((stage) => ({
    stage,
    days: totals[stage]?.n ? Math.round(totals[stage].days / totals[stage].n) : null
  }));
}

/** Volumen y tasa de cierre por rubro, para ver qué sectores responden mejor. */
export function leadsByIndustry() {
  const groups = {};
  state.leads.forEach((l) => {
    const key = l.industry || 'Sin rubro';
    groups[key] = groups[key] || { industry: key, total: 0, won: 0 };
    groups[key].total += 1;
    if (l.stage === 'Ganado') groups[key].won += 1;
  });
  return Object.values(groups)
    .map((g) => ({ ...g, winRate: g.total ? (g.won / g.total) * 100 : 0 }))
    .sort((a, b) => b.total - a.total);
}
