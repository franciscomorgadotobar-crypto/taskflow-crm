import { INDUSTRIES, DEFAULT_PROBABILITY } from './catalog.js';
import { isAdmin, isReadOnly, session } from './auth.js';
import {
  getLead,
  state as crmState
} from './store.js';
import { supabase } from './supabase.js';
import {
  addDaysISO,
  escapeHtml as e,
  fmtDate,
  fmtDateTime,
  localDateTimeInput,
  nowISO,
  openExternal,
  todayISO,
  toast,
  uid
} from './utils.js';

/*
 * Híper Foco
 * ----------
 * Una campaña es una zona de staging comercial. Importar una base NO crea leads.
 * Los registros solo entran al CRM al calificarse (o al enviarlos a Remarketing).
 * Está pensado para bases grandes: la vista lista solo campañas y la sesión carga
 * una cola pequeña de registros disponibles, por lo que 10k/20k filas no se
 * mantienen completas en memoria durante la gestión.
 */

const HF_TYPES = [
  { id: 'prospecting', label: 'Prospección nueva' },
  { id: 'reactivation', label: 'Reactivación' },
  { id: 'remarketing', label: 'Remarketing' },
  { id: 'recovery', label: 'Recuperar no contactados' }
];

const HF_TYPE_LABEL = Object.fromEntries(HF_TYPES.map((x) => [x.id, x.label]));

const STATUS_LABEL = {
  pending: 'Pendiente',
  retry: 'Reintento',
  converted: 'Prospecto',
  remarketing: 'Remarketing',
  discarded: 'Descartado'
};

const CONTACT_RESULTS = {
  contacted: 'Contacté',
  no_answer: 'No contestó',
  busy: 'Ocupado / no disponible',
  wrong_number: 'Número incorrecto',
  wrong_person: 'No es la persona correcta',
  message_sent: 'Mensaje enviado'
};

const COMMERCIAL_RESULTS = {
  interested: 'Interesado',
  send_info: 'Solicita información',
  callback: 'Volver a llamar',
  meeting: 'Agendar reunión',
  not_interested: 'No interesado',
  has_solution: 'Ya tiene solución',
  wrong_person: 'No es la persona correcta',
  message_sent: 'Mensaje enviado'
};

const DISCARD_REASONS = [
  'No interesado',
  'Empresa cerrada / inactiva',
  'Fuera del perfil objetivo',
  'Datos inválidos sin alternativa',
  'Solicitó no ser contactado',
  'Duplicado',
  'Otro'
];

const REMARKETING_REASONS = [
  'No es el momento',
  'Sin presupuesto por ahora',
  'Ya tiene solución, revisar más adelante',
  'Proyecto para próximos meses',
  'Solicita contacto futuro',
  'Otro'
];

const state = {
  campaigns: [],
  stats: {},
  hydrated: false,
  schemaReady: true
};

const listeners = new Set();
export const onChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const notify = () => listeners.forEach((fn) => fn(state));

let realtimeChannel = null;
let realtimeTimer = null;
let hydrateGeneration = 0;
let discardedGeneration = 0;
let uiBound = false;

const importDraft = {
  file: null,
  filename: '',
  sheet: '',
  headers: [],
  rows: [],
  headerIndex: 0,
  mapping: {},
  analysis: null
};

const focus = {
  campaignId: '',
  queue: [],
  record: null,
  selectedContactId: '',
  selectedChannel: 'call',
  contactResult: '',
  commercialResult: '',
  phase: 'ready',
  skipped: new Set(),
  loading: false,
  busy: false,
  messageOpened: false,
  attemptStarted: false,
  phoneSlot: 'primary',
  noteDraft: ''
};

const q = (sel, root = document) => root.querySelector(sel);
const qa = (sel, root = document) => [...root.querySelectorAll(sel)];
const byId = (id) => document.getElementById(id);

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const norm = (v) => clean(v)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('es')
  .replace(/[^a-z0-9]+/g, '');
const normCompany = (v) => norm(v).replace(/(spa|sa|ltda|limitada|eirl|sociedad)$/g, '');
const normRut = (v) => clean(v).replace(/[^0-9kK]/g, '').toUpperCase();
const truthyCell = (v) => clean(v) && !/^(null|undefined|n\/a|na|—|-)$/i.test(clean(v));

function schemaMissing(error) {
  const msg = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return msg.includes('42p01') || msg.includes('pgrst205') || msg.includes('hyperfocus_campaign');
}

function fromDbCampaign(r) {
  return {
    id: r.id,
    createdBy: r.created_by || '',
    name: r.name || '',
    type: r.campaign_type || 'prospecting',
    filename: r.source_filename || '',
    sheet: r.source_sheet || '',
    defaultIndustry: r.default_industry || '',
    mapping: r.mapping || {},
    options: r.options || {},
    sourceMeta: r.source_meta || {},
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

function fromDbRecord(r) {
  return {
    id: r.id,
    campaignId: r.campaign_id,
    rowNumber: Number(r.row_number || 0),
    company: r.company || '',
    rut: r.rut || '',
    industry: r.industry || '',
    region: r.region || '',
    comuna: r.comuna || '',
    city: r.city || '',
    address: r.address || '',
    website: r.website || '',
    contacts: Array.isArray(r.contacts) ? r.contacts : [],
    rawData: r.raw_data || {},
    existingLeadId: r.existing_lead_id || '',
    convertedLeadId: r.converted_lead_id || '',
    claimedBy: r.claimed_by || '',
    claimedAt: r.claimed_at || '',
    status: r.status || 'pending',
    priority: Number(r.priority || 0),
    attempts: Number(r.attempts || 0),
    lastContactAt: r.last_contact_at || '',
    nextRetryAt: r.next_retry_at || '',
    outcome: r.outcome || '',
    discardReason: r.discard_reason || '',
    remarketingReason: r.remarketing_reason || '',
    notes: r.notes || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

function statsRow(r = {}) {
  return {
    total: Number(r.total || 0),
    pending: Number(r.pending || 0),
    retry: Number(r.retry || 0),
    converted: Number(r.converted || 0),
    remarketing: Number(r.remarketing || 0),
    discarded: Number(r.discarded || 0),
    availableNow: Number(r.available_now || 0),
    touched: Number(r.touched || 0)
  };
}

function emptyStats() {
  return statsRow();
}

export async function hydrate() {
  const generation = ++hydrateGeneration;
  const campaignsR = await supabase.from('hyperfocus_campaigns').select('*').order('updated_at', { ascending: false });
  if (generation !== hydrateGeneration) return;
  if (campaignsR.error) {
    if (schemaMissing(campaignsR.error)) {
      state.schemaReady = false;
      state.campaigns = [];
      state.stats = {};
      state.hydrated = true;
      notify();
      return;
    }
    console.error('No se pudieron cargar campañas Híper Foco', campaignsR.error);
    return;
  }

  const nextCampaigns = (campaignsR.data || []).map(fromDbCampaign);
  const statsR = await supabase.from('hyperfocus_campaign_stats').select('*');
  if (generation !== hydrateGeneration) return;

  state.schemaReady = true;
  state.campaigns = nextCampaigns;
  if (statsR.error) {
    // Una lectura fallida de estadísticas no significa que las campañas estén
    // vacías: conservamos el último snapshot válido para no poner contadores a 0.
    console.error('No se pudieron cargar estadísticas Híper Foco', statsR.error);
  } else {
    state.stats = Object.fromEntries((statsR.data || []).map((r) => [r.campaign_id, statsRow(r)]));
  }
  state.hydrated = true;
  notify();
}

export function startRealtime() {
  if (realtimeChannel || !state.schemaReady) return;
  const refreshSoon = () => {
    clearTimeout(realtimeTimer);
    realtimeTimer = setTimeout(() => hydrate(), 300);
  };
  realtimeChannel = supabase
    .channel('crm-hyperfocus')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'hyperfocus_campaigns' }, refreshSoon)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'hyperfocus_records' }, refreshSoon)
    .subscribe();
}

export function stopRealtime() {
  hydrateGeneration += 1;
  clearTimeout(realtimeTimer);
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  realtimeChannel = null;
}

export function clearLocal() {
  hydrateGeneration += 1;
  discardedGeneration += 1;
  state.campaigns = [];
  state.stats = {};
  state.hydrated = false;
  focus.campaignId = '';
  focus.queue = [];
  focus.record = null;
  focus.busy = false;
  notify();
}

const campaignOf = (id) => state.campaigns.find((x) => x.id === id) || null;
const statsOf = (id) => state.stats[id] || emptyStats();

function progressPct(stats) {
  if (!stats.total) return 0;
  return Math.round(((stats.converted + stats.remarketing + stats.discarded) / stats.total) * 100);
}

function canDeleteCampaign(c) {
  return isAdmin() || c.createdBy === session.user?.id;
}

export function renderHyperFocus() {
  if (!state.schemaReady) {
    return `
      <div class="card hf-schema-card">
        <div class="card-head"><h3>Híper Foco necesita activar su base de datos</h3></div>
        <div class="card-body">
          <div class="notice warn">La interfaz está instalada, pero aún falta ejecutar la migración <strong>supabase/0008_hyperfocus.sql</strong> en Supabase.</div>
          <p class="muted">El resto del CRM puede seguir funcionando. Híper Foco no crea ni modifica oportunidades hasta que esa migración exista.</p>
        </div>
      </div>`;
  }

  const writable = !isReadOnly();
  const campaigns = state.campaigns;
  return `
    <section class="hf-view-head">
      <div>
        <h2>Campañas</h2>
        <p>Convierte bases masivas en conversaciones útiles sin llenar el CRM de registros fríos.</p>
      </div>
      ${writable ? `<div class="button-row"><button class="ghost-btn" data-hf-action="new-crm-campaign">+ Desde CRM</button><button class="primary-btn" data-hf-action="new-campaign">+ Importar base</button></div>` : ''}
    </section>

    ${
      campaigns.length
        ? `<div class="hf-campaign-grid">${campaigns.map(renderCampaignCard).join('')}</div>`
        : `<div class="card"><div class="card-body">
            <div class="empty"><strong>Sin campañas todavía</strong><p>Sube una base CSV o Excel. Híper Foco la mantiene separada del CRM hasta que una empresa califique.</p>
            ${writable ? '<button class="primary-btn" data-hf-action="new-campaign">Crear primera campaña</button>' : ''}</div>
          </div></div>`
    }

    <div class="hf-principle">
      <strong>Base importada → Híper Foco → Gestión → CRM</strong>
      <span>Solo los registros calificados pasan a Leads, Pipeline o Remarketing.</span>
    </div>`;
}

function renderCampaignCard(c) {
  const s = statsOf(c.id);
  const done = s.converted + s.remarketing + s.discarded;
  const pct = progressPct(s);
  const writable = !isReadOnly();
  const availableLabel = s.availableNow ? `${s.availableNow} disponibles ahora` : s.retry ? `${s.retry} reintentos programados` : 'Sin pendientes disponibles';

  return `<article class="card hf-campaign-card">
    <div class="hf-campaign-top">
      <div>
        <span class="badge">${e(HF_TYPE_LABEL[c.type] || c.type)}</span>
        <h3>${e(c.name)}</h3>
        <p>${e(c.filename || 'Base importada')}${c.sheet ? ` · ${e(c.sheet)}` : ''}</p>
      </div>
      <span class="hf-campaign-pct">${pct}%</span>
    </div>
    <div class="hf-progress"><span style="width:${pct}%"></span></div>
    <div class="hf-card-stats">
      <div><strong>${s.total}</strong><span>Total</span></div>
      <div><strong>${s.pending + s.retry}</strong><span>Por gestionar</span></div>
      <div><strong>${s.converted}</strong><span>Prospectos</span></div>
      <div><strong>${s.remarketing}</strong><span>Remarketing</span></div>
      ${s.discarded
        ? `<button type="button" class="hf-stat-link" data-hf-action="open-discarded" data-id="${e(c.id)}" title="Ver los registros descartados">
             <strong>${s.discarded}</strong><span>Descartados ›</span>
           </button>`
        : `<div><strong>0</strong><span>Descartados</span></div>`}
    </div>
    <div class="hf-campaign-foot">
      <div><strong>${e(availableLabel)}</strong><span>${done} cerrados · ${s.touched} tocados</span></div>
      <div class="button-row">
        ${writable && (s.pending + s.retry) ? `<button class="primary-btn" data-hf-action="start-session" data-id="${e(c.id)}">${s.touched ? 'Continuar' : 'Iniciar'} Híper Foco</button>` : ''}
        ${canDeleteCampaign(c) ? `<button class="small-btn danger" data-hf-action="delete-campaign" data-id="${e(c.id)}">Eliminar</button>` : ''}
      </div>
    </div>
  </article>`;
}

/* -------------------------------------------------------------------------- */
/* Campañas desde el CRM                                                       */
/* -------------------------------------------------------------------------- */

function editableCrmLeads() {
  return crmState.leads.filter((lead) => canEditExistingLead(lead));
}

function uniqueLeadValues(leads, field) {
  return [...new Set(leads.map((lead) => clean(lead[field])).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
}

function crmCampaignFilters() {
  return {
    stage: byId('hfCrmStage')?.value || '',
    owner: byId('hfCrmOwner')?.value || '',
    industry: byId('hfCrmIndustry')?.value || '',
    source: byId('hfCrmSource')?.value || '',
    withChannel: Boolean(byId('hfCrmWithChannel')?.checked)
  };
}

function crmLeadHasChannel(lead) {
  if (truthyCell(lead.phone) || truthyCell(lead.email)) return true;
  return (lead.contacts || []).some((contact) => truthyCell(contact.phone) || truthyCell(contact.email));
}

function filteredCrmLeads() {
  const filters = crmCampaignFilters();
  return editableCrmLeads()
    .filter((lead) => !filters.stage || lead.stage === filters.stage)
    .filter((lead) => !filters.owner || lead.owner === filters.owner)
    .filter((lead) => !filters.industry || lead.industry === filters.industry)
    .filter((lead) => !filters.source || lead.source === filters.source)
    .filter((lead) => !filters.withChannel || crmLeadHasChannel(lead))
    .sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')));
}

function fillCrmCampaignFilters() {
  const leads = editableCrmLeads();
  const fill = (id, values, label) => {
    const el = byId(id);
    if (!el) return;
    el.innerHTML = '<option value="">' + e(label) + '</option>' + values.map((value) => '<option value="' + e(value) + '">' + e(value) + '</option>').join('');
  };
  fill('hfCrmStage', uniqueLeadValues(leads, 'stage'), 'Todas las etapas');
  fill('hfCrmOwner', uniqueLeadValues(leads, 'owner'), 'Todos los responsables');
  fill('hfCrmIndustry', uniqueLeadValues(leads, 'industry'), 'Todos los rubros');
  fill('hfCrmSource', uniqueLeadValues(leads, 'source'), 'Todos los orígenes');

  const hasRemarketing = leads.some((lead) => lead.stage === 'Remarketing');
  byId('hfCrmCampaignType').value = hasRemarketing ? 'remarketing' : 'reactivation';
  byId('hfCrmCampaignName').value = (hasRemarketing ? 'Remarketing CRM · ' : 'Reactivación CRM · ') + todayISO();
  if (hasRemarketing) byId('hfCrmStage').value = 'Remarketing';
}

function renderCrmCampaignPreview() {
  const root = byId('hfCrmCampaignPreview');
  const btn = byId('hfCreateCrmCampaignBtn');
  if (!root || !btn) return;
  const leads = filteredCrmLeads();
  const noChannel = leads.filter((lead) => !crmLeadHasChannel(lead)).length;
  btn.disabled = !leads.length;
  if (!leads.length) {
    root.innerHTML = '<div class="empty"><strong>Sin oportunidades para este segmento</strong><p>Ajusta los filtros o desactiva “Solo con teléfono o correo”.</p></div>';
    return;
  }
  const preview = leads.slice(0, 8).map((lead) => {
    const meta = [lead.rut ? 'RUT ' + lead.rut : '', lead.stage, lead.owner].filter(Boolean).map(e).join(' · ');
    return '<div class="hf-crm-preview-row"><strong>' + e(lead.company) + '</strong><span>' + meta + '</span></div>';
  }).join('');
  root.innerHTML = '<div class="hf-crm-preview-summary">' +
    '<div><strong>' + leads.length.toLocaleString('es-CL') + '</strong><span>oportunidades</span></div>' +
    '<div><strong>' + (leads.length - noChannel).toLocaleString('es-CL') + '</strong><span>con canal</span></div>' +
    '<div><strong>' + noChannel.toLocaleString('es-CL') + '</strong><span>sin canal</span></div>' +
    '</div><div class="hf-crm-preview-list">' + preview +
    (leads.length > 8 ? '<p class="muted">Y ' + (leads.length - 8).toLocaleString('es-CL') + ' más.</p>' : '') + '</div>';
}

function openCrmCampaignDialog() {
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  if (!editableCrmLeads().length) return toast('No tienes oportunidades editables para crear una campaña.', 'error');
  byId('hfCrmCampaignForm')?.reset();
  fillCrmCampaignFilters();
  byId('hfCrmWithChannel').checked = true;
  renderCrmCampaignPreview();
  byId('hfCrmCampaignDialog')?.showModal();
}

function crmLeadContacts(lead) {
  const contacts = [];
  const primary = makeContact({
    name: lead.contact, role: lead.role, phone: lead.phone, email: lead.email, source: 'Contacto principal del CRM'
  }, true);
  if (primary) contacts.push(primary);
  (lead.contacts || []).forEach((contact) => {
    const item = makeContact({
      name: contact.name, role: contact.role, phone: contact.phone, email: contact.email, source: 'Contacto adicional del CRM'
    }, true);
    if (item) contacts.push(item);
  });
  return dedupeContacts(contacts);
}

function crmLeadToHyperFocusRecord(lead, rowNumber) {
  const contacts = crmLeadContacts(lead);
  return {
    id: uid(), row_number: rowNumber, company: lead.company, rut: lead.rut || '', industry: lead.industry || '',
    region: '', comuna: '', city: '', address: '', website: '', contacts,
    raw_data: {
      'Origen CRM': lead.source || 'CRM TaskFlow',
      'Etapa CRM': lead.stage || '',
      'Responsable CRM': lead.owner || '',
      'Próxima gestión': [lead.nextType, lead.nextAction].filter(Boolean).join(' · '),
      'Fecha próxima gestión': lead.nextDate || '',
      'Observaciones CRM': lead.notes || '',
      'Actualizado CRM': lead.updatedAt || ''
    },
    existing_lead_id: lead.id, status: 'pending', priority: recordPriority(contacts)
  };
}

async function activeHyperFocusLeadIds(leadIds) {
  const active = new Set();
  for (let i = 0; i < leadIds.length; i += 100) {
    const batch = leadIds.slice(i, i + 100);
    const { data, error } = await supabase.from('hyperfocus_records').select('existing_lead_id').in('existing_lead_id', batch).in('status', ['pending', 'retry']);
    if (error) throw error;
    (data || []).forEach((row) => row.existing_lead_id && active.add(row.existing_lead_id));
  }
  return active;
}

async function createCampaignFromCrm(event) {
  event.preventDefault();
  if (isReadOnly()) return;
  const btn = byId('hfCreateCrmCampaignBtn');
  const name = byId('hfCrmCampaignName')?.value.trim() || '';
  if (!name) return toast('Ponle un nombre a la campaña.', 'error');
  const selected = filteredCrmLeads();
  if (!selected.length) return toast('No hay oportunidades para crear esta campaña.', 'error');
  btn.disabled = true;
  let campaign = null;
  try {
    const activeIds = await activeHyperFocusLeadIds(selected.map((lead) => lead.id));
    const leads = selected.filter((lead) => !activeIds.has(lead.id));
    if (!leads.length) {
      toast('Todas las oportunidades seleccionadas ya están pendientes en otra campaña Híper Foco.', 'error');
      return;
    }
    const filters = crmCampaignFilters();
    campaign = {
      id: uid(), created_by: session.user?.id || null, name,
      campaign_type: byId('hfCrmCampaignType')?.value || 'reactivation',
      source_filename: 'CRM TaskFlow', source_sheet: filters.stage || 'Segmento CRM',
      default_industry: filters.industry || '', mapping: {}, options: { source: 'crm', ...filters },
      source_meta: { source: 'crm', selected_records: selected.length, imported_records: leads.length, excluded_active_hyperfocus: activeIds.size, filters }
    };
    const { data: campaignRows, error: campaignWriteError } = await supabase.from('hyperfocus_campaigns').insert(campaign).select('id');
    const campaignError = campaignWriteError || (!campaignRows?.length ? new Error('El servidor no confirmó la campaña.') : null);
    if (campaignError) throw campaignError;
    const rows = leads.map((lead, index) => ({ campaign_id: campaign.id, ...crmLeadToHyperFocusRecord(lead, index + 1) }));
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { data: insertedRows, error: batchError } = await supabase.from('hyperfocus_records').insert(batch).select('id');
      const error = batchError || (insertedRows?.length !== batch.length ? new Error('El servidor no confirmó todos los registros del lote.') : null);
      if (error) throw error;
    }
    byId('hfCrmCampaignDialog')?.close();
    await hydrate();
    const skipped = selected.length - leads.length;
    toast(skipped ? 'Campaña creada con ' + leads.length.toLocaleString('es-CL') + ' oportunidades. ' + skipped.toLocaleString('es-CL') + ' ya estaban activas en Híper Foco y se omitieron.' : 'Campaña creada con ' + leads.length.toLocaleString('es-CL') + ' oportunidades del CRM.');
  } catch (err) {
    console.error(err);
    if (campaign?.id) {
      const { error: cleanupError } = await supabase.from('hyperfocus_campaigns').delete().eq('id', campaign.id);
      if (cleanupError) console.error('No se pudo limpiar la campaña CRM incompleta', cleanupError);
    }
    await hydrate();
    toast(err.message || 'No se pudo crear la campaña desde el CRM.', 'error');
  } finally {
    if (btn?.isConnected) btn.disabled = !filteredCrmLeads().length;
  }
}

/* -------------------------------------------------------------------------- */
/* Importación y mapeo                                                         */
/* -------------------------------------------------------------------------- */

const FIELD_DEFS = [
  { id: 'company', label: 'Empresa / razón social', required: true, group: 'Empresa' },
  { id: 'rut', label: 'RUT', group: 'Empresa' },
  { id: 'industry', label: 'Rubro', group: 'Empresa' },
  { id: 'region', label: 'Región', group: 'Empresa' },
  { id: 'comuna', label: 'Comuna', group: 'Empresa' },
  { id: 'city', label: 'Ciudad', group: 'Empresa' },
  { id: 'address', label: 'Dirección', group: 'Empresa' },
  { id: 'website', label: 'Sitio web', group: 'Empresa' },
  { id: 'contactName', label: 'Nombre contacto', group: 'Contacto principal' },
  { id: 'contactRole', label: 'Cargo contacto', group: 'Contacto principal' },
  { id: 'contactPhone', label: 'Celular / teléfono principal', group: 'Contacto principal' },
  { id: 'contactPhone2', label: 'Teléfono alternativo', group: 'Contacto principal' },
  { id: 'contactEmail', label: 'Correo contacto', group: 'Contacto principal' },
  { id: 'companyPhone', label: 'Teléfono general / registro', group: 'Datos adicionales' },
  { id: 'companyEmail', label: 'Correo general / registro', group: 'Datos adicionales' },
  { id: 'additionalEmails', label: 'Correos adicionales', group: 'Datos adicionales' }
];

const ALIASES = {
  company: ['empresarazonsocial', 'razonsocial', 'nombreempresa', 'empresa', 'company'],
  rut: ['rutempresa', 'rut', 'taxid'],
  industry: ['rubro', 'industria', 'industry', 'categoriaempresa'],
  region: ['region'],
  comuna: ['comuna'],
  city: ['ciudad', 'city'],
  address: ['direccion', 'domicilio', 'address'],
  website: ['sitioweb', 'web', 'website', 'paginaweb'],
  contactName: ['nombretomadordedecisiones', 'nombrecontacto', 'contacto', 'tomadordedecisiones'],
  contactRole: ['cargotd', 'cargocontacto', 'cargotomadordedecisiones', 'cargo'],
  contactPhone: ['telefonotd', 'celularcontacto', 'telefonocontacto', 'celular', 'telefono'],
  contactPhone2: ['telefonocontacto', 'celularcontacto', 'telefonoalternativo', 'telefonosecundario'],
  contactEmail: ['correotd', 'emailcontacto', 'correocontacto', 'email', 'correo'],
  companyPhone: ['telefonoregistro', 'telefonoempresa', 'telefonogeneral'],
  companyEmail: ['emailregistro', 'correoempresa', 'correoregistro', 'emailgeneral'],
  additionalEmails: ['correosadicionalesencrm', 'correosadicionales', 'emailsadicionales']
};

function findHeader(headers, aliases, excluded = new Set()) {
  const normalized = headers.map(norm);
  for (const alias of aliases) {
    const ix = normalized.findIndex((h, i) => !excluded.has(i) && h === alias);
    if (ix >= 0) return ix;
  }
  for (const alias of aliases) {
    const ix = normalized.findIndex((h, i) => !excluded.has(i) && h.includes(alias) && h.length > 3);
    if (ix >= 0) return ix;
  }
  return -1;
}

function detectMapping(headers) {
  const mapping = {};
  const used = new Set();
  for (const def of FIELD_DEFS) {
    let ix = findHeader(headers, ALIASES[def.id] || [], def.id === 'contactPhone2' ? used : new Set());
    // La segunda línea telefónica solo sirve si es realmente otra columna.
    if (def.id === 'contactPhone2' && ix === mapping.contactPhone) ix = -1;
    mapping[def.id] = ix;
    if (['company', 'contactPhone', 'contactPhone2'].includes(def.id) && ix >= 0) used.add(ix);
  }
  return mapping;
}

function resetImportDraft() {
  Object.assign(importDraft, { file: null, filename: '', sheet: '', headers: [], rows: [], headerIndex: 0, mapping: {}, analysis: null });
  if (byId('hfImportForm')) byId('hfImportForm').reset();
  if (byId('hfImportParsed')) byId('hfImportParsed').hidden = true;
  if (byId('hfImportProgress')) byId('hfImportProgress').hidden = true;
  if (byId('hfImportHint')) byId('hfImportHint').textContent = 'CSV o Excel (.xlsx/.xls). La base no entra al CRM al importarla.';
  if (byId('hfCreateCampaignBtn')) byId('hfCreateCampaignBtn').disabled = true;
}

function openImportDialog() {
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  resetImportDraft();
  applyCampaignTypeDefaults();
  byId('hfImportDialog')?.showModal();
}

async function ensureXlsx() {
  if (window.XLSX) return window.XLSX;
  const sources = [
    'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
    'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
  ];
  for (const src of sources) {
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.dataset.hfXlsx = '1';
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
      if (window.XLSX) return window.XLSX;
    } catch {
      q(`script[data-hf-xlsx][src="${src}"]`)?.remove();
    }
  }
  throw new Error('No se pudo cargar el lector de Excel. Puedes usar CSV o revisar la conexión.');
}

function delimiterScore(line, delimiter) {
  let count = 0;
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') i += 1;
      else quoted = !quoted;
    } else if (!quoted && ch === delimiter) count += 1;
  }
  return count;
}

function parseCsvText(text) {
  const line = text.split(/\r?\n/).find((x) => x.trim()) || '';
  const delimiters = [',', ';', '\t', '|'];
  const delimiter = delimiters.sort((a, b) => delimiterScore(line, b) - delimiterScore(line, a))[0] || ',';
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      row.push(value);
      value = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(value);
      if (row.some((x) => clean(x))) rows.push(row);
      row = [];
      value = '';
    } else value += ch;
  }
  row.push(value);
  if (row.some((x) => clean(x))) rows.push(row);
  return rows;
}

function chooseHeaderAndRows(matrix) {
  const candidates = matrix.slice(0, 20).map((row, index) => ({
    index,
    count: row.filter((x) => truthyCell(x)).length
  }));
  const headerIndex = candidates.sort((a, b) => b.count - a.count || a.index - b.index)[0]?.index || 0;
  const rawHeaders = matrix[headerIndex] || [];
  const width = Math.max(rawHeaders.length, ...matrix.slice(headerIndex + 1, headerIndex + 30).map((r) => r.length), 1);
  const seen = new Map();
  const headers = Array.from({ length: width }, (_, i) => {
    const base = clean(rawHeaders[i]) || `Columna ${i + 1}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
  const rows = matrix.slice(headerIndex + 1).filter((r) => r.some((x) => truthyCell(x)));
  return { headers, rows, headerIndex };
}

async function parseUploadedFile(file) {
  const ext = file.name.split('.').pop()?.toLowerCase();
  const buffer = await file.arrayBuffer();

  if (ext === 'csv' || ext === 'txt') {
    let text = new TextDecoder('utf-8').decode(buffer);
    const replacements = (text.match(/�/g) || []).length;
    if (replacements > 3) text = new TextDecoder('windows-1252').decode(buffer);
    return { sheet: 'CSV', ...chooseHeaderAndRows(parseCsvText(text)) };
  }

  const XLSX = await ensureXlsx();
  const workbook = XLSX.read(buffer, { type: 'array', raw: false, cellDates: false });
  let best = null;
  for (const name of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '', raw: false });
    const prepared = chooseHeaderAndRows(matrix);
    const score = prepared.rows.length * Math.max(1, prepared.headers.filter((h) => !/^Columna \d+$/.test(h)).length);
    if (!best || score > best.score) best = { ...prepared, sheet: name, score };
  }
  if (!best) throw new Error('El archivo no contiene hojas con datos.');
  return best;
}

async function handleImportFile(file) {
  if (!file) return;
  const hint = byId('hfImportHint');
  const createBtn = byId('hfCreateCampaignBtn');
  createBtn.disabled = true;
  hint.textContent = 'Leyendo archivo…';
  try {
    const parsed = await parseUploadedFile(file);
    importDraft.file = file;
    importDraft.filename = file.name;
    importDraft.sheet = parsed.sheet;
    importDraft.headers = parsed.headers;
    importDraft.rows = parsed.rows;
    importDraft.headerIndex = parsed.headerIndex || 0;
    importDraft.mapping = detectMapping(parsed.headers);
    if (!byId('hfCampaignName').value.trim()) byId('hfCampaignName').value = file.name.replace(/\.[^.]+$/, '');
    renderMapping();
    byId('hfImportParsed').hidden = false;
    hint.textContent = `${parsed.rows.length.toLocaleString('es-CL')} filas detectadas · hoja ${parsed.sheet} · ${parsed.headers.length} columnas.`;
    refreshImportAnalysis();
  } catch (err) {
    console.error(err);
    hint.textContent = err.message || 'No se pudo leer el archivo.';
    toast(hint.textContent, 'error');
  }
}

function mappingSelect(def) {
  const current = Number(importDraft.mapping[def.id] ?? -1);
  return `<label>${e(def.label)}${def.required ? ' *' : ''}
    <select data-hf-map="${e(def.id)}">
      <option value="-1">Sin mapear</option>
      ${importDraft.headers.map((h, i) => `<option value="${i}" ${i === current ? 'selected' : ''}>${e(h)}</option>`).join('')}
    </select>
  </label>`;
}

function renderMapping() {
  const root = byId('hfMappingRoot');
  if (!root) return;
  const groups = [...new Set(FIELD_DEFS.map((x) => x.group))];
  root.innerHTML = groups.map((group) => `
    <fieldset class="hf-map-group">
      <legend>${e(group)}</legend>
      <div class="hf-map-grid">${FIELD_DEFS.filter((x) => x.group === group).map(mappingSelect).join('')}</div>
    </fieldset>`).join('');

  const rep = detectRepresentativeHeaders(importDraft.headers);
  const repNote = byId('hfRepresentativeHint');
  if (repNote) {
    repNote.hidden = rep.nameParts.length === 0;
    repNote.textContent = rep.nameParts.length
      ? `También detectamos representante legal (${rep.nameParts.map((i) => importDraft.headers[i]).join(' + ')}). Se guardará como contacto alternativo.`
      : '';
  }
}

function detectRepresentativeHeaders(headers) {
  const exact = (name) => headers.findIndex((h) => norm(h) === name);
  return {
    nameParts: [
      exact('nombrerepresentantelegal'),
      exact('apellidopaternorepresentantelegal'),
      exact('apellidomaternorepresentantelegal')
    ].filter((i) => i >= 0),
    email: findHeader(headers, ['emailrepresentantelegal', 'correorepresentantelegal']),
    phone: findHeader(headers, ['telefonorepresentantelegal', 'celularrepresentantelegal'])
  };
}

function rowObject(row) {
  return Object.fromEntries(importDraft.headers.map((h, i) => [h, clean(row[i])]));
}

function mapped(row, field) {
  const ix = Number(importDraft.mapping[field] ?? -1);
  return ix >= 0 ? clean(row[ix]) : '';
}

function splitEmails(value) {
  return clean(value)
    .split(/[;,\s]+/)
    .map((x) => x.trim())
    .filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
}

function contactPhones(c) {
  return [c?.phone, c?.phoneAlt].map((x) => clean(x).replace(/\D/g, '')).filter(Boolean);
}

function sameImportedContact(a, b) {
  const emailA = norm(a?.email);
  const emailB = norm(b?.email);
  if (emailA && emailB && emailA === emailB) return true;
  const phonesA = contactPhones(a);
  const phonesB = contactPhones(b);
  if (phonesA.some((x) => phonesB.includes(x))) return true;
  const nameA = norm(a?.name);
  const nameB = norm(b?.name);
  const generic = new Set(['contactosinnombre', 'contactoderegistro']);
  return Boolean(nameA && nameB && nameA === nameB && !generic.has(nameA));
}

function mergeContactData(target, source) {
  target.name = target.name === 'Contacto sin nombre' ? (source.name || target.name) : (target.name || source.name);
  if (source.role && norm(source.role) !== norm(target.role)) {
    target.role = [...new Set([target.role, source.role].filter(Boolean))].join(' / ');
  }
  target.phone ||= source.phone;
  if (!target.phoneAlt && source.phone && source.phone !== target.phone) target.phoneAlt = source.phone;
  target.phoneAlt ||= source.phoneAlt;
  target.email ||= source.email;
  if (source.source && !clean(target.source).includes(source.source)) {
    target.source = [...new Set([target.source, source.source].filter(Boolean))].join(' / ');
  }
  target.invalidPhone = Boolean(target.invalidPhone && source.invalidPhone);
  target.invalidPhoneAlt = Boolean(target.invalidPhoneAlt && source.invalidPhoneAlt);
  return target;
}

function dedupeContacts(contacts) {
  const out = [];
  contacts.filter(Boolean).forEach((contact) => {
    const prev = out.find((candidate) => sameImportedContact(candidate, contact));
    if (prev) mergeContactData(prev, contact);
    else out.push(contact);
  });
  return out;
}

function makeContact({ name = '', role = '', phone = '', phoneAlt = '', email = '', source = '' }, makeIds = true) {
  if (![name, role, phone, phoneAlt, email].some(truthyCell)) return null;
  return {
    id: makeIds ? uid() : `${norm(name)}-${norm(phone || email || source)}`,
    name: clean(name) || 'Contacto sin nombre',
    role: clean(role),
    phone: clean(phone),
    phoneAlt: clean(phoneAlt),
    email: clean(email),
    source: clean(source),
    invalidPhone: false,
    invalidPhoneAlt: false
  };
}

function roleScore(role) {
  const r = norm(role);
  const rules = [
    [/gerente.*oper|oper.*gerente/, 130],
    [/jefe.*oper|oper.*jefe/, 120],
    [/gerentegeneral|director|dueno|propietario|socio/, 115],
    [/operacion|operaciones/, 105],
    [/manten|serviciotecnico|postventa/, 100],
    [/administrador|administracion/, 85],
    [/compra|abastecimiento|chilecompra/, 75],
    [/representantelegal/, 70],
    [/encargado|supervisor|coordinador/, 65],
    [/asistente|secretaria|recepcion/, 25]
  ];
  return rules.find(([rx]) => rx.test(r))?.[1] || 50;
}

function contactScore(c) {
  let score = roleScore(c.role);
  if ((c.phone && !c.invalidPhone) || (c.phoneAlt && !c.invalidPhoneAlt)) score += 35;
  if (c.email) score += 15;
  if (c.name && c.name !== 'Contacto sin nombre') score += 8;
  if (/tomador|principal/i.test(c.source)) score += 12;
  if (/registro|general/i.test(c.source)) score -= 8;
  return score;
}

function recordPriority(contacts) {
  return Math.max(0, ...contacts.map(contactScore));
}

function buildCrmDuplicateMaps() {
  const byRut = new Map();
  const byCompany = new Map();
  crmState.leads.forEach((lead) => {
    const r = normRut(lead.rut);
    const c = normCompany(lead.company);
    if (r) byRut.set(r, lead);
    if (c) byCompany.set(c, lead);
  });
  return { byRut, byCompany };
}

function detectBlocked(raw) {
  const hay = Object.values(raw).filter(truthyCell).join(' | ').toLocaleLowerCase('es');
  return /\bno\s*contactar\b|\bno\s*llamar\b|\bdo\s*not\s*contact\b/.test(hay);
}

function mergeRaw(base, extra, rowNumber) {
  const next = { ...base };
  const extras = Array.isArray(next._filas_consolidadas) ? next._filas_consolidadas : [];
  extras.push({ fila: rowNumber, ...extra });
  next._filas_consolidadas = extras;
  return next;
}

function buildNormalizedRecord(row, rowNumber, duplicateMaps, makeIds, { repHeaders, defaultIndustry } = {}) {
  const raw = rowObject(row);
  const company = mapped(row, 'company');
  if (!company) return null;

  const primary = makeContact({
    name: mapped(row, 'contactName'),
    role: mapped(row, 'contactRole'),
    phone: mapped(row, 'contactPhone'),
    phoneAlt: mapped(row, 'contactPhone2'),
    email: mapped(row, 'contactEmail'),
    source: 'Contacto principal / tomador de decisiones'
  }, makeIds);

  const general = makeContact({
    name: 'Contacto de registro',
    role: 'Teléfono / correo general',
    phone: mapped(row, 'companyPhone'),
    email: mapped(row, 'companyEmail'),
    source: 'Registro / contacto general'
  }, makeIds);

  repHeaders ||= detectRepresentativeHeaders(importDraft.headers);
  const repName = repHeaders.nameParts.map((i) => clean(row[i])).filter(Boolean).join(' ');
  const representative = makeContact({
    name: repName,
    role: repName ? 'Representante legal' : '',
    phone: repHeaders.phone >= 0 ? clean(row[repHeaders.phone]) : '',
    email: repHeaders.email >= 0 ? clean(row[repHeaders.email]) : '',
    source: 'Representante legal'
  }, makeIds);

  const extraEmails = splitEmails(mapped(row, 'additionalEmails')).map((email, i) => makeContact({
    name: `Contacto adicional ${i + 1}`,
    email,
    source: 'Correo adicional de la base'
  }, makeIds));

  const contacts = dedupeContacts([primary, general, representative, ...extraEmails]);
  const rut = mapped(row, 'rut');
  const duplicate = (rut && duplicateMaps.byRut.get(normRut(rut))) || duplicateMaps.byCompany.get(normCompany(company)) || null;

  return {
    id: makeIds ? uid() : '',
    row_number: rowNumber,
    company,
    rut,
    industry: clean(defaultIndustry) || mapped(row, 'industry'),
    region: mapped(row, 'region'),
    comuna: mapped(row, 'comuna'),
    city: mapped(row, 'city'),
    address: mapped(row, 'address'),
    website: mapped(row, 'website'),
    contacts,
    raw_data: raw,
    existing_lead_id: duplicate?.id || null,
    converted_lead_id: null,
    status: 'pending',
    priority: recordPriority(contacts),
    attempts: 0,
    next_retry_at: null,
    outcome: '',
    discard_reason: '',
    remarketing_reason: '',
    notes: '',
    _blocked: detectBlocked(raw)
  };
}

function mergeRecords(target, source) {
  target.contacts = dedupeContacts([...(target.contacts || []), ...(source.contacts || [])]);
  target.priority = Math.max(target.priority, source.priority);
  target.existing_lead_id ||= source.existing_lead_id;
  target.industry = [...new Set([target.industry, source.industry].filter(Boolean))].join(' / ');
  target.region ||= source.region;
  target.comuna ||= source.comuna;
  target.city ||= source.city;
  target.address ||= source.address;
  target.website ||= source.website;
  target._blocked ||= source._blocked;
  target.raw_data = mergeRaw(target.raw_data, source.raw_data, source.row_number);
  return target;
}

function currentImportOptions() {
  return {
    consolidate: byId('hfConsolidate')?.checked !== false,
    excludeExisting: Boolean(byId('hfExcludeExisting')?.checked),
    excludeNoContact: byId('hfExcludeNoContact')?.checked !== false,
    excludeNoChannel: Boolean(byId('hfExcludeNoChannel')?.checked)
  };
}

function normalizeImportedRows({ makeIds = false } = {}) {
  const maps = buildCrmDuplicateMaps();
  const options = currentImportOptions();
  const repHeaders = detectRepresentativeHeaders(importDraft.headers);
  const defaultIndustry = byId('hfDefaultIndustry')?.value || '';
  const sourceOffset = Number(importDraft.headerIndex || 0) + 2;
  const grouped = new Map();
  const loose = [];
  let blank = 0;
  let duplicatesConsolidated = 0;

  importDraft.rows.forEach((row, index) => {
    const rec = buildNormalizedRecord(row, index + sourceOffset, maps, makeIds, { repHeaders, defaultIndustry });
    if (!rec) {
      blank += 1;
      return;
    }
    const key = normRut(rec.rut) ? `rut:${normRut(rec.rut)}` : `company:${normCompany(rec.company)}`;
    if (options.consolidate && key !== 'company:' && grouped.has(key)) {
      mergeRecords(grouped.get(key), rec);
      duplicatesConsolidated += 1;
    } else if (options.consolidate && key !== 'company:') grouped.set(key, rec);
    else loose.push(rec);
  });

  let records = [...grouped.values(), ...loose];
  const summary = {
    sourceRows: importDraft.rows.length,
    blank,
    consolidated: duplicatesConsolidated,
    unique: records.length,
    existing: records.filter((r) => r.existing_lead_id).length,
    blocked: records.filter((r) => r._blocked).length,
    noChannel: records.filter((r) => !r.contacts.some((c) => c.phone || c.phoneAlt || c.email)).length,
    skippedExisting: 0,
    skippedNoChannel: 0,
    imported: 0,
    actionable: 0
  };

  if (options.excludeExisting) {
    summary.skippedExisting = records.filter((r) => r.existing_lead_id).length;
    records = records.filter((r) => !r.existing_lead_id);
  }
  if (options.excludeNoChannel) {
    summary.skippedNoChannel = records.filter((r) => !r.contacts.some((c) => c.phone || c.phoneAlt || c.email)).length;
    records = records.filter((r) => r.contacts.some((c) => c.phone || c.phoneAlt || c.email));
  }

  if (options.excludeNoContact) {
    records.forEach((r) => {
      if (!r._blocked) return;
      r.status = 'discarded';
      r.discard_reason = 'Marcado como “No contactar” en la base de origen';
      r.outcome = 'do_not_contact';
    });
  }
  records.forEach((r) => delete r._blocked);

  summary.imported = records.length;
  summary.actionable = records.filter((r) => r.status === 'pending').length;
  return { records, summary, options };
}

function refreshCreateButton() {
  const btn = byId('hfCreateCampaignBtn');
  if (!btn) return;
  btn.disabled = !importDraft.analysis?.summary?.imported || !byId('hfCampaignName')?.value.trim();
}

function refreshImportAnalysis() {
  const companyMapped = Number(importDraft.mapping.company ?? -1) >= 0;
  const root = byId('hfImportAnalysis');
  const btn = byId('hfCreateCampaignBtn');
  if (!root || !btn || !importDraft.rows.length) return;

  if (!companyMapped) {
    root.innerHTML = '<div class="notice warn">Mapea la columna de Empresa / razón social para continuar.</div>';
    btn.disabled = true;
    return;
  }

  const result = normalizeImportedRows({ makeIds: false });
  importDraft.analysis = result;
  const a = result.summary;
  root.innerHTML = `
    <div class="hf-import-kpis">
      <div><strong>${a.sourceRows.toLocaleString('es-CL')}</strong><span>Filas origen</span></div>
      <div><strong>${a.unique.toLocaleString('es-CL')}</strong><span>Empresas únicas</span></div>
      <div><strong>${a.existing.toLocaleString('es-CL')}</strong><span>Ya existen en CRM</span></div>
      <div><strong>${a.blocked.toLocaleString('es-CL')}</strong><span>“No contactar”</span></div>
      <div><strong>${a.noChannel.toLocaleString('es-CL')}</strong><span>Sin teléfono/email</span></div>
      <div><strong>${a.actionable.toLocaleString('es-CL')}</strong><span>Entrarán a la cola</span></div>
    </div>
    ${a.consolidated ? `<p class="muted">${a.consolidated.toLocaleString('es-CL')} fila(s) repetidas se consolidarán para no gestionar la misma empresa dos veces.</p>` : ''}
    ${a.skippedExisting ? `<p class="muted">Se omitirán ${a.skippedExisting.toLocaleString('es-CL')} empresas que ya existen en el CRM.</p>` : ''}
    ${a.skippedNoChannel ? `<p class="muted">Se omitirán ${a.skippedNoChannel.toLocaleString('es-CL')} registros sin canal de contacto.</p>` : ''}`;
  refreshCreateButton();
}

function campaignPayload() {
  const mappingByName = Object.fromEntries(
    Object.entries(importDraft.mapping).map(([k, i]) => [k, Number(i) >= 0 ? importDraft.headers[Number(i)] : ''])
  );
  return {
    id: uid(),
    created_by: session.user?.id || null,
    name: byId('hfCampaignName').value.trim(),
    campaign_type: byId('hfCampaignType').value,
    source_filename: importDraft.filename,
    source_sheet: importDraft.sheet,
    default_industry: byId('hfDefaultIndustry').value,
    mapping: mappingByName,
    options: currentImportOptions()
  };
}

async function createCampaignFromImport(event) {
  event.preventDefault();
  if (isReadOnly()) return;
  if (!importDraft.rows.length) return toast('Primero selecciona una base.', 'error');
  if (Number(importDraft.mapping.company ?? -1) < 0) return toast('Mapea la columna de empresa.', 'error');
  const name = byId('hfCampaignName').value.trim();
  if (!name) return toast('Ponle un nombre a la campaña.', 'error');

  const { records, summary, options } = normalizeImportedRows({ makeIds: true });
  if (!records.length) return toast('No quedaron registros para importar con estos filtros.', 'error');

  const campaign = campaignPayload();
  campaign.source_meta = {
    headers: importDraft.headers,
    source_rows: summary.sourceRows,
    imported_records: summary.imported,
    actionable_records: summary.actionable,
    consolidated_rows: summary.consolidated,
    existing_in_crm: summary.existing,
    blocked_records: summary.blocked,
    no_channel_records: summary.noChannel,
    options
  };

  const progress = byId('hfImportProgress');
  const progressText = byId('hfImportProgressText');
  const progressFill = byId('hfImportProgressFill');
  const createBtn = byId('hfCreateCampaignBtn');
  progress.hidden = false;
  createBtn.disabled = true;

  try {
    const { data: campaignRows, error: campaignWriteError } = await supabase.from('hyperfocus_campaigns').insert(campaign).select('id');
    const campaignError = campaignWriteError || (!campaignRows?.length ? new Error('El servidor no confirmó la campaña.') : null);
    if (campaignError) throw campaignError;

    const rows = records.map(({ id, ...r }) => ({ id, campaign_id: campaign.id, ...r }));
    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { data: insertedRows, error: batchError } = await supabase.from('hyperfocus_records').insert(batch).select('id');
      const error = batchError || (insertedRows?.length !== batch.length ? new Error(`El servidor confirmó ${insertedRows?.length || 0} de ${batch.length} registros del lote.`) : null);
      if (error) throw error;
      const done = Math.min(i + batch.length, rows.length);
      const pct = Math.round((done / rows.length) * 100);
      progressText.textContent = `Importando ${done.toLocaleString('es-CL')} de ${rows.length.toLocaleString('es-CL')}…`;
      progressFill.style.width = `${pct}%`;
    }

    progressText.textContent = 'Campaña lista.';
    progressFill.style.width = '100%';
    byId('hfImportDialog').close();
    await hydrate();
    toast(`Campaña creada: ${summary.actionable.toLocaleString('es-CL')} registros listos para gestionar.`);
  } catch (err) {
    console.error(err);
    const { data: cleanupRows, error: cleanupWriteError } = await supabase.from('hyperfocus_campaigns').delete().eq('id', campaign.id).select('id');
    const cleanupError = cleanupWriteError || (!cleanupRows?.length ? new Error('El servidor no confirmó la limpieza de la campaña incompleta.') : null);
    if (cleanupError) {
      console.error('No se pudo revertir la campaña incompleta', cleanupError);
      await hydrate();
      progressText.textContent = 'La importación falló y no se pudo limpiar completamente. Revisa la campaña antes de reintentar.';
      createBtn.disabled = false;
      toast(progressText.textContent, 'error');
      return;
    }
    await hydrate();
    progressText.textContent = `Error: ${err.message || 'no se pudo importar'}`;
    createBtn.disabled = false;
    toast(progressText.textContent, 'error');
  }
}

/* -------------------------------------------------------------------------- */
/* Descartados                                                                 */
/* -------------------------------------------------------------------------- */

const descartados = { campaignId: '', rows: [], cargando: false };

async function openDiscarded(campaignId) {
  const generation = ++discardedGeneration;
  const sameCampaign = descartados.campaignId === campaignId;
  descartados.campaignId = campaignId;
  if (!sameCampaign) descartados.rows = [];
  descartados.cargando = true;
  renderDiscarded();
  byId('hfDiscardedDialog')?.showModal();
  const { data, error } = await supabase
    .from('hyperfocus_records')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('status', 'discarded')
    .order('updated_at', { ascending: false })
    .limit(1000);
  if (generation !== discardedGeneration || descartados.campaignId !== campaignId) return;
  descartados.cargando = false;
  if (error) {
    // Un fallo temporal no equivale a una lista vacía. Si ya teníamos un
    // snapshot válido de esta campaña, lo mantenemos visible.
    toast(error.message, 'error');
  } else {
    descartados.rows = (data || []).map(fromDbRecord);
  }
  renderDiscarded();
}

// Un registro descartado ya no tiene reclamo, así que RLS solo deja devolverlo a
// quien administra. Al comercial se le dice con todas sus letras en vez de dejar
// que el botón no haga nada.
async function restoreDiscarded(recordId) {
  if (!isAdmin()) return toast('Solo un administrador puede devolver registros descartados a la cola.', 'error');
  const record = descartados.rows.find((r) => r.id === recordId);
  if (!record) return;
  const { data, error } = await supabase
    .from('hyperfocus_records')
    .update({ status: 'pending', discard_reason: '', claimed_by: null, claimed_at: null, next_retry_at: null })
    .eq('id', recordId)
    .select('id');
  if (error) return toast(error.message, 'error');
  if (!data?.length) return toast('Solo un administrador puede devolver un registro a la cola.', 'error');
  descartados.rows = descartados.rows.filter((r) => r.id !== recordId);
  renderDiscarded();
  await hydrate();
  toast(`${record.company} vuelve a la cola.`);
}

function renderDiscarded() {
  const body = byId('hfDiscardedBody');
  const title = byId('hfDiscardedCampaign');
  if (!body) return;
  const campaign = campaignOf(descartados.campaignId);
  if (title) title.textContent = campaign?.name || '';
  if (descartados.cargando) {
    body.innerHTML = '<p class="muted">Cargando…</p>';
    return;
  }
  if (!descartados.rows.length) {
    body.innerHTML = '<p class="muted">No hay registros descartados en esta campaña.</p>';
    return;
  }
  const puede = isAdmin();
  body.innerHTML = `
    <p class="muted">${descartados.rows.length.toLocaleString('es-CL')} ${descartados.rows.length === 1 ? 'empresa descartada' : 'empresas descartadas'}. Devolver a la cola la deja disponible para gestionar de nuevo.</p>
    <div class="hf-discarded-list">
      ${descartados.rows.map((r) => `
        <div class="hf-discarded-row">
          <div>
            <strong>${e(r.company)}</strong>
            <span>${[r.comuna, r.region].filter(Boolean).map(e).join(' · ') || 'Sin ubicación'}${r.rut ? ` · RUT ${e(r.rut)}` : ''}</span>
          </div>
          <div>
            <span class="badge">${e(r.discardReason || 'Sin motivo')}</span>
            ${r.notes ? `<span class="hf-discarded-note">${e(r.notes)}</span>` : ''}
          </div>
          <div class="hf-discarded-meta">
            <span>${r.attempts ? `${r.attempts} ${r.attempts === 1 ? 'intento' : 'intentos'}` : 'Sin intentos'}</span>
            <span>${e(fmtDate(r.updatedAt))}</span>
          </div>
          ${puede ? `<button type="button" class="small-btn" data-hf-action="restore-discarded" data-id="${e(r.id)}">Devolver a la cola</button>` : ''}
        </div>`).join('')}
    </div>`;
}

async function deleteCampaign(id) {
  const campaign = campaignOf(id);
  if (!campaign || !canDeleteCampaign(campaign)) return;
  if (!confirm(`¿Eliminar la campaña “${campaign.name}” y todo su historial Híper Foco? Los leads que ya pasaron al CRM NO se eliminan.`)) return;
  const { data, error } = await supabase.from('hyperfocus_campaigns').delete().eq('id', id).select('id');
  if (error) return toast(error.message, 'error');
  if (!data?.length) return toast('La campaña no se eliminó. Puede que ya no exista o que tu sesión no tenga permiso.', 'error');
  await hydrate();
  toast('Campaña eliminada.');
}

/* -------------------------------------------------------------------------- */
/* Sesión secuencial                                                           */
/* -------------------------------------------------------------------------- */

async function claimNextRecord(campaignId) {
  const { data, error } = await supabase.rpc('hyperfocus_claim_next', { p_campaign_id: campaignId });
  if (error) throw error;
  return data?.[0] ? fromDbRecord(data[0]) : null;
}

async function releaseCurrentClaim() {
  const record = focus.record;
  if (!record?.id || record.claimedBy !== session.user?.id) return true;
  const { data, error } = await supabase.rpc('hyperfocus_release_claim', { p_record_id: record.id });
  if (error) {
    toast(error.message || 'No se pudo liberar la empresa actual.', 'error');
    return false;
  }
  if (data !== true) {
    toast('La empresa actual ya no está reservada por esta sesión. Recarga Híper Foco.', 'error');
    return false;
  }
  record.claimedBy = '';
  record.claimedAt = '';
  return true;
}

function recommendedContact(record) {
  return [...(record?.contacts || [])]
    .filter((c) => (c.phone && !c.invalidPhone) || (c.phoneAlt && !c.invalidPhoneAlt) || c.email)
    .sort((a, b) => contactScore(b) - contactScore(a))[0] || record?.contacts?.[0] || null;
}

function selectedContact() {
  return focus.record?.contacts?.find((c) => c.id === focus.selectedContactId) || recommendedContact(focus.record);
}

function preferredPhoneSlot(contact) {
  if (!contact) return 'primary';
  if (contact.phone && !contact.invalidPhone) return 'primary';
  if (contact.phoneAlt && !contact.invalidPhoneAlt) return 'alt';
  return 'primary';
}

function activePhone(contact = selectedContact()) {
  if (!contact) return '';
  if (focus.phoneSlot === 'alt' && contact.phoneAlt && !contact.invalidPhoneAlt) return contact.phoneAlt;
  if (contact.phone && !contact.invalidPhone) return contact.phone;
  if (contact.phoneAlt && !contact.invalidPhoneAlt) return contact.phoneAlt;
  return '';
}

function leadForRecord(record) {
  if (!record) return null;
  const linkedId = record.convertedLeadId || record.existingLeadId;
  const linked = linkedId ? getLead(linkedId) : null;
  if (linked) return linked;
  const rut = normRut(record.rut);
  const company = normCompany(record.company);
  return crmState.leads.find((lead) =>
    (rut && normRut(lead.rut) === rut) || (company && normCompany(lead.company) === company)
  ) || null;
}

function canEditExistingLead(lead) {
  if (!lead) return false;
  if (isAdmin()) return true;
  if (lead.ownerId && lead.ownerId === session.user?.id) return true;
  return !lead.ownerId && clean(lead.owner) && clean(lead.owner) === clean(session.profile?.name);
}

function lockedExistingLead(record) {
  const lead = leadForRecord(record);
  if (!lead || canEditExistingLead(lead)) return null;
  return lead;
}

async function openSession(campaignId) {
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  const campaign = campaignOf(campaignId);
  if (!campaign) return;
  Object.assign(focus, {
    campaignId,
    queue: [],
    record: null,
    selectedContactId: '',
    selectedChannel: 'call',
    contactResult: '',
    commercialResult: '',
    phase: 'ready',
    skipped: new Set(),
    loading: true,
    messageOpened: false,
    attemptStarted: false,
    phoneSlot: 'primary'
  });
  byId('hfSessionDialog').showModal();
  renderSession();
  try {
    focus.loading = false;
    await takeNextRecord();
  } catch (err) {
    focus.loading = false;
    console.error(err);
    toast(err.message || 'No se pudo cargar la campaña.', 'error');
    renderSession();
  }
}

async function takeNextRecord() {
  focus.loading = true;
  renderSession();
  try {
    focus.record = await claimNextRecord(focus.campaignId);
    focus.selectedContactId = recommendedContact(focus.record)?.id || '';
    focus.selectedChannel = 'call';
    focus.contactResult = '';
    focus.commercialResult = '';
    focus.phase = 'ready';
    focus.messageOpened = false;
    focus.attemptStarted = false;
    focus.phoneSlot = preferredPhoneSlot(selectedContact());
  } finally {
    // También al fallar el claim: evita dejar la sesión bloqueada eternamente
    // en "Preparando la cola…" durante transiciones posteriores al primer registro.
    focus.loading = false;
    renderSession();
  }
}

function sessionProgress(campaign) {
  const s = statsOf(campaign.id);
  const closed = s.converted + s.remarketing + s.discarded;
  return { s, closed, pct: progressPct(s) };
}

function renderSession() {
  const body = byId('hfSessionBody');
  if (!body) return;
  const campaign = campaignOf(focus.campaignId);
  if (!campaign) {
    body.innerHTML = '';
    return;
  }
  const { s, closed, pct } = sessionProgress(campaign);
  byId('hfSessionCampaign').textContent = campaign.name;
  byId('hfSessionCounter').textContent = `${closed.toLocaleString('es-CL')} cerrados · ${s.pending + s.retry} por gestionar`;
  byId('hfSessionProgressFill').style.width = `${pct}%`;
  byId('hfSessionPct').textContent = `${pct}%`;

  if (focus.loading) {
    body.innerHTML = '<div class="hf-session-loading"><strong>Preparando la cola…</strong><span>Buscando el siguiente registro disponible.</span></div>';
    return;
  }

  if (!focus.record) {
    body.innerHTML = `<div class="hf-session-done">
      <div class="hf-done-icon">✓</div>
      <h2>No quedan registros disponibles ahora</h2>
      <p>${s.retry ? `Hay ${s.retry} reintento(s) programados para más adelante.` : (s.pending ? 'Los pendientes restantes pueden estar siendo gestionados por otro usuario. Vuelve a intentarlo en unos minutos.' : 'Terminaste la cola de esta campaña.')}</p>
      <div class="button-row"><button class="primary-btn" data-hf-action="close-session">Volver a campañas</button></div>
    </div>`;
    return;
  }

  body.innerHTML = renderRecord(focus.record, campaign);
}

function renderRecord(record, campaign) {
  const contact = selectedContact();
  const contacts = [...record.contacts].sort((a, b) => contactScore(b) - contactScore(a));
  const lead = leadForRecord(record);
  const lockedLead = lockedExistingLead(record);
  const context = contextHighlights(record);

  return `<div class="hf-focus-layout">
    <section class="hf-company-panel">
      <div class="hf-company-head">
        <div>
          <div class="hf-eyebrow">Siguiente empresa</div>
          <div class="hf-company-identity"><h2>${e(record.company)}</h2>${record.rut ? `<span class="hf-rut-badge">RUT ${e(record.rut)}</span>` : ''}</div>
          <div class="hf-company-meta">
            ${record.industry ? `<span>${e(record.industry)}</span>` : ''}
            ${record.comuna ? `<span>${e(record.comuna)}</span>` : ''}
            ${record.region ? `<span>${e(record.region)}</span>` : ''}
          </div>
        </div>
        <div class="hf-attempts"><strong>${record.attempts}</strong><span>intento${record.attempts === 1 ? '' : 's'}</span></div>
      </div>

      ${lead || record.existingLeadId ? `<div class="notice warn hf-existing">
        <strong>Ya existe en el CRM${lead?.owner ? ` · Responsable: ${e(lead.owner)}` : ''}</strong>
        <span>${lead ? `${e(lead.stage)}${lead.nextAction ? ` · ${e(lead.nextAction)}` : ''}` : 'Coincidencia detectada al importar la base.'}</span>
        ${lead ? `<button class="small-btn" data-action="open-detail" data-id="${e(lead.id)}">Ver ficha</button>` : ''}
      </div>` : ''}

      ${context.length ? `<details class="hf-context" ${campaign.type === 'reactivation' ? 'open' : ''}>
        <summary>Antecedentes de la base</summary>
        <div>${context.map(([k, v]) => `<p><strong>${e(k)}</strong><span>${e(v)}</span></p>`).join('')}</div>
      </details>` : ''}

      ${renderContactBlock(contact, contacts)}

      ${renderNotesBlock(record)}

      <div class="hf-record-secondary-actions">
        <button class="small-btn" data-hf-action="skip-record">Omitir por ahora</button>
        ${lockedLead ? '' : '<button class="small-btn danger" data-hf-action="open-disposition" data-mode="discard">Descartar registro</button>'}
      </div>
    </section>

    <aside class="hf-action-panel">
      ${lockedLead ? renderExistingLeadLock(lockedLead) : renderPhase(record, contact)}
    </aside>
  </div>`;
}

/*
 * Observaciones de la gestión. Antes solo se podía escribir algo en los pasos que
 * cierran el registro (reintento, reunión, descarte), así que una llamada donde
 * simplemente pasó algo que vale la pena recordar se perdía. Esta caja está
 * siempre a mano: lo escrito se guarda con fecha y autor, se mantiene el
 * historial anterior, y si el comercial escribe y después cierra el registro con
 * otro botón, la nota se guarda igual en vez de botarse.
 */
function renderNotesBlock(record) {
  const previas = (record.notes || '').trim();
  return `
    <details class="hf-notes" open>
      <summary>Observaciones${previas ? ` · ${previas.split('\n').filter(Boolean).length}` : ''}</summary>
      ${previas ? `<div class="hf-notes-history">${previas.split('\n').filter(Boolean).map((l) => `<p>${e(l)}</p>`).join('')}</div>` : ''}
      <textarea id="hfRecordNote" rows="2" placeholder="Qué pasó en la llamada, con quién hablaste, qué quedó pendiente…">${e(focus.noteDraft || '')}</textarea>
      <button type="button" class="small-btn" data-hf-action="save-note">Guardar observación</button>
    </details>`;
}

// Lo que esté escrito y sin guardar en la caja, para no perderlo al cerrar el registro.
function pendingNote() {
  return (byId('hfRecordNote')?.value || '').trim();
}

function stampNote(text) {
  const quien = session.profile?.name || crmState.me?.name || '';
  return `[${fmtDate(nowISO())}${quien ? ` · ${quien}` : ''}] ${text}`;
}

function mergeNotes(record, text) {
  if (!text) return record.notes || '';
  return [(record.notes || '').trim(), stampNote(text)].filter(Boolean).join('\n');
}

async function saveNote() {
  const record = focus.record;
  const text = pendingNote();
  if (!record) return;
  if (!text) return toast('Escribe la observación antes de guardar.', 'error');
  try {
    focus.noteDraft = '';
    await saveAttemptAndPatch({ notes: mergeNotes(record, text) }, `Observación: ${text}`);
    renderSession();
    toast('Observación guardada.');
  } catch (err) {
    focus.noteDraft = text;
    console.error(err);
    toast(err.message || 'No se pudo guardar la observación.', 'error');
  }
}

function contextHighlights(record) {
  const interesting = (obj, suffix = '') => Object.entries(obj || {})
    .filter(([key, value]) => !key.startsWith('_') && truthyCell(value))
    .filter(([key]) => /(estado|resultado|observ|fecha.*llam|fecha.*reuni|gestion|crm|vigente|origen)/i.test(key))
    .map(([key, value]) => [suffix ? `${key} ${suffix}` : key, value]);

  const main = interesting(record.rawData || {});
  const consolidated = Array.isArray(record.rawData?._filas_consolidadas)
    ? record.rawData._filas_consolidadas.flatMap((row) => interesting(row, row.fila ? `(fila ${row.fila})` : ''))
    : [];

  const seen = new Set();
  return [...main, ...consolidated].filter(([key, value]) => {
    const signature = `${norm(key.replace(/\s*\(fila \d+\)$/, ''))}|${norm(value)}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  }).slice(0, 10);
}

function renderContactBlock(contact, contacts) {
  if (!contacts.length) {
    return `<div class="hf-contact-card empty-contact">
      <div><span class="hf-eyebrow">Contacto</span><h3>Sin contacto utilizable</h3><p>Este registro puede enriquecerse durante la llamada o descartarse si no corresponde.</p></div>
      <button class="ghost-btn" data-hf-action="show-referral">+ Agregar contacto</button>
    </div>`;
  }

  const alternatives = contacts.filter((c) => c.id !== contact?.id);
  return `<div class="hf-contact-section">
    <div class="hf-eyebrow">${contact ? `Partamos con ${e(firstName(contact.name))}` : 'Contacto disponible'}</div>
    ${contact ? `<article class="hf-contact-card recommended">
      <div>
        <h3>${e(contact.name || 'Contacto')}</h3>
        <p>${e(contact.role || 'Cargo no informado')}</p>
        <div class="hf-contact-data">
          ${contact.phone ? `<span>${e(contact.phone)}${contact.invalidPhone ? ' · inválido' : ''}</span>` : ''}
          ${contact.phoneAlt ? `<span>Alt. ${e(contact.phoneAlt)}${contact.invalidPhoneAlt ? ' · inválido' : ''}</span>` : ''}
          ${contact.email ? `<span>${e(contact.email)}</span>` : ''}
        </div>
      </div>
      <span class="badge">Recomendado</span>
    </article>` : ''}
    ${alternatives.length ? `<div class="hf-alt-contacts">
      <span>También tenemos:</span>
      ${alternatives.map((c) => `<button class="hf-alt-contact ${c.id === focus.selectedContactId ? 'active' : ''}" data-hf-action="select-contact" data-contact="${e(c.id)}">
        <strong>${e(c.name || 'Contacto')}</strong><small>${e(c.role || c.phone || c.phoneAlt || c.email || 'Sin canal')}</small>
      </button>`).join('')}
    </div>` : ''}
  </div>`;
}

function firstName(name) {
  return clean(name).split(' ')[0] || 'este contacto';
}

function renderExistingLeadLock(lead) {
  return `<div class="hf-action-step">
    <span class="hf-step-label">Ya está en el CRM</span>
    <h3>Esta oportunidad tiene responsable</h3>
    <p><strong>${e(lead.owner || 'Otro integrante del equipo')}</strong> gestiona esta empresa. Híper Foco no iniciará un contacto paralelo.</p>
    <div class="hf-route-actions">
      <button class="primary-btn" data-action="open-detail" data-id="${e(lead.id)}">Ver ficha CRM</button>
      <button class="ghost-btn" data-hf-action="resolve-existing">Sacar de esta campaña y seguir →</button>
    </div>
  </div>`;
}

function renderPhase(record, contact) {
  switch (focus.phase) {
    case 'contact-result': return renderContactResult(contact);
    case 'commercial-result': return renderCommercialResult(contact);
    case 'failed-route': return renderFailedRoute(record, contact);
    case 'convert': return renderConvert(record, contact);
    case 'send-info': return renderSendInfo(record, contact);
    case 'retry': return renderRetry(record, contact);
    case 'meeting': return renderMeeting(record, contact);
    case 'disposition': return renderDisposition(record, contact);
    case 'referral': return renderReferral(record, contact);
    default: return renderReady(record, contact);
  }
}

function renderReady(record, contact) {
  const phone = activePhone(contact);
  const canCall = Boolean(phone);
  const canWhatsApp = Boolean(phone);
  const canEmail = Boolean(contact?.email);
  return `<div class="hf-action-step">
    <span class="hf-step-label">Ahora</span>
    <h3>${contact ? `Contacta a ${e(firstName(contact.name))}` : 'Necesitamos un contacto'}</h3>
    <p>${contact ? 'Haz la acción y registra inmediatamente qué ocurrió. El sistema decidirá el siguiente paso contigo.' : 'Agrega un contacto o clasifica este registro.'}</p>
    ${contact ? `<div class="hf-channel-actions">
      <button class="hf-call-btn" data-hf-action="open-channel" data-channel="call" ${canCall ? '' : 'disabled'}><strong>📞 Llamar</strong><span>${e(phone || 'Sin teléfono')}${focus.phoneSlot === 'alt' ? ' · alternativo' : ''}</span></button>
      <button class="hf-channel-btn" data-hf-action="open-channel" data-channel="whatsapp" ${canWhatsApp ? '' : 'disabled'}>WhatsApp</button>
      <button class="hf-channel-btn" data-hf-action="open-channel" data-channel="email" ${canEmail ? '' : 'disabled'}>Correo</button>
    </div>` : `<button class="primary-btn" data-hf-action="show-referral">Agregar contacto</button>`}
    ${record.nextRetryAt ? `<div class="hf-last-note">Reintento programado: ${e(fmtDateTime(record.nextRetryAt))}</div>` : ''}
  </div>`;
}

function renderContactResult(contact) {
  return `<div class="hf-action-step">
    <span class="hf-step-label">Resultado del intento</span>
    <h3>¿Pudiste contactar?</h3>
    <p>${contact ? `Registra qué ocurrió con ${e(firstName(contact.name))}.` : ''}</p>
    <div class="hf-choice-grid">
      <button class="hf-choice primary" data-hf-action="contact-result" data-result="contacted">✓ Contacté</button>
      <button class="hf-choice" data-hf-action="contact-result" data-result="no_answer">No contestó</button>
      <button class="hf-choice" data-hf-action="contact-result" data-result="busy">Ocupado / no disponible</button>
      <button class="hf-choice" data-hf-action="contact-result" data-result="wrong_number">Número incorrecto</button>
      <button class="hf-choice" data-hf-action="contact-result" data-result="wrong_person">Contacto equivocado</button>
    </div>
    <button class="link-btn hf-back" data-hf-action="back-ready">← Cambiar acción</button>
  </div>`;
}

function renderCommercialResult(contact) {
  return `<div class="hf-action-step">
    <span class="hf-step-label">Contacto efectivo</span>
    <h3>¿Cuál fue el resultado?</h3>
    <p>Esto define si entra al CRM, queda para otro intento o sale de la campaña.</p>
    <div class="hf-choice-grid commercial">
      <button class="hf-choice primary" data-hf-action="commercial-result" data-result="interested">Interesado</button>
      <button class="hf-choice" data-hf-action="commercial-result" data-result="send_info">Enviar información</button>
      <button class="hf-choice" data-hf-action="commercial-result" data-result="meeting">Agendar reunión</button>
      <button class="hf-choice" data-hf-action="commercial-result" data-result="callback">Volver a llamar</button>
      <button class="hf-choice" data-hf-action="commercial-result" data-result="not_interested">No interesado</button>
      <button class="hf-choice" data-hf-action="commercial-result" data-result="has_solution">Ya tiene solución</button>
      <button class="hf-choice" data-hf-action="commercial-result" data-result="wrong_person">No es la persona correcta</button>
    </div>
    <button class="link-btn hf-back" data-hf-action="back-contact-result">← Volver</button>
  </div>`;
}

function alternativeContact(record, current) {
  return [...(record.contacts || [])]
    .filter((c) => c.id !== current?.id && ((c.phone && !c.invalidPhone) || (c.phoneAlt && !c.invalidPhoneAlt) || c.email))
    .sort((a, b) => contactScore(b) - contactScore(a))[0] || null;
}

function renderFailedRoute(record, contact) {
  const alt = alternativeContact(record, contact);
  const title = CONTACT_RESULTS[focus.contactResult] || 'Intento fallido';
  const phone = activePhone(contact);
  const otherPhoneSlot = focus.phoneSlot === 'primary' ? 'alt' : 'primary';
  const otherPhone = otherPhoneSlot === 'alt' ? contact?.phoneAlt : contact?.phone;
  const otherPhoneInvalid = otherPhoneSlot === 'alt' ? contact?.invalidPhoneAlt : contact?.invalidPhone;
  const canTryOtherPhone = Boolean(otherPhone && !otherPhoneInvalid);
  const showWhatsapp = phone && focus.contactResult !== 'wrong_number' && focus.selectedChannel !== 'whatsapp';
  return `<div class="hf-action-step">
    <span class="hf-step-label">${e(title)}</span>
    <h3>¿Qué hacemos ahora?</h3>
    ${alt ? `<div class="hf-suggestion"><span>Tenemos otra opción</span><strong>${e(alt.name)}</strong><small>${e(alt.role || alt.phone || alt.email || '')}</small><button class="primary-btn" data-hf-action="try-alternative" data-contact="${e(alt.id)}">Probar con ${e(firstName(alt.name))}</button></div>` : ''}
    <div class="hf-route-actions">
      ${canTryOtherPhone ? `<button class="ghost-btn" data-hf-action="try-alt-phone" data-phone-slot="${otherPhoneSlot}">Probar ${otherPhoneSlot === 'alt' ? 'teléfono alternativo' : 'teléfono principal'}</button>` : ''}
      ${showWhatsapp ? '<button class="ghost-btn" data-hf-action="send-after-fail">Enviar WhatsApp</button>' : ''}
      <button class="ghost-btn" data-hf-action="open-retry">Reintentar después</button>
      <button class="ghost-btn" data-hf-action="show-referral">Agregar / corregir contacto</button>
      <button class="ghost-btn" data-hf-action="open-disposition" data-mode="remarketing">Pasar a remarketing</button>
      <button class="danger-btn" data-hf-action="open-disposition" data-mode="discard">Descartar</button>
    </div>
  </div>`;
}

function renderConvert(record, contact) {
  return `<div class="hf-action-step">
    <span class="hf-step-label">Interés confirmado</span>
    <h3>Guardar como prospecto</h3>
    <p>La empresa recién ahora entrará al CRM. Los datos de esta base quedarán asociados al origen Híper Foco.</p>
    <label>Próximo paso
      <select id="hfConvertNextType"><option value="">Sin tarea por ahora</option><option>Llamada</option><option>WhatsApp</option><option>Correo</option></select>
    </label>
    <label>Nota de seguimiento<input id="hfConvertNote" placeholder="Ej. Enviar demo y validar cantidad de técnicos" /></label>
    <label>Fecha<input id="hfConvertDate" type="date" /></label>
    <button class="primary-btn hf-big-action" data-hf-action="convert-prospect">Guardar prospecto y seguir →</button>
    <button class="link-btn hf-back" data-hf-action="back-commercial">← Cambiar resultado</button>
  </div>`;
}

function defaultInfoMessage(record, contact) {
  const name = firstName(contact?.name || '');
  const sender = clean(session.profile?.name || crmState.me?.name || '');
  return `Hola ${name}, soy ${sender || 'del equipo TaskFlow'}. Tal como conversamos, te comparto información de TaskFlow para que puedan revisar cómo centralizar la operación técnica, órdenes de trabajo y trazabilidad de ${record.company}. Quedo atento a cualquier duda.`;
}

function renderSendInfo(record, contact) {
  const message = byId('hfInfoMessage')?.value || defaultInfoMessage(record, contact);
  const canWa = Boolean(activePhone(contact));
  const canEmail = Boolean(contact?.email);
  return `<div class="hf-action-step">
    <span class="hf-step-label">Enviar información</span>
    <h3>Envíalo sin salir del flujo</h3>
    <label>Mensaje<textarea id="hfInfoMessage" rows="7">${e(message)}</textarea></label>
    <div class="button-row">
      <button class="primary-btn" data-hf-action="send-info-channel" data-channel="whatsapp" ${canWa ? '' : 'disabled'}>Abrir WhatsApp</button>
      <button class="ghost-btn" data-hf-action="send-info-channel" data-channel="email" ${canEmail ? '' : 'disabled'}>Abrir correo</button>
    </div>
    <div class="hf-followup-box">
      <label>Seguimiento<input id="hfInfoFollowup" type="date" value="${e(addDaysISO(todayISO(), 3))}" /></label>
      <button class="primary-btn" data-hf-action="finish-info" data-convert="yes">Guardar como prospecto + seguimiento →</button>
      <button class="small-btn" data-hf-action="finish-info" data-convert="no">Mantener solo en Híper Foco</button>
    </div>
    <button class="link-btn hf-back" data-hf-action="back-commercial">← Cambiar resultado</button>
  </div>`;
}

function renderRetry(record, contact) {
  const defaultDate = new Date(Date.now() + (focus.contactResult === 'busy' ? 2 * 3600000 : 24 * 3600000));
  return `<div class="hf-action-step">
    <span class="hf-step-label">Reintentar</span>
    <h3>¿Cuándo vuelve a la cola?</h3>
    <p>Hasta esa fecha no aparecerá durante Híper Foco.</p>
    <label>Fecha y hora<input id="hfRetryAt" type="datetime-local" value="${e(localDateTimeInput(defaultDate))}" /></label>
    <label>Nota<input id="hfRetryNote" placeholder="Ej. Contactar después de las 16:00" /></label>
    ${focus.commercialResult === 'callback' ? `
      <button class="primary-btn" data-hf-action="save-retry" data-convert="yes">Guardar como prospecto + seguimiento →</button>
      <button class="ghost-btn" data-hf-action="save-retry" data-convert="no">Mantener solo en Híper Foco</button>` : `
      <button class="primary-btn" data-hf-action="save-retry" data-convert="no">Programar reintento y seguir →</button>`}
  </div>`;
}

function renderMeeting() {
  return `<div class="hf-action-step">
    <span class="hf-step-label">Reunión</span>
    <h3>Deja el próximo paso listo</h3>
    <label>Fecha de la reunión<input id="hfMeetingDate" type="date" value="${e(addDaysISO(todayISO(), 3))}" /></label>
    <label>Nota<input id="hfMeetingNote" placeholder="Ej. Demo con Operaciones" /></label>
    <button class="primary-btn hf-big-action" data-hf-action="save-meeting">Guardar prospecto y reunión →</button>
    <button class="link-btn hf-back" data-hf-action="back-commercial">← Cambiar resultado</button>
  </div>`;
}

function renderDisposition(record, contact) {
  const discardDefault = focus.commercialResult === 'not_interested' ? 'No interesado' : 'Otro';
  const remarketingDefault = focus.commercialResult === 'has_solution'
    ? 'Ya tiene solución, revisar más adelante'
    : 'No es el momento';
  return `<div class="hf-action-step">
    <span class="hf-step-label">Clasificar</span>
    <h3>¿Sale o vuelve más adelante?</h3>
    <div class="hf-disposition-grid">
      <section>
        <strong>Descartar definitivamente</strong>
        <p>No vuelve a la cola ni entra al CRM.</p>
        <label>Motivo<select id="hfDiscardReason">${DISCARD_REASONS.map((x) => `<option ${x === discardDefault ? 'selected' : ''}>${e(x)}</option>`).join('')}</select></label>
        <label>Detalle<textarea id="hfDiscardNote" rows="2"></textarea></label>
        <button class="danger-btn" data-hf-action="discard-record">Descartar y seguir →</button>
      </section>
      <section>
        <strong>Remarketing</strong>
        <p>Es un “no por ahora”: se guarda en el CRM para retomarlo.</p>
        <label>Motivo<select id="hfRemarketingReason">${REMARKETING_REASONS.map((x) => `<option ${x === remarketingDefault ? 'selected' : ''}>${e(x)}</option>`).join('')}</select></label>
        <label>Retomar<input id="hfRemarketingDate" type="date" value="${e(addDaysISO(todayISO(), 30))}" /></label>
        <button class="primary-btn" data-hf-action="remarketing-record">Guardar en Remarketing →</button>
      </section>
    </div>
  </div>`;
}

function renderReferral(record, contact) {
  return `<div class="hf-action-step">
    <span class="hf-step-label">Enriquecer contacto</span>
    <h3>Agrega a la persona correcta</h3>
    <p>Si durante la llamada te derivaron con otra persona, queda disponible de inmediato sin volver a la tabla.</p>
    <label>Nombre<input id="hfReferralName" placeholder="Nombre y apellido" /></label>
    <label>Cargo<input id="hfReferralRole" placeholder="Ej. Jefe de Operaciones" /></label>
    <label>Teléfono<input id="hfReferralPhone" inputmode="tel" /></label>
    <label>Correo<input id="hfReferralEmail" type="email" /></label>
    <button class="primary-btn" data-hf-action="save-referral">Guardar y gestionar ahora</button>
    <button class="link-btn hf-back" data-hf-action="back-failed">← Volver</button>
  </div>`;
}

function phoneForExternal(phone) {
  const value = clean(phone);
  if (!value) return '';
  const plus = value.trim().startsWith('+') ? '+' : '';
  return plus + value.replace(/\D/g, '');
}

function whatsappDigits(phone) {
  let digits = clean(phone).replace(/\D/g, '');
  if (digits.length === 9) digits = `56${digits}`;
  return digits;
}

function openChannel(channel, { message = '' } = {}) {
  const contact = selectedContact();
  if (!contact) { toast('No hay contacto seleccionado.', 'error'); return false; }
  const phone = activePhone(contact);
  focus.selectedChannel = channel;
  if (channel === 'call') {
    if (!phone) { toast('Este contacto no tiene un teléfono válido.', 'error'); return false; }
    focus.attemptStarted = true;
    openExternal(`tel:${phoneForExternal(phone)}`);
  } else if (channel === 'whatsapp') {
    const digits = whatsappDigits(phone);
    if (!digits) { toast('Este contacto no tiene teléfono para WhatsApp.', 'error'); return false; }
    focus.attemptStarted = true;
    const text = message ? `?text=${encodeURIComponent(message)}` : '';
    window.open(`https://wa.me/${digits}${text}`, '_blank', 'noopener');
  } else if (channel === 'email') {
    if (!contact.email) { toast('Este contacto no tiene correo.', 'error'); return false; }
    focus.attemptStarted = true;
    const subject = `TaskFlow — ${focus.record?.company || ''}`;
    openExternal(`mailto:${encodeURIComponent(contact.email)}?subject=${encodeURIComponent(subject)}${message ? `&body=${encodeURIComponent(message)}` : ''}`);
  } else {
    return false;
  }
  return true;
}

async function updateRecord(record, patch) {
  const dbPatch = {};
  const map = {
    contacts: 'contacts',
    status: 'status',
    attempts: 'attempts',
    lastContactAt: 'last_contact_at',
    nextRetryAt: 'next_retry_at',
    outcome: 'outcome',
    discardReason: 'discard_reason',
    remarketingReason: 'remarketing_reason',
    notes: 'notes',
    convertedLeadId: 'converted_lead_id',
    existingLeadId: 'existing_lead_id',
    claimedBy: 'claimed_by',
    claimedAt: 'claimed_at',
    priority: 'priority'
  };
  // Las fechas y las claves foráneas viajan como '' dentro del CRM, pero Postgres
  // rechaza '' en timestamptz y en uuid: mandaba error 22007 y la gestión se caía
  // justo al cerrar un registro que nunca se había contactado.
  const nullable = ['lastContactAt', 'nextRetryAt', 'claimedAt', 'convertedLeadId', 'existingLeadId', 'claimedBy'];
  Object.entries(patch).forEach(([k, v]) => {
    if (!map[k]) return;
    dbPatch[map[k]] = nullable.includes(k) && (v === '' || v == null) ? null : v;
  });

  let query = supabase.from('hyperfocus_records').update(dbPatch).eq('id', record.id);
  // Toda gestión normal parte con un reclamo atómico. Filtrar también por el
  // usuario evita que una pestaña antigua pise un registro que ya tomó otro comercial.
  if (session.user?.id) query = query.eq('claimed_by', session.user.id);
  const { data, error } = await query.select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Este registro ya no está reservado para tu sesión. Vuelve a cargar la siguiente empresa.');
  Object.assign(record, patch);
}

function statTransition(campaignId, oldStatus, newStatus, { touched = false } = {}) {
  const s = state.stats[campaignId] || emptyStats();
  if (oldStatus && oldStatus !== newStatus && oldStatus in s) s[oldStatus] = Math.max(0, Number(s[oldStatus] || 0) - 1);
  if (newStatus && oldStatus !== newStatus && newStatus in s) s[newStatus] = Number(s[newStatus] || 0) + 1;
  if (touched) s.touched = Math.min(s.total || Infinity, Number(s.touched || 0) + 1);
  state.stats[campaignId] = s;
}

async function saveAttemptAndPatch(patch, detail, crmConversion = null) {
  const record = focus.record;
  if (!record) return;
  const oldStatus = record.status;
  // Si quedó texto sin guardar en la caja de observaciones, se va con este cierre
  // aunque el flujo ya traiga una nota propia (p. ej. reintento o descarte).
  // Partimos desde patch.notes cuando existe para no perder ni duplicar el historial.
  const suelta = pendingNote();
  if (suelta) {
    const baseNotes = patch.notes === undefined ? (record.notes || '') : (patch.notes || '');
    patch = {
      ...patch,
      notes: [String(baseNotes).trim(), stampNote(suelta)].filter(Boolean).join('\n')
    };
  }
  const countAttempt = Boolean(focus.attemptStarted || focus.contactResult || focus.commercialResult);
  if (focus.contactResult === 'wrong_number') {
    const contact = selectedContact();
    if (contact) {
      if (focus.phoneSlot === 'alt') contact.invalidPhoneAlt = true;
      else contact.invalidPhone = true;
      patch = { ...patch, contacts: record.contacts, priority: recordPriority(record.contacts) };
    }
  }
  const firstTouch = countAttempt && record.attempts === 0;
  if (patch.status && ['retry', 'converted', 'remarketing', 'discarded'].includes(patch.status)) {
    patch = { ...patch, claimedBy: null, claimedAt: null };
  }
  const nextPatch = {
    attempts: record.attempts + (countAttempt ? 1 : 0),
    lastContactAt: countAttempt ? nowISO() : record.lastContactAt,
    outcome: focus.commercialResult || focus.contactResult || patch.outcome || record.outcome || '',
    ...patch
  };

  const dbPatch = {};
  const map = {
    contacts: 'contacts',
    status: 'status',
    attempts: 'attempts',
    lastContactAt: 'last_contact_at',
    nextRetryAt: 'next_retry_at',
    outcome: 'outcome',
    discardReason: 'discard_reason',
    remarketingReason: 'remarketing_reason',
    notes: 'notes',
    convertedLeadId: 'converted_lead_id',
    existingLeadId: 'existing_lead_id',
    claimedBy: 'claimed_by',
    claimedAt: 'claimed_at',
    priority: 'priority'
  };
  Object.entries(nextPatch).forEach(([key, value]) => {
    if (map[key]) dbPatch[map[key]] = value ?? null;
  });

  const contact = selectedContact();
  const interaction = {
    id: uid(),
    contact_id: contact?.id || '',
    contact_snapshot: contact || {},
    channel: countAttempt ? focus.selectedChannel : '',
    contact_result: focus.contactResult || '',
    commercial_result: focus.commercialResult || '',
    detail: detail || ''
  };

  // Sin conversión CRM, 0016/0022 mantienen atómicos registro + interacción.
  // Con conversión, 0024/0025 agregan lead + actividad a ESA MISMA transacción.
  // No hay fallback: si falla cualquier paso, la gestión permanece en pantalla
  // y Postgres revierte el conjunto completo.
  const rpc = crmConversion
    ? supabase.rpc('hyperfocus_convert_record', {
        p_record_id: record.id,
        p_lead_id: crmConversion.leadId,
        p_lead: crmConversion.leadPayload,
        p_activity: crmConversion.activityPayload,
        p_patch: dbPatch,
        p_interaction: interaction
      })
    : supabase.rpc('hyperfocus_finalize_record', {
        p_record_id: record.id,
        p_patch: dbPatch,
        p_interaction: interaction
      });
  const { error } = await rpc;
  if (error) throw error;

  Object.assign(record, nextPatch);
  statTransition(record.campaignId, oldStatus, nextPatch.status || oldStatus, { touched: firstTouch });
  focus.attemptStarted = false;
  focus.noteDraft = '';
}

async function recordAttemptOnly(detail, { invalidatePhone = false } = {}) {
  const record = focus.record;
  if (!record) return;
  const contact = selectedContact();
  if (invalidatePhone && contact) {
    if (focus.phoneSlot === 'alt') contact.invalidPhoneAlt = true;
    else contact.invalidPhone = true;
  }
  await saveAttemptAndPatch({ contacts: record.contacts }, detail);
}

function extraContactsForLead(record, primary) {
  return (record.contacts || [])
    .filter((c) => c.id !== primary?.id)
    .filter((c) => c.name || c.phone || c.phoneAlt || c.email)
    .map((c) => ({ id: uid(), name: c.name || 'Contacto adicional', role: c.role || '', phone: (!c.invalidPhone && c.phone) || (!c.invalidPhoneAlt && c.phoneAlt) || '', email: c.email || '' }));
}

function sameContactInLead(lead, contact) {
  const needleEmail = norm(contact?.email);
  const needlePhones = [contact?.phone, contact?.phoneAlt].map((x) => clean(x).replace(/\D/g, '')).filter(Boolean);
  const all = [
    { name: lead.contact, role: lead.role, email: lead.email, phone: lead.phone },
    ...(lead.contacts || [])
  ];
  return all.some((c) => {
    const phone = clean(c.phone).replace(/\D/g, '');
    return (needleEmail && norm(c.email) === needleEmail) || (phone && needlePhones.includes(phone));
  });
}

function contactForLead(contact) {
  return {
    id: uid(),
    name: contact?.name || 'Contacto adicional',
    role: contact?.role || '',
    phone: activePhone(contact),
    email: contact?.email || ''
  };
}

function stageForExisting(current, desired) {
  if (!current) return desired;
  if (current === 'Ganado') return current;
  if (desired === 'Remarketing') return desired;
  const activeRank = { Lead: 0, Contactado: 1, 'Reunión / Demo': 2, Propuesta: 3, Negociación: 4 };
  if (desired in activeRank) {
    if (current === 'Perdido' || current === 'Remarketing') return desired;
    if (current in activeRank) return activeRank[current] >= activeRank[desired] ? current : desired;
  }
  return desired;
}

function hyperFocusCrmActivityId(record) {
  // UUID v5-like determinista derivado del UUID del registro Híper Foco.
  // Mantiene formato UUID válido y hace idempotente la actividad CRM:
  // reintentar el cierre del mismo registro reutiliza exactamente la misma PK.
  const hex = String(record?.id || '').replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return uid();
  const chars = hex.split('');
  chars[12] = '5';
  chars[16] = ((parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const out = chars.join('');
  return `${out.slice(0,8)}-${out.slice(8,12)}-${out.slice(12,16)}-${out.slice(16,20)}-${out.slice(20)}`;
}

function buildAtomicCrmConversion(record, {
  stage = 'Contactado',
  nextType = '',
  nextAction = '',
  nextDate = '',
  remarketingReason = ''
} = {}) {
  const contact = selectedContact();
  const existing = leadForRecord(record);

  if (existing && !canEditExistingLead(existing)) {
    throw new Error(`Esta empresa ya está asignada a ${existing.owner || 'otro integrante del equipo'}. No se modificó su oportunidad.`);
  }

  const leadId = existing?.id || uid();
  let finalStage = stage;
  let leadPayload;

  if (existing) {
    finalStage = stageForExisting(existing.stage, stage);
    const contacts = [...(existing.contacts || [])];
    if (contact && !sameContactInLead(existing, contact)) contacts.push(contactForLead(contact));

    leadPayload = {
      industry: existing.industry || record.industry || '',
      rut: existing.rut || record.rut || '',
      source: existing.source || 'Base de datos',
      stage: finalStage,
      probability: DEFAULT_PROBABILITY[finalStage] ?? existing.probability,
      next_type: nextType,
      next_action: nextAction,
      next_date: nextDate || null,
      contacts,
      remarketing_reason: finalStage === 'Remarketing'
        ? remarketingReason
        : (existing.stage === 'Remarketing' ? '' : existing.remarketingReason || '')
    };
  } else {
    leadPayload = {
      rut: record.rut || '',
      industry: record.industry || '',
      source: 'Base de datos',
      contact: contact?.name || '',
      role: contact?.role || '',
      email: contact?.email || '',
      phone: activePhone(contact),
      stage: finalStage,
      priority: 'Media',
      value: 0,
      probability: DEFAULT_PROBABILITY[finalStage] ?? 15,
      expected_close_date: null,
      next_type: nextType,
      next_action: nextAction,
      next_date: nextDate || null,
      loss_reason: '',
      remarketing_reason: remarketingReason,
      notes: [
        `Origen: Híper Foco · ${campaignOf(record.campaignId)?.name || 'campaña'}. Fila de origen ${record.rowNumber}.`,
        // La observación pendiente viaja al lead y al cierre Híper Foco dentro
        // de la misma transacción, igual que en el flujo anterior.
        mergeNotes(record, pendingNote()).trim()
      ].filter(Boolean).join('\n'),
      contacts: extraContactsForLead(record, contact)
    };
  }

  const activityPayload = {
    id: hyperFocusCrmActivityId(record),
    contact_key: contact?.id || '',
    type: focus.selectedChannel === 'whatsapp'
      ? 'WhatsApp'
      : focus.selectedChannel === 'email'
        ? 'Correo'
        : 'Llamada',
    date: nowISO(),
    detail: `Híper Foco · ${COMMERCIAL_RESULTS[focus.commercialResult] || CONTACT_RESULTS[focus.contactResult] || 'Gestión comercial'} · campaña ${campaignOf(record.campaignId)?.name || ''}.`
  };

  return { leadId, leadPayload, activityPayload, finalStage };
}

async function finalizeConversion({ stage = 'Contactado', nextType = '', nextAction = '', nextDate = '', remarketingReason = '', detail = '' } = {}) {
  const record = focus.record;
  if (!record) return;

  try {
    const crm = buildAtomicCrmConversion(record, { stage, nextType, nextAction, nextDate, remarketingReason });
    const newStatus = crm.finalStage === 'Remarketing' ? 'remarketing' : 'converted';

    await saveAttemptAndPatch({
      status: newStatus,
      convertedLeadId: crm.leadId,
      existingLeadId: crm.leadId,
      nextRetryAt: null,
      remarketingReason: crm.finalStage === 'Remarketing' ? remarketingReason : ''
    }, detail || `Convertido al CRM en etapa ${crm.finalStage}.`, crm);

    await advanceAfterFinal(`Guardado en ${crm.finalStage === 'Remarketing' ? 'Remarketing' : 'CRM'}.`);
  } catch (err) {
    console.error(err);
    toast(err.message || 'No se pudo cerrar la gestión.', 'error');
  }
}

async function finalizeRetry({ when, note = '', convert = false } = {}) {
  const record = focus.record;
  if (!record) return;
  if (!when) return toast('Elige cuándo reintentar.', 'error');

  try {
    const crm = convert
      ? buildAtomicCrmConversion(record, {
          stage: 'Contactado',
          nextType: 'Llamada',
          nextAction: note || 'Retomar contacto',
          nextDate: String(when).slice(0, 10)
        })
      : null;

    await saveAttemptAndPatch({
      status: 'retry',
      nextRetryAt: new Date(when).toISOString(),
      notes: mergeNotes(record, note),
      convertedLeadId: crm?.leadId || record.convertedLeadId || null,
      existingLeadId: crm?.leadId || record.existingLeadId || null
    }, `Reintento programado para ${when}${note ? ` · ${note}` : ''}.`, crm);

    await advanceAfterFinal('Reintento programado.');
  } catch (err) {
    console.error(err);
    toast(err.message || 'No se pudo programar el reintento.', 'error');
  }
}

async function finalizeDiscard() {
  const reason = byId('hfDiscardReason')?.value || 'Otro';
  const note = byId('hfDiscardNote')?.value.trim() || '';
  const record = focus.record;
  if (!record) return;
  try {
    await saveAttemptAndPatch({ status: 'discarded', discardReason: reason, notes: mergeNotes(record, note), nextRetryAt: null }, `Descartado: ${reason}${note ? ` · ${note}` : ''}.`);
    await advanceAfterFinal('Registro descartado.');
  } catch (err) {
    console.error(err);
    toast(err.message || 'No se pudo descartar.', 'error');
  }
}

async function advanceAfterFinal(message = '') {
  // Refrescamos antes de avanzar para que las tarjetas y el contador no dependan
  // únicamente de la transición optimista local. Si el refresco falla, hydrate()
  // conserva el último estado válido y la sesión puede continuar.
  await hydrate();
  if (message) toast(message);
  await takeNextRecord();
}

async function tryAlternative(contactId) {
  const oldContact = selectedContact();
  try {
    await recordAttemptOnly(CONTACT_RESULTS[focus.contactResult] || 'Intento sin contacto', { invalidatePhone: focus.contactResult === 'wrong_number' });
    focus.selectedContactId = contactId;
    focus.phoneSlot = preferredPhoneSlot(selectedContact());
    focus.attemptStarted = false;
    focus.contactResult = '';
    focus.commercialResult = '';
    focus.phase = 'ready';
    renderSession();
    toast(oldContact ? `Intento registrado. Probemos con otro contacto.` : 'Contacto seleccionado.');
  } catch (err) {
    console.error(err);
    toast(err.message || 'No se pudo registrar el intento.', 'error');
  }
}

async function saveReferral() {
  const record = focus.record;
  if (!record) return;
  const name = byId('hfReferralName')?.value.trim() || '';
  const role = byId('hfReferralRole')?.value.trim() || '';
  const phone = byId('hfReferralPhone')?.value.trim() || '';
  const email = byId('hfReferralEmail')?.value.trim() || '';
  if (!name && !phone && !email) return toast('Agrega al menos nombre, teléfono o correo.', 'error');

  const beforeContacts = structuredClone(record.contacts || []);
  const beforePriority = record.priority;
  const contact = makeContact({ name, role, phone, email, source: 'Enriquecido durante Híper Foco' }, true);
  const nextContacts = dedupeContacts([...(record.contacts || []), contact]);
  const nextPriority = recordPriority(nextContacts);

  try {
    // Si el referido aparece como resultado de un intento, el mismo RPC atómico
    // que registra la interacción persiste también el contacto enriquecido.
    record.contacts = nextContacts;
    record.priority = nextPriority;
    if (focus.contactResult) {
      await recordAttemptOnly(CONTACT_RESULTS[focus.contactResult] || 'Contacto derivó a otra persona', {
        invalidatePhone: focus.contactResult === 'wrong_number'
      });
    } else {
      await updateRecord(record, { contacts: nextContacts, priority: nextPriority });
    }
    focus.selectedContactId = contact.id;
    focus.phoneSlot = preferredPhoneSlot(contact);
    focus.attemptStarted = false;
    focus.contactResult = '';
    focus.commercialResult = '';
    focus.phase = 'ready';
    renderSession();
    toast('Contacto agregado.');
  } catch (err) {
    record.contacts = beforeContacts;
    record.priority = beforePriority;
    renderSession();
    console.error(err);
    toast(err.message || 'No se pudo guardar el contacto.', 'error');
  }
}

async function skipRecord() {
  const record = focus.record;
  if (!record) return;
  const later = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  try {
    await saveAttemptAndPatch({
      status: 'retry',
      nextRetryAt: later,
      outcome: 'skipped'
    }, 'Pospuesto desde Híper Foco sin realizar un intento de contacto.');
    await advanceAfterFinal('Lo dejamos para después.');
  } catch (err) {
    console.error(err);
    toast(err.message || 'No se pudo posponer el registro.', 'error');
  }
}

/* -------------------------------------------------------------------------- */
/* Eventos                                                                     */
/* -------------------------------------------------------------------------- */

function handleHyperFocusClickLocked(ev) {
  const btn = ev.target.closest?.('[data-hf-action]');
  if (!btn || btn.dataset.hfBusy === '1' || focus.busy) return;

  // Una operación async bloquea toda la sesión para evitar acciones concurrentes
  // sobre el mismo claim (p. ej. finalizar y pausar/cerrar al mismo tiempo).
  focus.busy = true;
  btn.dataset.hfBusy = '1';
  btn.setAttribute('aria-disabled', 'true');
  if ('disabled' in btn) btn.disabled = true;

  Promise.resolve(handleHyperFocusClick(ev))
    .catch((err) => {
      console.error('Acción Híper Foco no completada', err);
      toast(err.message || 'No se pudo completar la acción.', 'error');
    })
    .finally(() => {
      focus.busy = false;
      if (!btn.isConnected) return;
      delete btn.dataset.hfBusy;
      btn.removeAttribute('aria-disabled');
      if ('disabled' in btn) btn.disabled = false;
    });
}

async function handleHyperFocusClick(ev) {
  const btn = ev.target.closest?.('[data-hf-action]');
  if (!btn) return;
  const action = btn.dataset.hfAction;

  if (action === 'new-campaign') return openImportDialog();
  if (action === 'new-crm-campaign') return openCrmCampaignDialog();
  if (action === 'start-session') return openSession(btn.dataset.id);
  if (action === 'delete-campaign') return deleteCampaign(btn.dataset.id);
  if (action === 'open-discarded') return openDiscarded(btn.dataset.id);
  if (action === 'restore-discarded') return restoreDiscarded(btn.dataset.id);
  if (action === 'close-session') {
    if (await releaseCurrentClaim()) return byId('hfSessionDialog')?.close();
    return;
  }
  if (action === 'pause-session') {
    if (await releaseCurrentClaim()) return byId('hfSessionDialog')?.close();
    return;
  }
  if (action === 'save-note') return saveNote();
  if (action === 'skip-record') return skipRecord();
  if (action === 'resolve-existing') {
    const lead = lockedExistingLead(focus.record);
    if (!lead) return;
    try {
      await saveAttemptAndPatch({
        status: 'discarded',
        discardReason: `Ya existe en CRM · responsable ${lead.owner || 'asignado'}`,
        nextRetryAt: null
      }, `Omitido de Híper Foco porque ya existe en el CRM y está asignado a ${lead.owner || 'otro responsable'}.`);
      return advanceAfterFinal('Se mantiene en el CRM y sale de esta campaña.');
    } catch (err) {
      console.error(err);
      return toast(err.message || 'No se pudo actualizar la campaña.', 'error');
    }
  }
  if (action === 'select-contact') {
    focus.selectedContactId = btn.dataset.contact;
    focus.phoneSlot = preferredPhoneSlot(selectedContact());
    focus.phase = 'ready';
    return renderSession();
  }
  if (action === 'open-channel') {
    if (!openChannel(btn.dataset.channel)) return;
    focus.phase = 'contact-result';
    return renderSession();
  }
  if (action === 'back-ready') {
    focus.phase = 'ready';
    return renderSession();
  }
  if (action === 'back-contact-result') {
    focus.phase = 'contact-result';
    return renderSession();
  }
  if (action === 'back-commercial') {
    focus.phase = 'commercial-result';
    return renderSession();
  }
  if (action === 'back-failed') {
    focus.phase = focus.contactResult ? 'failed-route' : 'ready';
    return renderSession();
  }
  if (action === 'contact-result') {
    focus.contactResult = btn.dataset.result;
    if (focus.contactResult === 'contacted') focus.phase = 'commercial-result';
    else focus.phase = 'failed-route';
    return renderSession();
  }
  if (action === 'commercial-result') {
    focus.commercialResult = btn.dataset.result;
    const phases = {
      interested: 'convert',
      send_info: 'send-info',
      callback: 'retry',
      meeting: 'meeting',
      not_interested: 'disposition',
      has_solution: 'disposition',
      wrong_person: 'referral'
    };
    focus.phase = phases[focus.commercialResult] || 'commercial-result';
    return renderSession();
  }
  if (action === 'try-alternative') return tryAlternative(btn.dataset.contact);
  if (action === 'try-alt-phone') {
    try {
      await recordAttemptOnly(CONTACT_RESULTS[focus.contactResult] || 'Intento sin contacto', { invalidatePhone: focus.contactResult === 'wrong_number' });
      focus.phoneSlot = btn.dataset.phoneSlot === 'alt' ? 'alt' : 'primary';
      focus.contactResult = '';
      focus.commercialResult = '';
      focus.attemptStarted = false;
      focus.phase = 'ready';
      renderSession();
      return toast('Intento registrado. Probemos el otro teléfono.');
    } catch (err) {
      console.error(err);
      return toast(err.message || 'No se pudo registrar el intento.', 'error');
    }
  }
  if (action === 'send-after-fail') {
    const failedResult = focus.contactResult;
    try {
      await recordAttemptOnly(CONTACT_RESULTS[failedResult] || 'Intento sin contacto', { invalidatePhone: failedResult === 'wrong_number' });
      focus.contactResult = 'message_sent';
      focus.commercialResult = '';
      focus.attemptStarted = false;
      const message = `Hola ${firstName(selectedContact()?.name || '')}, intenté comunicarme contigo. Soy ${clean(session.profile?.name || crmState.me?.name || '') || 'del equipo TaskFlow'} y quería conversar brevemente sobre la operación de ${focus.record?.company || 'su empresa'}. Cuando puedas, quedo atento.`;
      openChannel('whatsapp', { message });
      focus.phase = 'retry';
      return renderSession();
    } catch (err) {
      console.error(err);
      return toast(err.message || 'No se pudo registrar el intento.', 'error');
    }
  }
  if (action === 'open-retry') {
    focus.phase = 'retry';
    return renderSession();
  }
  if (action === 'open-disposition') {
    focus.phase = 'disposition';
    return renderSession();
  }
  if (action === 'show-referral') {
    focus.phase = 'referral';
    return renderSession();
  }
  if (action === 'save-referral') return saveReferral();
  if (action === 'convert-prospect') {
    const nextType = byId('hfConvertNextType')?.value || '';
    const nextAction = byId('hfConvertNote')?.value.trim() || '';
    const nextDate = byId('hfConvertDate')?.value || '';
    return finalizeConversion({ stage: 'Contactado', nextType, nextAction, nextDate, detail: 'Interesado. Guardado como prospecto desde Híper Foco.' });
  }
  if (action === 'send-info-channel') {
    const message = byId('hfInfoMessage')?.value || defaultInfoMessage(focus.record, selectedContact());
    openChannel(btn.dataset.channel, { message });
    focus.messageOpened = true;
    return;
  }
  if (action === 'finish-info') {
    const followup = byId('hfInfoFollowup')?.value || addDaysISO(todayISO(), 3);
    if (btn.dataset.convert === 'yes') {
      return finalizeConversion({
        stage: 'Contactado',
        nextType: 'Llamada',
        nextAction: 'Seguimiento a información enviada',
        nextDate: followup,
        detail: 'Solicitó información. Se dejó seguimiento.'
      });
    }
    const when = `${followup}T09:00`;
    return finalizeRetry({ when, note: 'Seguimiento a información enviada', convert: false });
  }
  if (action === 'save-retry') {
    const when = byId('hfRetryAt')?.value;
    const note = byId('hfRetryNote')?.value.trim() || '';
    return finalizeRetry({ when, note, convert: btn.dataset.convert === 'yes' });
  }
  if (action === 'save-meeting') {
    const date = byId('hfMeetingDate')?.value || '';
    const note = byId('hfMeetingNote')?.value.trim() || 'Reunión / demo agendada';
    return finalizeConversion({ stage: 'Reunión / Demo', nextType: 'Llamada', nextAction: note, nextDate: date, detail: `Reunión agendada${date ? ` para ${date}` : ''}.` });
  }
  if (action === 'discard-record') return finalizeDiscard();
  if (action === 'remarketing-record') {
    const reason = byId('hfRemarketingReason')?.value || 'No es el momento';
    const date = byId('hfRemarketingDate')?.value || addDaysISO(todayISO(), 30);
    focus.commercialResult ||= 'not_interested';
    return finalizeConversion({
      stage: 'Remarketing',
      nextType: 'Llamada',
      nextAction: 'Retomar contacto desde Híper Foco',
      nextDate: date,
      remarketingReason: reason,
      detail: `Pasa a Remarketing: ${reason}.`
    });
  }
}

function handleHyperFocusKeydown(ev) {
  const dialog = byId('hfSessionDialog');
  if (!dialog?.open || focus.busy || ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(ev.target?.tagName)) return;

  const key = ev.key.toLowerCase();
  let target = null;
  if (focus.phase === 'ready') {
    const channel = { l: 'call', w: 'whatsapp', e: 'email' }[key];
    if (channel) target = q(`[data-hf-action="open-channel"][data-channel="${channel}"]`, byId('hfSessionBody'));
  } else if (/^[1-9]$/.test(key)) {
    const choices = qa('.hf-action-panel .hf-choice:not([disabled])', byId('hfSessionBody'));
    target = choices[Number(key) - 1] || null;
  }

  if (target && !target.disabled) {
    ev.preventDefault();
    target.click();
  }
}

function applyCampaignTypeDefaults() {
  const type = byId('hfCampaignType')?.value || 'prospecting';
  const checkbox = byId('hfExcludeExisting');
  if (checkbox) checkbox.checked = type === 'prospecting';
  if (importDraft.rows.length) refreshImportAnalysis();
}

function bindImportControls() {
  byId('hfImportFile')?.addEventListener('change', (ev) => handleImportFile(ev.target.files?.[0]));
  byId('hfImportForm')?.addEventListener('submit', createCampaignFromImport);
  byId('hfCampaignType')?.addEventListener('change', applyCampaignTypeDefaults);
  byId('hfCampaignName')?.addEventListener('input', refreshCreateButton);
  byId('hfMappingRoot')?.addEventListener('change', (ev) => {
    const select = ev.target.closest('[data-hf-map]');
    if (!select) return;
    importDraft.mapping[select.dataset.hfMap] = Number(select.value);
    refreshImportAnalysis();
  });
  ['hfConsolidate', 'hfExcludeExisting', 'hfExcludeNoContact', 'hfExcludeNoChannel', 'hfDefaultIndustry'].forEach((id) => {
    byId(id)?.addEventListener('change', refreshImportAnalysis);
  });
}

function dialogsMarkup() {
  return `
  <dialog id="hfImportDialog" class="modal hf-import-dialog" data-keep-open="true">
    <form id="hfImportForm" class="modal-card hf-import-card" novalidate>
      <div class="modal-head">
        <div><h2>Nueva campaña Híper Foco</h2><p>Sube la base, revisa cómo entendimos sus columnas y recién después créala.</p></div>
        <button type="button" class="icon-btn" data-close-hf="hfImportDialog" aria-label="Cerrar">×</button>
      </div>

      <div class="hf-import-intro">
        <label>Nombre de la campaña<input id="hfCampaignName" placeholder="Ej. HVAC RM · septiembre" /></label>
        <label>Tipo<select id="hfCampaignType">${HF_TYPES.map((x) => `<option value="${e(x.id)}">${e(x.label)}</option>`).join('')}</select></label>
        <label>Rubro por defecto<select id="hfDefaultIndustry"><option value="">Usar la base / sin definir</option>${INDUSTRIES.map((x) => `<option>${e(x)}</option>`).join('')}</select></label>
        <label class="hf-file-drop">Base CSV / Excel
          <input id="hfImportFile" type="file" accept=".csv,.txt,.xlsx,.xls" />
          <span id="hfImportHint">CSV o Excel (.xlsx/.xls). La base no entra al CRM al importarla.</span>
        </label>
      </div>

      <div id="hfImportParsed" hidden>
        <div class="hf-import-section-head"><div><h3>1. Mapeo de columnas</h3><p>Corrige solo lo que el sistema no haya reconocido bien.</p></div></div>
        <div id="hfMappingRoot"></div>
        <p id="hfRepresentativeHint" class="notice" hidden></p>

        <div class="hf-import-section-head"><div><h3>2. Preparación de la cola</h3><p>Estas reglas evitan llamadas duplicadas o registros que ya sabemos que no debemos tocar.</p></div></div>
        <div class="hf-import-options">
          <label><input id="hfConsolidate" type="checkbox" checked /> Consolidar empresas repetidas</label>
          <label><input id="hfExcludeNoContact" type="checkbox" checked /> Sacar de la cola los registros marcados “No contactar”</label>
          <label><input id="hfExcludeExisting" type="checkbox" /> Omitir empresas que ya existen en el CRM</label>
          <label><input id="hfExcludeNoChannel" type="checkbox" /> Omitir registros sin teléfono ni correo</label>
        </div>

        <div class="hf-import-section-head"><div><h3>3. Vista previa</h3><p>Lo que ocurrirá al crear la campaña.</p></div></div>
        <div id="hfImportAnalysis"></div>
      </div>

      <div id="hfImportProgress" class="hf-import-progress" hidden>
        <div><span id="hfImportProgressText">Preparando…</span><strong></strong></div>
        <div class="hf-progress"><span id="hfImportProgressFill"></span></div>
      </div>

      <div class="modal-actions">
        <button type="button" class="ghost-btn" data-close-hf="hfImportDialog">Cancelar</button>
        <button id="hfCreateCampaignBtn" type="submit" class="primary-btn" disabled>Crear campaña</button>
      </div>
    </form>
  </dialog>

  <dialog id="hfCrmCampaignDialog" class="modal hf-crm-campaign-dialog" data-keep-open="true">
    <form id="hfCrmCampaignForm" class="modal-card" novalidate>
      <div class="modal-head">
        <div><h2>Crear campaña desde el CRM</h2><p>Segmenta oportunidades existentes y llévalas a Híper Foco sin duplicarlas.</p></div>
        <button type="button" class="icon-btn" data-close-hf="hfCrmCampaignDialog" aria-label="Cerrar">×</button>
      </div>
      <div class="hf-crm-campaign-body">
        <div class="hf-import-intro hf-crm-campaign-fields">
          <label>Nombre de la campaña<input id="hfCrmCampaignName" placeholder="Ej. Reactivación septiembre" /></label>
          <label>Tipo<select id="hfCrmCampaignType">${HF_TYPES.map((x) => `<option value="${e(x.id)}">${e(x.label)}</option>`).join('')}</select></label>
          <label>Etapa<select id="hfCrmStage"></select></label>
          <label>Responsable<select id="hfCrmOwner"></select></label>
          <label>Rubro<select id="hfCrmIndustry"></select></label>
          <label>Origen<select id="hfCrmSource"></select></label>
          <label class="inline-check span-2"><input id="hfCrmWithChannel" type="checkbox" checked /> Solo incluir oportunidades con teléfono o correo</label>
        </div>
        <div class="hf-import-section-head"><div><h3>Vista previa del segmento</h3><p>Híper Foco quedará enlazado al mismo registro del CRM.</p></div></div>
        <div id="hfCrmCampaignPreview" class="hf-crm-campaign-preview"></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="ghost-btn" data-close-hf="hfCrmCampaignDialog">Cancelar</button>
        <button id="hfCreateCrmCampaignBtn" type="submit" class="primary-btn">Crear campaña</button>
      </div>
    </form>
  </dialog>

  <dialog id="hfDiscardedDialog" class="modal hf-discarded-dialog">
    <div class="modal-card">
      <div class="modal-head">
        <div><h2>Descartados</h2><p id="hfDiscardedCampaign"></p></div>
        <button type="button" class="icon-btn" data-close-hf="hfDiscardedDialog" aria-label="Cerrar">×</button>
      </div>
      <div id="hfDiscardedBody" class="hf-discarded-body"></div>
      <div class="modal-actions">
        <button type="button" class="ghost-btn" data-close-hf="hfDiscardedDialog">Cerrar</button>
      </div>
    </div>
  </dialog>

  <dialog id="hfSessionDialog" class="hf-session-dialog">
    <div class="hf-session-shell">
      <header class="hf-session-head">
        <div class="hf-session-title"><span class="hf-bolt">⚡</span><div><strong>Híper Foco</strong><span id="hfSessionCampaign"></span><small class="hf-shortcuts">Atajos: L llamar · W WhatsApp · E correo · 1–7 opciones</small></div></div>
        <div class="hf-session-progress-wrap">
          <div><span id="hfSessionCounter"></span><strong id="hfSessionPct">0%</strong></div>
          <div class="hf-progress"><span id="hfSessionProgressFill"></span></div>
        </div>
        <button type="button" class="ghost-btn" data-hf-action="pause-session">Pausar</button>
      </header>
      <main id="hfSessionBody" class="hf-session-body"></main>
    </div>
  </dialog>`;
}

function confirmDiscardImport() {
  if (!importDraft.rows.length) return true;
  return confirm('Se perderá la base cargada y el mapeo que hiciste. ¿Cerrar de todas formas?');
}

export function initUI() {
  if (uiBound) return;
  uiBound = true;
  const wrap = document.createElement('div');
  wrap.innerHTML = dialogsMarkup();
  while (wrap.firstElementChild) document.body.appendChild(wrap.firstElementChild);

  document.addEventListener('click', handleHyperFocusClickLocked);
  // La sesión se repinta en cada paso, así que lo escrito en la caja de
  // observaciones se guarda en memoria para no perderlo al cambiar de pantalla.
  document.addEventListener('input', (ev) => {
    if (ev.target?.id === 'hfRecordNote') focus.noteDraft = ev.target.value;
  });
  document.addEventListener('keydown', handleHyperFocusKeydown);
  qa('[data-close-hf]').forEach((btn) => btn.addEventListener('click', () => {
    if (btn.dataset.closeHf === 'hfImportDialog' && !confirmDiscardImport()) return;
    byId(btn.dataset.closeHf)?.close();
  }));
  // El importador ya no se cierra al pinchar fuera: configurar el mapeo de una base
  // toma varios minutos y un clic perdido borraba todo el trabajo. Escape tampoco
  // cierra sin preguntar mientras haya una base cargada.
  byId('hfImportDialog')?.addEventListener('cancel', (ev) => {
    if (!confirmDiscardImport()) ev.preventDefault();
  });
  byId('hfSessionDialog')?.addEventListener('cancel', async (ev) => {
    // Escape no puede cerrar primero y liberar después: si la liberación falla,
    // el registro debe seguir visible en la sesión para no ocultar un claim activo.
    // Tampoco debe liberar el claim mientras otra escritura sigue en curso.
    ev.preventDefault();
    if (focus.busy) return;
    focus.busy = true;
    try {
      if (await releaseCurrentClaim()) byId('hfSessionDialog')?.close();
    } finally {
      focus.busy = false;
    }
  });
  bindImportControls();

  byId('hfCrmCampaignForm')?.addEventListener('submit', createCampaignFromCrm);
  ['hfCrmStage', 'hfCrmOwner', 'hfCrmIndustry', 'hfCrmSource', 'hfCrmWithChannel'].forEach((id) => {
    byId(id)?.addEventListener('change', () => {
      if (id === 'hfCrmStage') {
        const stage = byId('hfCrmStage')?.value || '';
        if (stage === 'Remarketing') byId('hfCrmCampaignType').value = 'remarketing';
        else if (stage === 'Perdido') byId('hfCrmCampaignType').value = 'reactivation';
      }
      renderCrmCampaignPreview();
    });
  });
}
