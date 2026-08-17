import {
  ACTIVITY_TYPES,
  BUY_TRIGGERS,
  CURRENT_MANAGEMENT,
  DEFAULT_PROBABILITY,
  INDUSTRIES,
  LOSS_REASONS,
  MODULES,
  REMARKETING_REASONS,
  SOURCES,
  STAGE_TEMPLATE,
  STAGES
} from './catalog.js';
import {
  addActivity,
  addContact,
  addTemplate,
  contactsOf,
  deleteActivity,
  deleteContact,
  deleteLead,
  deleteTemplate,
  emptyData,
  findContact,
  toggleCommitmentDone,
  findDuplicate,
  getDiscovery,
  getLead,
  metrics,
  onChange,
  persist,
  replaceState,
  saveDiscovery,
  saveTemplate,
  setStage,
  state,
  updateLead,
  upsertLead
} from './store.js';
import * as api from './api.js';
import {
  fillTemplate,
  filterPipeline,
  renderDashboard,
  renderImplementation,
  renderLeadDetail,
  renderLeads,
  renderPipeline,
  renderRemarketing,
  renderTemplates,
  templatePreviewHtml
} from './views.js';
import { $, $$, copyText, escapeHtml, fmtDate, fmtDateTime, localDateTimeInput, nowISO, todayISO, toast, uid } from './utils.js';

const CFG = window.TASKFLOW_CRM_CONFIG;

const ui = {
  view: 'dashboard',
  leadFilters: { query: '', owner: '', sort: 'updated' },
  pipelineView: 'kanban',
  pipelineFilters: { query: '', stage: '', owner: '' },
  templateLead: '',
  templateChannel: '',
  templateOpen: ''
};

const VIEWS = {
  dashboard: ['Resumen', 'Gestión comercial y seguimiento de oportunidades TaskFlow.', renderDashboard],
  leads: ['Leads', 'Empresas por calificar antes de sumarse al pipeline.', renderLeads],
  pipeline: ['Embudo Comercial', 'Prospectos calificados, desde el primer contacto hasta el cierre.', renderPipeline],
  remarketing: ['Remarketing', 'Prospectos con un "no" temporal — retomar en el momento indicado.', renderRemarketing],
  implementation: ['Implementación', 'Oportunidades ganadas que pasan a puesta en marcha.', renderImplementation],
  templates: ['Plantillas', 'Mensajes comerciales con variables por empresa.', renderTemplates]
};

/* ---------- Render ---------- */

function render() {
  const [title, subtitle, view] = VIEWS[ui.view];
  $('viewTitle').textContent = title;
  $('viewSubtitle').textContent = subtitle;

  const active = document.activeElement;
  const activeId = active && active.closest?.('#viewRoot') ? active.id : null;
  const caret = activeId && 'selectionStart' in active ? active.selectionStart : null;

  $('viewRoot').innerHTML = view(ui);

  if (activeId) {
    const el = $(activeId);
    if (el) {
      el.focus();
      if (caret != null && 'setSelectionRange' in el) el.setSelectionRange(caret, caret);
    }
  }
  if (ui.view === 'pipeline') bindKanbanDrag();
  if (ui.view === 'templates') bindTemplateAccordion();
}

/* ---------- Selects ---------- */

const options = (list, selected = '') =>
  list.map((v) => `<option ${v === selected ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('');

function fillStaticSelects() {
  $('industry').innerHTML = options(INDUSTRIES);
  $('source').innerHTML = options(SOURCES);
  $('stage').innerHTML = options(STAGES);
  $('lossReason').innerHTML = `<option value="">Sin especificar</option>${options(LOSS_REASONS)}`;
  $('stageLossReason').innerHTML = `<option value="">Sin especificar</option>${options(LOSS_REASONS)}`;
  $('stageRemarketingReason').innerHTML = `<option value="">Sin especificar</option>${options(REMARKETING_REASONS)}`;
  $('buyTrigger').innerHTML = options(BUY_TRIGGERS);
  $('currentManagement').innerHTML = options(CURRENT_MANAGEMENT);
  $('activityType').innerHTML = options(ACTIVITY_TYPES);
  $('moduleChecks').innerHTML = MODULES.map(
    (v) => `<label><input type="checkbox" value="${escapeHtml(v)}"> ${escapeHtml(v)}</label>`
  ).join('');
}

const leadOptions = (selected = '', placeholder = 'Selecciona una empresa') =>
  `<option value="">${placeholder}</option>` +
  state.leads
    .map((l) => `<option value="${l.id}" ${l.id === selected ? 'selected' : ''}>${escapeHtml(l.company)}</option>`)
    .join('');

/* ---------- Diálogo: lead ---------- */

const LEAD_FIELDS = [
  'company', 'rut', 'industry', 'source', 'contact', 'role', 'email', 'phone', 'stage', 'priority',
  'value', 'probability', 'expectedCloseDate', 'owner', 'nextAction', 'nextDate', 'lossReason', 'notes'
];

function openLead(id) {
  const l = getLead(id) || {};
  $('leadDialogTitle').textContent = id ? 'Editar oportunidad' : 'Nuevo lead';
  $('leadId').value = l.id || '';
  LEAD_FIELDS.forEach((k) => {
    const el = $(k);
    if (!el) return;
    const fallback = k === 'stage' ? 'Lead' : k === 'priority' ? 'Media' : k === 'probability' ? DEFAULT_PROBABILITY.Lead : '';
    el.value = l[k] ?? fallback;
  });
  toggleLossField();
  $('leadDialog').showModal();
  setTimeout(() => $('company').focus(), 50);
}

function toggleLossField() {
  $('lossReasonField').hidden = $('stage').value !== 'Perdido';
}

function submitLead(e) {
  e.preventDefault();
  const company = $('company').value.trim();
  if (!company) return toast('La empresa es obligatoria.', 'error');

  const id = $('leadId').value;
  const dup = findDuplicate(company, id);
  if (dup && !confirm(`Ya existe “${dup.company}”. ¿Guardar de todos modos?`)) return;

  const payload = { id: id || undefined };
  LEAD_FIELDS.forEach((k) => (payload[k] = $(k).value.trim ? $(k).value.trim() : $(k).value));
  upsertLead(payload);
  $('leadDialog').close();
  toast(id ? 'Oportunidad actualizada.' : 'Lead creado.');
}

/* ---------- Diálogo: levantamiento ---------- */

const DISCOVERY_FIELDS = ['pain', 'currentManagement', 'technicians', 'locations', 'buyTrigger', 'integrations', 'successCriteria', 'technicalNotes'];

function openDiscovery(id) {
  const lead = getLead(id);
  if (!lead) return;
  const d = getDiscovery(id) || {};
  $('discoveryLeadId').value = id;
  $('discoverySubtitle').textContent = `${lead.company} · ${lead.stage}`;
  DISCOVERY_FIELDS.forEach((k) => ($(k).value = d[k] ?? ''));
  $$('#moduleChecks input').forEach((c) => (c.checked = (d.modules || []).includes(c.value)));
  $('discoveryDialog').showModal();
}

function submitDiscovery(e) {
  e.preventDefault();
  const id = $('discoveryLeadId').value;
  const payload = Object.fromEntries(DISCOVERY_FIELDS.map((k) => [k, $(k).value.trim ? $(k).value.trim() : $(k).value]));
  payload.modules = $$('#moduleChecks input:checked').map((x) => x.value);
  saveDiscovery(id, payload);
  $('discoveryDialog').close();
  toast('Levantamiento guardado.');
}

/* ---------- Diálogo: actividad ---------- */

function openActivity(leadId = '') {
  if (!state.leads.length) return toast('Primero registra una empresa.', 'error');
  $('activityLeadId').innerHTML = leadOptions(leadId);
  fillActivityContacts(leadId);
  $('activityDate').value = localDateTimeInput();
  $('activityOwner').value = getLead(leadId)?.owner || '';
  $('activityDetail').value = '';
  $('activityCommitment').value = '';
  $('activityCommitmentDate').value = '';
  $('activityUpdatesNext').checked = true;
  $('activityDialog').showModal();
}

function fillActivityContacts(leadId) {
  const contacts = contactsOf(getLead(leadId));
  $('activityContactId').innerHTML =
    `<option value="">Sin especificar</option>` +
    contacts
      .map((c) => `<option value="${c.key}">${escapeHtml(c.name || 'Sin nombre')}${c.role ? ' · ' + escapeHtml(c.role) : ''}</option>`)
      .join('');
}

function submitActivity(e) {
  e.preventDefault();
  const leadId = $('activityLeadId').value;
  const detail = $('activityDetail').value.trim();
  if (!leadId) return toast('Selecciona una empresa.', 'error');
  if (!detail) return toast('Escribe el detalle de la actividad.', 'error');

  addActivity(
    {
      leadId,
      contactId: $('activityContactId').value,
      type: $('activityType').value,
      date: $('activityDate').value,
      owner: $('activityOwner').value.trim(),
      detail,
      commitment: $('activityCommitment').value.trim(),
      commitmentDate: $('activityCommitmentDate').value
    },
    { updateNextAction: $('activityUpdatesNext').checked }
  );
  $('activityDialog').close();
  toast('Actividad registrada.');
}

/* ---------- Diálogo: contacto ---------- */

function openContact(leadId) {
  const lead = getLead(leadId);
  if (!lead) return;
  $('contactLeadId').value = leadId;
  $('contactName').value = '';
  $('contactRole').value = '';
  $('contactPhone').value = '';
  $('contactEmail').value = '';
  $('contactDialog').showModal();
}

function submitContact(e) {
  e.preventDefault();
  const leadId = $('contactLeadId').value;
  const name = $('contactName').value.trim();
  if (!name) return toast('El nombre es obligatorio.', 'error');
  addContact(leadId, {
    name,
    role: $('contactRole').value.trim(),
    phone: $('contactPhone').value.trim(),
    email: $('contactEmail').value.trim()
  });
  $('contactDialog').close();
  toast('Contacto agregado.');
}

/* ---------- Diálogo: comunicación ---------- */

function openComm(leadId, contactKey, channel, preferredTemplateId) {
  const lead = getLead(leadId);
  const contact = findContact(lead, contactKey);
  if (!lead || !contact || !state.templates.length) return;

  $('commLeadId').value = leadId;
  $('commContactKey').value = contactKey;
  $('commChannel').value = channel;
  $('commDialogTitle').textContent = channel === 'whatsapp' ? 'Escribir WhatsApp' : 'Escribir correo';
  $('commDialogSubtitle').textContent = `${contact.name || 'Sin nombre'} · ${lead.company}`;
  $('commSubjectField').hidden = channel === 'whatsapp';
  $('commSendBtn').textContent = channel === 'whatsapp' ? 'Abrir WhatsApp' : 'Abrir correo';

  const defaultId = preferredTemplateId || STAGE_TEMPLATE[lead.stage] || state.templates[0].id;
  $('commTemplate').innerHTML = state.templates
    .map((t) => `<option value="${t.id}" ${t.id === defaultId ? 'selected' : ''}>${escapeHtml(t.name)}</option>`)
    .join('');

  fillCommFields();
  $('commDialog').showModal();
}

function fillCommFields() {
  const leadId = $('commLeadId').value;
  const contact = findContact(getLead(leadId), $('commContactKey').value);
  const t = state.templates.find((x) => x.id === $('commTemplate').value) || state.templates[0];
  if (!t) return;
  $('commSubject').value = fillTemplate(t.subject, leadId, contact);
  $('commBody').value = fillTemplate(t.body, leadId, contact);
}

async function copyComm() {
  const channel = $('commChannel').value;
  const text = channel === 'whatsapp' ? $('commBody').value : `${$('commSubject').value}\n\n${$('commBody').value}`;
  const ok = await copyText(text);
  toast(ok ? 'Copiado al portapapeles.' : 'No se pudo copiar.', ok ? 'info' : 'error');
}

function submitComm(e) {
  e.preventDefault();
  const leadId = $('commLeadId').value;
  const lead = getLead(leadId);
  const contactKey = $('commContactKey').value;
  const contact = findContact(lead, contactKey);
  const channel = $('commChannel').value;
  const body = $('commBody').value;
  const templateName = state.templates.find((x) => x.id === $('commTemplate').value)?.name || 'Personalizado';

  if (channel === 'whatsapp') {
    if (!contact?.phone) return toast('Ese contacto no tiene teléfono.', 'error');
    const digits = contact.phone.replace(/\D/g, '');
    if (!digits) return toast('El teléfono no es válido.', 'error');
    addActivity(
      { leadId, contactId: contactKey, type: 'WhatsApp', date: localDateTimeInput(), owner: lead.owner || '', detail: `Plantilla “${templateName}” enviada por WhatsApp a ${contact.name || contact.phone}.`, commitment: '' },
      { updateNextAction: false }
    );
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(body)}`, '_blank', 'noopener');
  } else {
    if (!contact?.email) return toast('Ese contacto no tiene email.', 'error');
    addActivity(
      { leadId, contactId: contactKey, type: 'Correo', date: localDateTimeInput(), owner: lead.owner || '', detail: `Plantilla “${templateName}” enviada por correo a ${contact.name || contact.email}.`, commitment: '' },
      { updateNextAction: false }
    );
    window.location.href = `mailto:${encodeURIComponent(contact.email)}?subject=${encodeURIComponent($('commSubject').value)}&body=${encodeURIComponent(body)}`;
  }
  $('commDialog').close();
  toast(channel === 'whatsapp' ? 'WhatsApp abierto.' : 'Correo abierto.');
}

/* ---------- Gestionar pendientes ---------- */

let manageQueue = [];
let manageIndex = 0;

function openManage() {
  manageQueue = metrics()
    .open.filter((l) => l.nextDate)
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate))
    .map((l) => l.id);
  if (!manageQueue.length) return toast('No hay próximas acciones pendientes.', 'info');
  manageIndex = 0;
  renderManage();
  $('manageDialog').showModal();
}

function renderManage() {
  const lead = getLead(manageQueue[manageIndex]);
  if (!lead) {
    manageQueue.splice(manageIndex, 1);
    if (!manageQueue.length) return $('manageDialog').close();
    manageIndex = Math.min(manageIndex, manageQueue.length - 1);
    return renderManage();
  }
  const contact = contactsOf(lead)[0] || null;

  $('manageCounter').textContent = `${manageIndex + 1} / ${manageQueue.length} pendientes`;
  $('manageCompany').textContent = lead.company;
  $('manageStage').textContent = lead.stage;
  $('manageContact').textContent = contact
    ? [contact.name, contact.phone, contact.email].filter(Boolean).join(' · ')
    : 'Sin contacto registrado';
  $('manageCurrentAction').textContent = lead.nextAction || 'Sin próxima acción';
  $('manageCurrentDate').textContent = fmtDate(lead.nextDate);
  $('manageCurrentDate').classList.toggle('danger', Boolean(lead.nextDate && lead.nextDate < todayISO()));
  $('manageNote').value = '';
  $('manageNextAction').value = lead.nextAction || '';
  $('manageNextDate').value = lead.nextDate || '';

  $('managePrevBtn').disabled = manageIndex === 0;
  $('manageNextBtn').disabled = manageIndex === manageQueue.length - 1;
  $('manageCallBtn').hidden = !contact?.phone;
  $('manageWhatsappBtn').hidden = !contact?.phone;
  $('manageEmailBtn').hidden = !contact?.email;
  [$('manageCallBtn'), $('manageWhatsappBtn'), $('manageEmailBtn')].forEach((btn) => {
    btn.dataset.id = lead.id;
    if (contact) btn.dataset.contact = contact.key;
  });
  $('manageOpenFichaBtn').dataset.id = lead.id;
}

function manageStep(delta) {
  manageIndex = Math.min(Math.max(manageIndex + delta, 0), manageQueue.length - 1);
  renderManage();
}

function submitManage(e) {
  e.preventDefault();
  const id = manageQueue[manageIndex];
  const lead = getLead(id);
  if (!lead) return;
  const note = $('manageNote').value.trim();
  if (note) {
    addActivity(
      { leadId: id, type: 'Seguimiento', date: localDateTimeInput(), owner: lead.owner || '', detail: note, commitment: '' },
      { updateNextAction: false }
    );
  }
  updateLead(id, { nextAction: $('manageNextAction').value.trim(), nextDate: $('manageNextDate').value });
  toast('Guardado.');
  if (manageIndex < manageQueue.length - 1) manageStep(1);
  else {
    $('manageDialog').close();
    toast('Terminaste la lista de pendientes.');
  }
}

/* ---------- Diálogo: mover de etapa ---------- */

function openStage(id) {
  const lead = getLead(id);
  if (!lead) return;
  $('stageLeadId').value = id;
  $('stageDialogLead').textContent = `${lead.company} · actualmente en ${lead.stage}`;
  $('stageOptions').innerHTML = STAGES.map(
    (s) => `<label class="stage-option ${s === lead.stage ? 'current' : ''}">
      <input type="radio" name="stageChoice" value="${escapeHtml(s)}" ${s === lead.stage ? 'checked' : ''}> ${escapeHtml(s)}
    </label>`
  ).join('');
  $('stageLossReason').value = lead.lossReason || '';
  $('stageRemarketingReason').value = lead.remarketingReason || '';
  updateStageFields();
  $('stageDialog').showModal();
}

const selectedStage = () => document.querySelector('input[name="stageChoice"]:checked')?.value || '';
function updateStageFields() {
  const stage = selectedStage();
  $('stageLossField').hidden = stage !== 'Perdido';
  $('stageRemarketingField').hidden = stage !== 'Remarketing';
}

function submitStage(e) {
  e.preventDefault();
  const id = $('stageLeadId').value;
  const stage = selectedStage();
  if (!stage) return;
  setStage(id, stage, { lossReason: $('stageLossReason').value, remarketingReason: $('stageRemarketingReason').value });
  $('stageDialog').close();
  toast(`Movida a ${stage}.`);
}

/* ---------- Ficha ---------- */

let detailLeadId = '';
function openDetail(id) {
  const lead = getLead(id);
  if (!lead) return;
  detailLeadId = id;
  $('detailTitle').textContent = lead.company;
  $('detailSubtitle').textContent = `${lead.stage} · actualizada ${fmtDateTime(lead.updatedAt)}`;
  $('detailBody').innerHTML = renderLeadDetail(id);
  $('detailDeleteBtn').dataset.id = id;
  $('detailDialog').showModal();
}

/* ---------- Kanban ---------- */

function bindKanbanDrag() {
  let draggedId = null;
  $$('.deal-card').forEach((card) => {
    card.addEventListener('dragstart', (ev) => {
      draggedId = card.dataset.id;
      ev.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  });
  $$('.kanban-list').forEach((list) => {
    list.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      list.classList.add('drop-target');
    });
    list.addEventListener('dragleave', () => list.classList.remove('drop-target'));
    list.addEventListener('drop', (ev) => {
      ev.preventDefault();
      list.classList.remove('drop-target');
      const target = list.dataset.stage;
      const lead = getLead(draggedId);
      if (!lead || lead.stage === target) return;
      if (target === 'Perdido') return openStage(lead.id); // exige motivo
      setStage(lead.id, target);
      toast(`${lead.company} → ${target}`);
    });
  });
}

/* ---------- Plantillas ---------- */

/** Mantiene abierta la plantilla que el usuario estaba editando entre re-renders. */
function bindTemplateAccordion() {
  $$('#viewRoot .template-item').forEach((item) =>
    item.addEventListener('toggle', () => {
      if (item.open) ui.templateOpen = item.dataset.id;
      else if (ui.templateOpen === item.dataset.id) ui.templateOpen = '';
    })
  );
}

/** Valores actuales del editor (incluye cambios aún no guardados). */
function templateDraft(id) {
  const t = state.templates.find((x) => x.id === id);
  if (!t) return null;
  const val = (attr, fallback) => document.querySelector(`[${attr}="${id}"]`)?.value ?? fallback;
  return {
    name: val('data-template-name', t.name),
    channel: val('data-template-channel', t.channel),
    subject: val('data-template-subject', t.subject),
    body: val('data-template-body', t.body)
  };
}

function updateTemplatePreview(id) {
  const box = document.querySelector(`[data-template-preview="${id}"]`);
  const draft = templateDraft(id);
  if (box && draft) box.innerHTML = templatePreviewHtml(draft, ui.templateLead);
}

/** Refresca la vista previa y el encabezado sin volver a pintar toda la vista (no perdemos el foco). */
function onTemplateEdit(id, el) {
  const item = document.querySelector(`.template-item[data-id="${id}"]`);
  if (item) {
    item.classList.add('dirty');
    if (el.dataset.templateName) {
      const title = item.querySelector('.template-title');
      if (title) title.textContent = el.value || 'Sin nombre';
    }
    if (el.dataset.templateChannel) {
      const subjectField = item.querySelector('.template-subject-field');
      if (subjectField) subjectField.hidden = el.value === 'whatsapp';
    }
  }
  updateTemplatePreview(id);
}

/** Inserta una variable en el campo del editor donde estaba el cursor. */
let lastTemplateField = null;
function insertVariable(id, variable) {
  const item = document.querySelector(`.template-item[data-id="${id}"]`);
  const field =
    lastTemplateField && item?.contains(lastTemplateField) ? lastTemplateField : item?.querySelector(`[data-template-body="${id}"]`);
  if (!field) return;
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? field.value.length;
  field.value = field.value.slice(0, start) + variable + field.value.slice(end);
  field.focus();
  field.setSelectionRange(start + variable.length, start + variable.length);
  onTemplateEdit(id, field);
}

/* ---------- Acciones delegadas ---------- */

const ACTIONS = {
  'new-lead': () => openLead(),
  'edit-lead': (id) => openLead(id),
  'open-detail': (id) => openDetail(id),
  'open-discovery': (id) => openDiscovery(id),
  'new-activity': (id) => openActivity(id),
  'move-stage': (id) => openStage(id),
  'pipeline-view-kanban': () => {
    ui.pipelineView = 'kanban';
    render();
  },
  'pipeline-view-list': () => {
    ui.pipelineView = 'list';
    render();
  },
  'export-pipeline-csv': () => exportPipelineCsv(),
  'open-manage': () => openManage(),
  'qualify-lead': (id) => {
    const lead = getLead(id);
    if (!lead) return;
    setStage(id, 'Contactado');
    toast(`${lead.company} calificado → Contactado.`);
  },
  'add-contact': (id) => openContact(id),
  'delete-contact': (id, btn) => {
    if (confirm('¿Eliminar este contacto?')) {
      deleteContact(id, btn.dataset.contact);
      toast('Contacto eliminado.');
    }
  },
  'call-contact': (id, btn) => {
    const lead = getLead(id);
    const contact = findContact(lead, btn.dataset.contact);
    if (!contact?.phone) return toast('Ese contacto no tiene teléfono.', 'error');
    addActivity(
      { leadId: id, contactId: btn.dataset.contact, type: 'Llamada', date: localDateTimeInput(), owner: lead.owner || '', detail: `Llamada iniciada a ${contact.name || contact.phone}.`, commitment: '' },
      { updateNextAction: false }
    );
    window.location.href = `tel:${contact.phone.replace(/[^\d+]/g, '')}`;
  },
  'open-whatsapp': (id, btn) => openComm(id, btn.dataset.contact, 'whatsapp'),
  'open-email': (id, btn) => openComm(id, btn.dataset.contact, 'email'),
  'remarketing-email': (id, btn) => openComm(id, 'primary', 'email', btn.dataset.template),
  'delete-activity': (id) => {
    if (confirm('¿Eliminar esta actividad?')) {
      deleteActivity(id);
      toast('Actividad eliminada.');
    }
  },
  'toggle-commitment': (id) => {
    const act = toggleCommitmentDone(id);
    if (act) toast(act.commitmentDone ? 'Compromiso marcado como hecho.' : 'Compromiso reabierto.');
  },
  'delete-lead': (id) => {
    const lead = getLead(id);
    if (!lead) return;
    if (confirm(`¿Eliminar “${lead.company}” con su levantamiento, actividades y archivos?`)) {
      deleteLead(id);
      if ($('detailDialog').open) $('detailDialog').close();
      toast('Oportunidad eliminada.');
    }
  },
  'new-template': () => {
    const record = addTemplate(ui.templateChannel || 'both');
    ui.templateOpen = record.id;
    render();
    toast('Plantilla creada. Complétala y guárdala.');
  },
  'save-template': (id) => {
    const draft = templateDraft(id);
    if (!draft) return;
    if (!draft.name.trim()) return toast('El nombre de la plantilla es obligatorio.', 'error');
    saveTemplate(id, {
      name: draft.name.trim(),
      channel: draft.channel || 'both',
      subject: draft.subject.trim(),
      body: draft.body
    });
    toast('Plantilla guardada.');
  },
  'delete-template': (id) => {
    if (!confirm('¿Eliminar esta plantilla?')) return;
    if (!deleteTemplate(id)) return toast('Debe quedar al menos una plantilla.', 'error');
    toast('Plantilla eliminada.');
  },
  'insert-var': (id, btn) => insertVariable(id, btn.dataset.var),
  'copy-template': async (id) => {
    const draft = templateDraft(id);
    if (!draft) return;
    const subject = fillTemplate(draft.subject, ui.templateLead);
    const body = fillTemplate(draft.body, ui.templateLead);
    const text = draft.channel === 'whatsapp' || !subject ? body : `${subject}\n\n${body}`;
    const ok = await copyText(text);
    toast(ok ? 'Mensaje copiado con los datos resueltos.' : 'No se pudo copiar.', ok ? 'info' : 'error');
  },
  'test-template': (id) => {
    const lead = getLead(ui.templateLead);
    if (!lead) return toast('Elige una empresa en “Vista previa” para probar el envío.', 'error');
    if (document.querySelector(`.template-item[data-id="${id}"]`)?.classList.contains('dirty')) {
      return toast('Guarda la plantilla antes de probar el envío.', 'error');
    }
    const draft = templateDraft(id);
    const channel = draft?.channel === 'whatsapp' ? 'whatsapp' : 'email';
    openComm(lead.id, 'primary', channel, id);
  }
};

function handleClick(ev) {
  const btn = ev.target.closest('[data-action]');
  if (!btn) return;
  ACTIONS[btn.dataset.action]?.(btn.dataset.id, btn);
}

/** Los contenedores clickeables (tarjetas del embudo) también responden a teclado. */
function handleKeydown(ev) {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  const el = ev.target.closest?.('[data-action][role="button"]');
  if (!el) return;
  ev.preventDefault();
  ACTIONS[el.dataset.action]?.(el.dataset.id, el);
}

/* ---------- Controles de vista ---------- */

function handleViewInput(ev) {
  const el = ev.target;
  const tplId = el.dataset.templateName || el.dataset.templateChannel || el.dataset.templateSubject || el.dataset.templateBody;
  if (tplId) return onTemplateEdit(tplId, el);

  const id = el.id;
  const value = el.type === 'checkbox' ? el.checked : el.value;
  const map = {
    leadQuery: () => (ui.leadFilters.query = value),
    leadOwner: () => (ui.leadFilters.owner = value),
    leadSort: () => (ui.leadFilters.sort = value),
    pipelineQuery: () => (ui.pipelineFilters.query = value),
    pipelineStage: () => (ui.pipelineFilters.stage = value),
    pipelineOwner: () => (ui.pipelineFilters.owner = value),
    templateLead: () => (ui.templateLead = value),
    templateChannel: () => (ui.templateChannel = value)
  };
  if (!map[id]) return;
  map[id]();
  render();
}

/* ---------- Datos y respaldo ---------- */

function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `taskflow-crm-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadCsv(filename, cols, rows) {
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...rows.map((row) => cols.map((c) => escape(row[c])).join(','))].join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportCsv() {
  const cols = ['company', 'rut', 'industry', 'source', 'contact', 'role', 'email', 'phone', 'stage', 'lossReason', 'value', 'probability', 'expectedCloseDate', 'nextAction', 'nextDate', 'owner'];
  downloadCsv(`taskflow-leads-${todayISO()}.csv`, cols, state.leads);
}

function exportPipelineCsv() {
  const cols = ['company', 'contact', 'email', 'phone', 'stage', 'value', 'probability', 'owner', 'nextAction', 'nextDate'];
  const rows = filterPipeline(ui.pipelineFilters);
  if (!rows.length) return toast('No hay filas para exportar con estos filtros.', 'error');
  downloadCsv(`taskflow-embudo-${todayISO()}.csv`, cols, rows);
}

function importJson(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported.leads)) throw new Error('El archivo no tiene una lista de leads.');
      if (state.leads.length && !confirm('Esto reemplaza los datos actuales de este navegador. ¿Continuar?')) return;
      replaceState(imported);
      toast('Datos importados.');
    } catch (err) {
      toast(`No se pudo importar: ${err.message}`, 'error');
    } finally {
      ev.target.value = '';
    }
  };
  reader.readAsText(file);
}

function resetAll() {
  if (!confirm('Se borrarán todos los datos guardados en este navegador. ¿Continuar?')) return;
  replaceState(emptyData());
  toast('Datos borrados.');
}

function seedExample() {
  if (state.leads.length && !confirm('Ya existen datos. ¿Agregar ejemplos igualmente?')) return;
  const base = [
    { company: 'ClimaSur Servicios', industry: 'HVAC / Climatización', contact: 'Paula Rojas', role: 'Jefa de Mantenimiento', email: 'paula@ejemplo.cl', phone: '+56 9 5555 1001', stage: 'Reunión / Demo', priority: 'Alta', value: 890000, probability: 35, nextAction: 'Demo enfocada en preventivos e inventario', source: 'Prospección en frío' },
    { company: 'VerticalTech', industry: 'Ascensores / Transporte vertical', contact: 'Andrés Silva', role: 'Gerente de Operaciones', email: 'andres@ejemplo.cl', phone: '+56 9 5555 1002', stage: 'Propuesta', priority: 'Alta', value: 1250000, probability: 55, nextAction: 'Seguimiento propuesta y alcance de certificación', source: 'Referido' },
    { company: 'PowerGen Chile', industry: 'Grupos electrógenos', contact: 'Carolina Díaz', role: 'Jefa de Servicio Técnico', email: 'carolina@ejemplo.cl', phone: '+56 9 5555 1003', stage: 'Contactado', priority: 'Media', value: 690000, probability: 15, nextAction: 'Coordinar reunión de descubrimiento', source: 'LinkedIn' },
    { company: 'Andes Facility', industry: 'Facility Management', contact: 'Rodrigo Pérez', role: 'Subgerente', email: 'rodrigo@ejemplo.cl', phone: '+56 9 5555 1004', stage: 'Perdido', priority: 'Baja', value: 540000, probability: 0, lossReason: 'Eligió a un competidor', nextAction: '', source: 'Web' }
  ].map((x) => ({
    id: uid('lead'),
    rut: '',
    notes: '',
    owner: 'Comercial TaskFlow',
    nextDate: todayISO(),
    expectedCloseDate: '',
    createdAt: nowISO(),
    updatedAt: nowISO(),
    stageHistory: [{ stage: 'Lead', at: nowISO() }, { stage: x.stage, at: nowISO() }],
    ...x
  }));

  state.leads.push(...base);
  state.discoveries[base[0].id] = {
    pain: 'Preventivos vencidos, historial incompleto y poca visibilidad de repuestos.',
    currentManagement: 'Excel / formularios',
    technicians: '18',
    locations: '3',
    buyTrigger: 'Crecimiento de cuadrillas',
    modules: ['Órdenes de trabajo', 'Técnicos en terreno', 'Inventario / Bodegas', 'Trazabilidad / Reportes'],
    integrations: 'Power BI',
    successCriteria: 'Controlar cumplimiento preventivo y trazabilidad por equipo.',
    technicalNotes: '',
    updatedAt: nowISO()
  };
  state.activities.push({
    id: uid('act'),
    leadId: base[0].id,
    type: 'Reunión',
    date: localDateTimeInput(),
    owner: 'Comercial TaskFlow',
    detail: 'Levantamiento inicial con jefatura de mantenimiento.',
    commitment: 'Enviar agenda de demo con casos de preventivos'
  });
  persist();
  toast('Datos de ejemplo cargados.');
}

/* ---------- Sincronización ---------- */

function paintSync(status) {
  const pill = $('syncStatus');
  pill.dataset.state = status.state;
  $('syncStatusText').textContent = status.message;
}

function openDataDialog() {
  const { leads, activities, meta } = state;
  $('dataSummary').textContent = `${leads.length} leads · ${activities.length} actividades`;
  $('syncHint').textContent = api.isConfigured()
    ? `Endpoint configurado. Última sincronización: ${meta.lastSyncAt ? fmtDateTime(meta.lastSyncAt) : 'nunca'}.`
    : 'Sin endpoint. Completa apiUrl en config.js con la URL de tu Aplicación web de Apps Script.';
  $('pullBtn').disabled = !api.isConfigured();
  $('pushBtn').disabled = !api.isConfigured();
  $('autoSyncToggle').disabled = !api.isConfigured();
  $('autoSyncToggle').checked = api.autoSyncEnabled();
  $('dataDialog').showModal();
}

async function doPull() {
  if (!confirm('Se reemplazarán los datos locales con los de la planilla. ¿Continuar?')) return;
  try {
    await api.pull();
    toast('Datos descargados de Sheets.');
  } catch (err) {
    toast(`Error al descargar: ${err.message}`, 'error');
  }
}

async function doPush() {
  try {
    await api.push();
    toast('Datos subidos a Sheets.');
  } catch (err) {
    toast(`Error al subir: ${err.message}`, 'error');
  }
}

/* ---------- Arranque ---------- */

function bindEvents() {
  $$('.nav-item').forEach((btn) =>
    btn.addEventListener('click', () => {
      ui.view = btn.dataset.view;
      $$('.nav-item').forEach((x) => x.classList.toggle('active', x === btn));
      render();
    })
  );

  $('seedBtn').addEventListener('click', seedExample);
  $('dataBtn').addEventListener('click', openDataDialog);
  $('syncStatus').addEventListener('click', openDataDialog);

  $('themeToggle').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.documentElement.dataset.theme = dark ? '' : 'dark';
    localStorage.setItem('taskflow-crm-theme', dark ? 'light' : 'dark');
  });
  if (localStorage.getItem('taskflow-crm-theme') === 'dark') document.documentElement.dataset.theme = 'dark';

  $$('[data-close-dialog]').forEach((b) => b.addEventListener('click', () => $(b.dataset.closeDialog).close()));
  $$('dialog.modal').forEach((dlg) => dlg.addEventListener('click', (ev) => ev.target === dlg && dlg.close()));

  $('leadForm').addEventListener('submit', submitLead);
  $('stage').addEventListener('change', toggleLossField);
  $('discoveryForm').addEventListener('submit', submitDiscovery);
  $('activityForm').addEventListener('submit', submitActivity);
  $('activityLeadId').addEventListener('change', (ev) => fillActivityContacts(ev.target.value));
  $('contactForm').addEventListener('submit', submitContact);
  $('commForm').addEventListener('submit', submitComm);
  $('commTemplate').addEventListener('change', fillCommFields);
  $('commCopyBtn').addEventListener('click', copyComm);
  $('manageForm').addEventListener('submit', submitManage);
  $('managePrevBtn').addEventListener('click', () => manageStep(-1));
  $('manageNextBtn').addEventListener('click', () => manageStep(1));
  $('stageForm').addEventListener('submit', submitStage);
  $('stageOptions').addEventListener('change', updateStageFields);
  $('detailEditBtn').addEventListener('click', () => {
    $('detailDialog').close();
    openLead(detailLeadId);
  });

  $('exportBtn').addEventListener('click', exportJson);
  $('exportCsvBtn').addEventListener('click', exportCsv);
  $('importInput').addEventListener('change', importJson);
  $('resetBtn').addEventListener('click', resetAll);
  $('pullBtn').addEventListener('click', doPull);
  $('pushBtn').addEventListener('click', doPush);
  $('autoSyncToggle').addEventListener('change', (ev) => {
    api.setAutoSync(ev.target.checked);
    toast(ev.target.checked ? 'Sincronización automática activada.' : 'Sincronización automática desactivada.');
  });

  document.addEventListener('click', handleClick);
  document.addEventListener('keydown', handleKeydown);
  $('viewRoot').addEventListener('input', handleViewInput);
  $('viewRoot').addEventListener('change', handleViewInput);
  $('viewRoot').addEventListener('focusin', (ev) => {
    if (ev.target.matches('[data-template-body], [data-template-subject]')) lastTemplateField = ev.target;
  });
}

function init() {
  document.title = `${CFG.appName} · ${CFG.companyName}`;
  fillStaticSelects();
  bindEvents();

  onChange(() => {
    render();
    if ($('detailDialog').open && detailLeadId) $('detailBody').innerHTML = renderLeadDetail(detailLeadId);
    api.queuePush();
  });
  api.onStatus(paintSync);

  render();
  if (api.isConfigured()) api.health();
  else paintSync(api.getStatus());
}

init();
