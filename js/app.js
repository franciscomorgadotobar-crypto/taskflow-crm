import {
  ACTIVITY_TYPES,
  BUY_TRIGGERS,
  CURRENT_MANAGEMENT,
  DEFAULT_PROBABILITY,
  INDUSTRIES,
  LOSS_REASONS,
  MODULES,
  QUOTE_STATUSES,
  REMARKETING_REASONS,
  SERVICE_UNITS,
  SOURCES,
  STAGE_TEMPLATE,
  STAGES,
  TASK_TYPES
} from './catalog.js';
import {
  addActivity,
  addContact,
  addTemplate,
  clearLocal,
  contactsOf,
  deleteActivity,
  deleteAllVisibleLeads,
  deleteContact,
  updateContact,
  deleteLead,
  completeTask,
  completeTaskAtomic,
  deleteTemplate,
  findContact,
  taskOf,
  updateActivity,
  findDuplicate,
  getActivity,
  getDiscovery,
  getLead,
  hydrate,
  metrics,
  openTasks,
  onChange,
  ownerNames,
  replaceState,
  saveDiscovery,
  saveProfile,
  saveTemplate,
  setStage,
  startRealtime,
  state,
  stopRealtime,
  updateLead,
  updateUser,
  upsertLead
} from './store.js';
import {
  buildQuoteEmail,
  clearLocal as quotesClearLocal,
  computeTotals,
  deleteQuote,
  getQuote,
  getService,
  hydrate as quotesHydrate,
  onChange as onQuotesChange,
  saveQuote,
  setQuoteStatus,
  startRealtime as quotesStartRealtime,
  state as quoteState,
  stopRealtime as quotesStopRealtime,
  upsertService,
  deleteService,
  versionsOf
} from './quotes.js';
import { isAdmin, onAuthChange, resetPassword, session, signIn, signOut, signUp } from './auth.js';
import {
  clearLocal as hyperFocusClearLocal,
  hydrate as hyperFocusHydrate,
  initUI as initHyperFocusUI,
  onChange as onHyperFocusChange,
  renderHyperFocus,
  startRealtime as hyperFocusStartRealtime,
  stopRealtime as hyperFocusStopRealtime
} from './hyperfocus.js';
import {
  fillTemplate,
  filterPipeline,
  quoteBuilderHtml,
  renderDashboard,
  renderImplementation,
  renderLeadDetail,
  renderLeads,
  renderPipeline,
  renderQuotes,
  renderRemarketing,
  renderSettings,
  renderTemplates,
  templatePreviewHtml
} from './views.js';
import {
  $,
  $$,
  addDaysISO,
  copyText,
  escapeHtml,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  localDateTimeInput,
  nowISO,
  openExternal,
  todayISO,
  toast,
  uid
} from './utils.js';

const CFG = window.TASKFLOW_CRM_CONFIG;

const ui = {
  view: 'dashboard',
  taskTab: 'overdue',
  chartA: 'stage',
  chartB: 'industry',
  leadFilters: { query: '', owner: '', sort: 'updated' },
  pipelineView: 'kanban',
  pipelineFilters: { query: '', stage: '', owner: '' },
  pipelineSort: { key: 'company', dir: 'asc' },
  templateLead: '',
  templateChannel: '',
  templateOpen: '',
  quotesView: 'list',
  quoteFilters: { status: '' },
  quoteBuilder: null
};

const VIEWS = {
  dashboard: ['Resumen', 'Gestión comercial y seguimiento de oportunidades TaskFlow.', renderDashboard],
  leads: ['Leads', 'Empresas por calificar antes de sumarse al pipeline.', renderLeads],
  hyperfocus: ['Híper Foco', 'Gestiona bases grandes una empresa a la vez, sin llenar el CRM de registros fríos.', renderHyperFocus],
  pipeline: ['Embudo Comercial', 'Prospectos calificados, desde el primer contacto hasta el cierre.', renderPipeline],
  remarketing: ['Remarketing', 'Prospectos con un "no" temporal — retomar en el momento indicado.', renderRemarketing],
  implementation: ['Implementación', 'Oportunidades ganadas que pasan a puesta en marcha.', renderImplementation],
  templates: ['Plantillas', 'Mensajes comerciales con variables por empresa.', renderTemplates],
  quotes: ['Cotizaciones', 'Servicios, valores y cotizaciones para tus clientes.', renderQuotes],
  settings: ['Configuración', 'Tu usuario, los accesos del equipo y los datos de demostración.', renderSettings]
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

function refreshDetailIfOpen() {
  if ($('detailDialog').open && detailLeadId) {
    $('detailBody').innerHTML = renderLeadDetail(detailLeadId);
    buildTaskTypeGroups($('detailBody'));
  }
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
  $('completeType').innerHTML = options(ACTIVITY_TYPES);
  $('manageType').innerHTML = options(ACTIVITY_TYPES);
  $('moduleChecks').innerHTML = MODULES.map(
    (v) => `<label><input type="checkbox" value="${escapeHtml(v)}"> ${escapeHtml(v)}</label>`
  ).join('');
  $('quoteStatusField').innerHTML = QUOTE_STATUSES.map((s) => `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join('');
  $('serviceUnits').innerHTML = SERVICE_UNITS.map((u) => `<option value="${escapeHtml(u)}">`).join('');
}

function fillOwnerSelect(selected = '') {
  const names = ownerNames();
  if (selected && !names.includes(selected)) names.push(selected);
  $('owner').innerHTML =
    `<option value="">Sin asignar</option>` +
    names.map((n) => `<option ${n === selected ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('');
}

const leadOptions = (selected = '', placeholder = 'Selecciona una empresa') =>
  `<option value="">${placeholder}</option>` +
  state.leads
    .map((l) => `<option value="${l.id}" ${l.id === selected ? 'selected' : ''}>${escapeHtml(l.company)}</option>`)
    .join('');

/* ---------- Diálogo: lead ---------- */

const LEAD_FIELDS = [
  'company', 'rut', 'industry', 'source', 'contact', 'role', 'email', 'phone', 'stage', 'priority',
  'value', 'probability', 'expectedCloseDate', 'owner', 'nextType', 'nextAction', 'nextDate', 'lossReason', 'notes'
];

const OWNED_ELSEWHERE = ['stage', 'lossReason', 'nextAction', 'nextDate', 'nextType'];

function openLead(id) {
  const l = getLead(id) || {};
  const editing = Boolean(id);
  $('leadDialogTitle').textContent = editing ? 'Editar datos de la empresa' : 'Nuevo lead';
  $('leadId').value = l.id || '';
  fillOwnerSelect(l.owner || session.profile?.name || '');
  LEAD_FIELDS.forEach((k) => {
    const el = $(k);
    if (!el) return;
    const fallback = k === 'stage' ? 'Lead' : k === 'priority' ? 'Media' : k === 'probability' ? DEFAULT_PROBABILITY.Lead : '';
    el.value = l[k] ?? fallback;
  });
  $('isPrivate').checked = Boolean(l.isPrivate);
  toggleLossField();
  setTaskType('lead', l.nextType || '');
  OWNED_ELSEWHERE.forEach((k) => {
    const field = $(k)?.closest('label');
    if (field) field.hidden = editing;
  });
  $('leadTaskTypeRow').hidden = editing;
  if (editing) $('lossReasonField').hidden = true;
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
  if (dup && !confirm(`Ya existe "${dup.company}". ¿Guardar de todos modos?`)) return;

  const payload = { id: id || undefined };
  const fields = id ? LEAD_FIELDS.filter((k) => !OWNED_ELSEWHERE.includes(k)) : LEAD_FIELDS;
  fields.forEach((k) => (payload[k] = $(k).value.trim ? $(k).value.trim() : $(k).value));
  payload.isPrivate = $('isPrivate').checked;
  if (!id && !payload.owner) payload.owner = session.profile?.name || '';
  upsertLead(payload);
  $('leadDialog').close();
  toast(id ? 'Datos actualizados.' : 'Lead creado.');
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

async function submitDiscovery(e) {
  e.preventDefault();
  const id = $('discoveryLeadId').value;
  const payload = Object.fromEntries(DISCOVERY_FIELDS.map((k) => [k, $(k).value.trim ? $(k).value.trim() : $(k).value]));
  payload.modules = $$('#moduleChecks input:checked').map((x) => x.value);
  if (!(await saveDiscovery(id, payload))) return;
  $('discoveryDialog').close();
  toast('Levantamiento guardado.');
}

/* ---------- Diálogo: actividad ---------- */

function openActivity(leadId = '') {
  if (!state.leads.length) return toast('Primero registra una empresa.', 'error');
  $('activityId').value = '';
  $('activityDialogTitle').textContent = 'Nueva actividad';
  $('activitySubmitBtn').textContent = 'Guardar actividad';
  $('activityLeadId').innerHTML = leadOptions(leadId);
  fillActivityContacts(leadId);
  $('activityType').value = ACTIVITY_TYPES[0];
  $('activityDate').value = localDateTimeInput();
  $('activityOwner').value = getLead(leadId)?.owner || '';
  $('activityDetail').value = '';
  syncActivityTaskResolution(leadId, false);
  $('activityDialog').showModal();
}

function editActivity(id) {
  const act = getActivity(id);
  if (!act) return;
  $('activityId').value = id;
  $('activityDialogTitle').textContent = 'Editar actividad';
  $('activitySubmitBtn').textContent = 'Guardar cambios';
  $('activityLeadId').innerHTML = leadOptions(act.leadId);
  fillActivityContacts(act.leadId);
  $('activityContactId').value = act.contactId || '';
  $('activityType').value = act.type || ACTIVITY_TYPES[0];
  $('activityDate').value = act.date || localDateTimeInput();
  $('activityOwner').value = act.owner || '';
  $('activityDetail').value = act.detail || '';
  syncActivityTaskResolution(act.leadId, true);
  $('activityDialog').showModal();
}

function syncActivityTaskResolution(leadId, editing = false) {
  const task = taskOf(getLead(leadId));
  $('activityResolveTask').checked = false;
  $('activityResolveTaskField').hidden = editing || !task;
  $('activityResolveTaskHint').textContent = editing
    ? 'Editar esta actividad no modifica la tarea pendiente.'
    : task
      ? `Tarea pendiente: ${task.title}${task.date ? ` · ${fmtDate(task.date)}` : ''}. Puedes marcarla como resuelta si esta interacción la reemplazó.`
      : 'Esta actividad queda registrada en el historial. La empresa no tiene una tarea pendiente que resolver.';
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
  const id = $('activityId').value;
  const leadId = $('activityLeadId').value;
  const detail = $('activityDetail').value.trim();
  if (!leadId) return toast('Selecciona una empresa.', 'error');
  if (!detail) return toast('Escribe el detalle de la actividad.', 'error');

  const payload = {
    leadId,
    contactId: $('activityContactId').value,
    type: $('activityType').value,
    date: $('activityDate').value,
    owner: $('activityOwner').value.trim(),
    detail
  };

  if (id) {
    updateActivity(id, payload);
  } else {
    const resolvesTask = $('activityResolveTask').checked;
    const pendingTask = resolvesTask ? taskOf(getLead(leadId)) : null;
    if (pendingTask) payload.task = pendingTask.title;
    addActivity(payload);
    if (pendingTask) {
      updateLead(leadId, { nextType: '', nextAction: '', nextDate: '' });
    }
  }

  $('activityDialog').close();
  toast(id ? 'Actividad actualizada.' : 'Actividad registrada.');
}

/* ---------- Diálogo: contacto ---------- */

function openContact(leadId, key = '') {
  const lead = getLead(leadId);
  if (!lead) return;
  const contact = key ? findContact(lead, key) : null;

  $('contactLeadId').value = leadId;
  $('contactKey').value = key;
  $('contactDialogTitle').textContent = contact ? 'Editar contacto' : 'Nuevo contacto';
  $('contactDialogSubtitle').textContent = contact
    ? `${contact.primary ? 'Contacto principal' : 'Contacto'} de ${lead.company}`
    : `Otra persona de contacto en ${lead.company}.`;
  $('contactSubmitBtn').textContent = contact ? 'Guardar cambios' : 'Guardar contacto';
  $('contactName').value = contact?.name || '';
  $('contactRole').value = contact?.role || '';
  $('contactPhone').value = contact?.phone || '';
  $('contactEmail').value = contact?.email || '';
  $('contactDialog').showModal();
  setTimeout(() => $('contactName').focus(), 50);
}

async function submitContact(e) {
  e.preventDefault();
  const leadId = $('contactLeadId').value;
  const key = $('contactKey').value;
  const name = $('contactName').value.trim();
  if (!name) return toast('El nombre es obligatorio.', 'error');

  const payload = {
    name,
    role: $('contactRole').value.trim(),
    phone: $('contactPhone').value.trim(),
    email: $('contactEmail').value.trim()
  };
  const saved = key ? await updateContact(leadId, key, payload) : await addContact(leadId, payload);
  if (!saved) return;

  $('contactDialog').close();
  toast(key ? 'Contacto actualizado.' : 'Contacto agregado.');
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
    addActivity({ leadId, contactId: contactKey, type: 'WhatsApp', date: localDateTimeInput(), owner: lead.owner || '', detail: `WhatsApp preparado con plantilla "${templateName}" para ${contact.name || contact.phone}.` });
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(body)}`, '_blank', 'noopener');
  } else {
    if (!contact?.email) return toast('Ese contacto no tiene email.', 'error');
    addActivity({ leadId, contactId: contactKey, type: 'Correo', date: localDateTimeInput(), owner: lead.owner || '', detail: `Correo preparado con plantilla "${templateName}" para ${contact.name || contact.email}.` });
    openExternal(`mailto:${encodeURIComponent(contact.email)}?subject=${encodeURIComponent($('commSubject').value)}&body=${encodeURIComponent(body)}`);
  }
  $('commDialog').close();
  toast(channel === 'whatsapp' ? 'WhatsApp abierto.' : 'Correo abierto.');
}

/* ---------- Gestionar pendientes, una por una ---------- */

let manageQueue = [];
let manageIndex = 0;

function tasksForTab() {
  const today = todayISO();
  const limit = addDaysISO(today, 1);
  const all = openTasks();
  if (ui.taskTab === 'soon') return all.filter((t) => t.date && t.date >= today && t.date <= limit);
  if (ui.taskTab === 'scheduled') return all.filter((t) => t.date && t.date > limit);
  return all.filter((t) => !t.date || t.date < today);
}

function openManage() {
  manageQueue = tasksForTab().map((t) => t.key);
  if (!manageQueue.length) return toast('No hay tareas en esta pestaña.', 'info');
  manageIndex = 0;
  renderManage();
  $('manageDialog').showModal();
}

const currentTask = () => openTasks().find((t) => t.key === manageQueue[manageIndex]) || null;

function renderManage() {
  const task = currentTask();
  if (!task) {
    manageQueue.splice(manageIndex, 1);
    if (!manageQueue.length) return $('manageDialog').close();
    manageIndex = Math.min(manageIndex, manageQueue.length - 1);
    return renderManage();
  }
  const lead = task.lead;
  const contact = contactsOf(lead)[0] || null;

  $('manageCounter').textContent = `${manageIndex + 1} / ${manageQueue.length} tareas`;
  $('manageCompany').textContent = lead.company;
  $('manageStage').textContent = lead.stage;
  $('manageContact').textContent = contact
    ? [contact.name, contact.phone, contact.email].filter(Boolean).join(' · ')
    : 'Sin contacto registrado';
  $('manageCurrentAction').textContent = task.title || 'Sin próxima acción';
  $('manageCurrentDate').textContent = task.date ? fmtDate(task.date) : 'Sin fecha';
  $('manageCurrentDate').classList.toggle('danger', !task.date || task.date < todayISO());
  $('manageType').value = task.type || ACTIVITY_TYPES[0];
  $('manageDate').value = localDateTimeInput();
  $('manageResult').value = '';
  $('manageNextAction').value = '';
  $('manageNextDate').value = '';
  setTaskType('manage', '');

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
  const task = currentTask();
  if (!task) return;
  const result = $('manageResult').value.trim();
  if (!result) return toast('Cuenta cómo resultó la tarea.', 'error');

  completeTask(task.lead.id, {
    type: $('manageType').value,
    date: $('manageDate').value || localDateTimeInput(),
    result,
    nextType: taskTypeValue('manage'),
    nextAction: $('manageNextAction').value.trim(),
    nextDate: $('manageNextDate').value
  });

  manageQueue.splice(manageIndex, 1);
  if (!manageQueue.length) {
    $('manageDialog').close();
    return toast('Terminaste la lista de tareas.');
  }
  manageIndex = Math.min(manageIndex, manageQueue.length - 1);
  renderManage();
  toast('Tarea cerrada.');
}

/* ---------- Cerrar tarea: resultado + siguiente tarea ---------- */

function openComplete(leadId) {
  const lead = getLead(leadId);
  const task = taskOf(lead);
  if (!task) return toast('Este prospecto no tiene una tarea abierta.', 'error');
  $('completeLeadId').value = leadId;
  $('completeSubtitle').textContent = `${task.title} · ${lead.company}`;
  $('completeResult').value = '';
  $('completeNextAction').value = '';
  $('completeNextDate').value = '';
  setTaskType('complete', '');
  $('completeDialog').showModal();
  setTimeout(() => $('completeResult').focus(), 50);
}

async function submitComplete(e) {
  e.preventDefault();
  const leadId = $('completeLeadId').value;
  const result = $('completeResult').value.trim();
  if (!result) return toast('Cuenta cómo resultó la tarea.', 'error');

  const nextType = taskTypeValue('complete');
  const nextAction = $('completeNextAction').value.trim();
  const nextDate = $('completeNextDate').value;
  if ((nextType || nextAction) && !nextDate) return toast('Elige la fecha de la siguiente tarea.', 'error');
  if (nextDate && !nextType && !nextAction) return toast('Elige el tipo de la siguiente tarea o escribe una nota.', 'error');
  const task = taskOf(getLead(leadId));
  const closed = await completeTaskAtomic(leadId, {
    type: task?.type || 'Actividad',
    date: localDateTimeInput(),
    result,
    nextType,
    nextAction,
    nextDate
  });
  if (!closed) return;

  $('completeDialog').close();
  toast(nextType || nextAction ? 'Tarea cerrada y siguiente agendada.' : 'Tarea cerrada. El prospecto quedó sin próximo paso.');
}

/* ---------- Agendar / reagendar la tarea ---------- */

function openTask(leadId) {
  const lead = getLead(leadId);
  if (!lead) return;
  const task = taskOf(lead);
  $('taskLeadId').value = leadId;
  $('taskDialogTitle').textContent = task ? 'Reagendar tarea' : 'Agendar tarea';
  $('taskSubtitle').textContent = lead.company;
  $('taskAction').value = task?.note || '';
  $('taskDate').value = task?.date || '';
  setTaskType('task', task?.type || '');
  $('taskDialog').showModal();
}

async function submitTask(e) {
  e.preventDefault();
  const nextType = taskTypeValue('task');
  const note = $('taskAction').value.trim();
  if (!nextType && !note) return toast('Elige el tipo de tarea o escribe una nota.', 'error');
  const date = $('taskDate').value;
  if (!date) return toast('Elige la fecha de la tarea.', 'error');
  if (!(await updateLead($('taskLeadId').value, { nextType, nextAction: note, nextDate: date }))) return;
  $('taskDialog').close();
  toast('Tarea agendada.');
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

async function submitStage(e) {
  e.preventDefault();
  const id = $('stageLeadId').value;
  const stage = selectedStage();
  if (!stage) return;
  if (!(await setStage(id, stage, { lossReason: $('stageLossReason').value, remarketingReason: $('stageRemarketingReason').value }))) return;
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
  buildTaskTypeGroups($('detailBody'));
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
      if (target === 'Perdido') return openStage(lead.id);
      if (await setStage(lead.id, target)) toast(`${lead.company} → ${target}`);
    });
  });
}

/* ---------- Tipo de tarea ---------- */

function buildTaskTypeGroups(root = document) {
  $$('[data-task-type-group]', root).forEach((group) => {
    const prefix = group.dataset.taskTypeGroup;
    if (group.querySelector('.task-type')) return;
    const label = group.querySelector('.task-type-label');
    const chips = TASK_TYPES.map(
      (t) =>
        `<button type="button" class="small-btn task-type" data-action="set-task-type" data-task-type="${prefix}" data-value="${escapeHtml(t.value)}">${escapeHtml(t.label)}</button>`
    ).join('');
    label.insertAdjacentHTML('afterend', chips);
  });
}

function setTaskType(prefix, value) {
  const input = $(prefix === 'lead' ? 'nextType' : `${prefix}NextType`);
  if (input) input.value = value;
  $$(`[data-task-type="${prefix}"]`).forEach((btn) => btn.classList.toggle('active-view', btn.dataset.value === value));
}

const taskTypeValue = (prefix) => $(prefix === 'lead' ? 'nextType' : `${prefix}NextType`)?.value || '';

/* ---------- Plantillas ---------- */

function bindTemplateAccordion() {
  $$('#viewRoot .template-item').forEach((item) =>
    item.addEventListener('toggle', () => {
      if (item.open) ui.templateOpen = item.dataset.id;
      else if (ui.templateOpen === item.dataset.id) ui.templateOpen = '';
    })
  );
}

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

/* ---------- Cotizador ---------- */

function emptyQuoteRow() {
  return { serviceId: '', name: '', unit: 'unidad', quantity: 1, unitPrice: 0 };
}

function renderQuoteItemsRoot() {
  $('quoteItemsRoot').innerHTML = quoteBuilderHtml(ui.quoteBuilder);
}

function openQuoteBuilder(leadId = '', baseId = '') {
  const base = baseId ? getQuote(baseId) : null;
  ui.quoteBuilder = {
    leadId: base?.leadId || leadId,
    // Al editar, cada item se guarda como fila nueva en la versión nueva: se descarta
    // el id/posición/subtotal de la versión anterior para no chocar con su primary key.
    items: base
      ? base.items.map(({ serviceId, name, unit, quantity, unitPrice }) => ({ serviceId, name, unit, quantity, unitPrice }))
      : [emptyQuoteRow()]
  };
  $('quoteBaseId').value = baseId;
  $('quoteDialogTitle').textContent = base ? `Editar cotización (crea versión ${base.version + 1})` : 'Nueva cotización';
  $('quoteDialogSubtitle').textContent = base ? 'Guardar deja esta como nueva versión; la anterior queda en el historial.' : 'Selecciona la empresa y agrega los items.';
  $('quoteLeadId').innerHTML = leadOptions(ui.quoteBuilder.leadId);
  $('quoteLeadId').disabled = Boolean(leadId && !base);
  $('quoteStatusField').value = base?.status || 'borrador';
  $('quoteValidUntil').value = base?.validUntil || '';
  $('quoteNotes').value = base?.notes || '';
  renderQuoteItemsRoot();
  $('quoteDialog').showModal();
}

async function submitQuoteBuilder(e) {
  e.preventDefault();
  const leadId = $('quoteLeadId').value;
  if (!leadId) return toast('Selecciona una empresa.', 'error');
  const items = ui.quoteBuilder.items
    .filter((it) => it.name.trim() && Number(it.quantity) > 0)
    .map((it) => ({ ...it, name: it.name.trim() }));
  if (!items.length) return toast('Agrega al menos un item con cantidad.', 'error');

  const lead = getLead(leadId);
  const client = { company: lead.company, contact: lead.contact, email: lead.email, phone: lead.phone };
  const baseId = $('quoteBaseId').value;

  const saved = await saveQuote({
    baseId,
    leadId,
    status: $('quoteStatusField').value,
    notes: $('quoteNotes').value.trim(),
    validUntil: $('quoteValidUntil').value,
    client,
    items
  });
  if (!saved) return;

  $('quoteDialog').close();
  toast(baseId ? 'Nueva versión guardada.' : 'Cotización creada.');
}

function openQuoteView(id) {
  const q = getQuote(id);
  if (!q) return;
  const lead = getLead(q.leadId);
  $('quoteViewTitle').textContent = `${lead?.company || 'Empresa eliminada'} · versión ${q.version}`;
  $('quoteViewSubtitle').textContent = `${q.owner || 'Sin responsable'} · actualizada ${fmtDateTime(q.updatedAt)}`;
  const versions = versionsOf(q.rootId);
  $('quoteViewBody').innerHTML = `
    <div class="detail-row"><span>Estado</span><strong>${escapeHtml(QUOTE_STATUSES.find((s) => s.id === q.status)?.label || q.status)}</strong></div>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Item</th><th>Cant.</th><th>Unidad</th><th>Precio unit.</th><th>Subtotal</th></tr></thead>
      <tbody>${q.items
        .map(
          (it) =>
            `<tr><td>${escapeHtml(it.name)}</td><td>${it.quantity}</td><td>${escapeHtml(it.unit)}</td><td>${fmtMoney(it.unitPrice)}</td><td>${fmtMoney(it.subtotal ?? it.quantity * it.unitPrice)}</td></tr>`
        )
        .join('')}</tbody>
    </table></div>
    <div class="quote-totals">
      <div><span>Subtotal neto</span><strong>${fmtMoney(q.subtotalNeto)}</strong></div>
      <div><span>IVA (19%)</span><strong>${fmtMoney(q.iva)}</strong></div>
      <div class="quote-total-final"><span>Total</span><strong>${fmtMoney(q.total)}</strong></div>
    </div>
    ${q.notes ? `<p class="detail-notes">${escapeHtml(q.notes)}</p>` : ''}
    ${
      versions.length > 1
        ? `<h4 class="settings-subtitle">Versiones</h4><div class="list">${versions
            .map(
              (v) =>
                `<div class="list-item"><div>Versión ${v.version} ${v.isCurrent ? '<span class="badge success">Vigente</span>' : ''}</div><div class="list-side"><span class="muted">${fmtDateTime(v.updatedAt)}</span> <button class="small-btn" data-action="view-quote" data-id="${v.id}">Ver</button></div></div>`
            )
            .join('')}</div>`
        : ''
    }`;
  $('quoteViewEditBtn').dataset.id = q.id;
  $('quoteViewSendBtn').dataset.id = q.id;
  $('quoteViewDialog').showModal();
}

function openQuoteSend(id) {
  const q = getQuote(id);
  if (!q) return;
  const lead = getLead(q.leadId);
  if (!lead?.email) return toast('Esa empresa no tiene un correo de contacto. Agrégalo en su ficha.', 'error');
  const { subject, body } = buildQuoteEmail(q, lead);
  $('quoteSendId').value = id;
  $('quoteSendSubtitle').textContent = `Para ${lead.contact || lead.company} · ${lead.email}`;
  $('quoteSendSubject').value = subject;
  $('quoteSendBody').value = body;
  $('quoteSendDialog').showModal();
}

function submitQuoteSend(e) {
  e.preventDefault();
  const id = $('quoteSendId').value;
  const q = getQuote(id);
  const lead = getLead(q?.leadId);
  if (!q || !lead) return;
  addActivity({
    leadId: lead.id,
    type: 'Correo',
    date: localDateTimeInput(),
    owner: lead.owner || session.profile?.name || '',
    detail: `Correo preparado con cotización v${q.version} para ${lead.contact || lead.email}.`
  });
  openExternal(`mailto:${encodeURIComponent(lead.email)}?subject=${encodeURIComponent($('quoteSendSubject').value)}&body=${encodeURIComponent($('quoteSendBody').value)}`);
  $('quoteSendDialog').close();
  if ($('quoteViewDialog').open) $('quoteViewDialog').close();
  toast('Correo abierto.');
}

/* ---------- Servicios (catálogo) ---------- */

function openService(id = '') {
  const s = id ? getService(id) : null;
  $('serviceDialogTitle').textContent = s ? 'Editar servicio' : 'Nuevo servicio';
  $('serviceId').value = id;
  $('serviceName').value = s?.name || '';
  $('serviceUnit').value = s?.unit || 'unidad';
  $('serviceNetPrice').value = s?.netPrice ?? 0;
  $('serviceCategory').value = s?.category || '';
  $('serviceActive').checked = s ? s.active : true;
  $('serviceDescription').value = s?.description || '';
  $('serviceDialog').showModal();
}

async function submitService(e) {
  e.preventDefault();
  const name = $('serviceName').value.trim();
  if (!name) return toast('El nombre es obligatorio.', 'error');
  const saved = await upsertService({
    id: $('serviceId').value || undefined,
    name,
    unit: $('serviceUnit').value.trim() || 'unidad',
    netPrice: Number($('serviceNetPrice').value || 0),
    category: $('serviceCategory').value.trim(),
    active: $('serviceActive').checked,
    description: $('serviceDescription').value.trim()
  });
  if (!saved) return;
  $('serviceDialog').close();
  toast('Servicio guardado.');
}

/* ---------- Acceso ---------- */

let authMode = 'signin';

function renderAuthMode() {
  // Con el registro cerrado, las cuentas las crea un administrador: se esconde la
  // opción de crear cuenta en vez de dejar un botón que terminaría en error.
  const signup = CFG.allowSignup !== false && authMode === 'signup';
  $('authToggleMode').hidden = CFG.allowSignup === false;
  $('authTitle').textContent = signup ? 'Crear cuenta' : 'Iniciar sesión';
  $('authSubtitle').textContent = signup ? 'Regístrate con tu correo de TaskFlow.' : 'Entra con tu correo y contraseña.';
  $('authNameField').hidden = !signup;
  $('authSubmitBtn').textContent = signup ? 'Crear cuenta' : 'Entrar';
  $('authToggleMode').textContent = signup ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Crear una';
  $('authError').hidden = true;
}

async function submitAuth(e) {
  e.preventDefault();
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  $('authError').hidden = true;
  $('authSubmitBtn').disabled = true;
  try {
    if (authMode === 'signup') {
      await signUp(email, password, $('authName').value.trim());
      toast('Cuenta creada. Ya puedes usar el CRM.');
    } else {
      await signIn(email, password);
    }
  } catch (err) {
    $('authError').textContent = err.message || 'No se pudo completar la operación.';
    $('authError').hidden = false;
  } finally {
    $('authSubmitBtn').disabled = false;
  }
}

async function forgotPassword() {
  const email = $('authEmail').value.trim();
  if (!email) return toast('Escribe tu correo primero.', 'error');
  try {
    await resetPassword(email);
    toast('Te enviamos un correo para restablecer tu contraseña.');
  } catch (err) {
    toast(err.message || 'No se pudo enviar el correo.', 'error');
  }
}

/* ---------- Acciones delegadas ---------- */

const ACTIONS = {
  'new-lead': () => openLead(),
  'edit-lead': (id) => openLead(id),
  'open-detail': (id) => openDetail(id),
  'open-discovery': (id) => openDiscovery(id),
  'new-activity': (id) => openActivity(id),
  'edit-activity': (id) => {
    const act = getActivity(id);
    if (act?.task || act?.system) return toast('Los movimientos del historial no se pueden editar.', 'error');
    editActivity(id);
  },
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
  'tasks-tab': (id, btn) => {
    ui.taskTab = btn.dataset.tab;
    render();
  },
  'complete-task': (id) => openComplete(id),
  'complete-task-inline': (id) => {
    const result = $('fichaResult').value.trim();
    if (!result) return toast('Cuenta cómo resultó la tarea.', 'error');
    const nextType = taskTypeValue('ficha');
    const nextAction = $('fichaNextAction').value.trim();
    const nextDate = $('fichaNextDate').value;
    if ((nextType || nextAction) && !nextDate) return toast('Elige la fecha de la siguiente tarea.', 'error');
    const task = taskOf(getLead(id));
    completeTaskAtomic(id, {
      type: task?.type || 'Actividad',
      date: localDateTimeInput(),
      result,
      nextType,
      nextAction,
      nextDate
    });
    toast(nextType || nextAction ? 'Tarea cerrada y siguiente agendada.' : 'Tarea cerrada. El prospecto quedó sin próximo paso.');
  },
  'reschedule-task': (id) => openTask(id),
  'set-task-type': (id, btn) => {
    const prefix = btn.dataset.taskType;
    setTaskType(prefix, taskTypeValue(prefix) === btn.dataset.value ? '' : btn.dataset.value);
  },
  'pipeline-sort': (id, btn) => {
    const key = btn.dataset.key;
    ui.pipelineSort = { key, dir: ui.pipelineSort.key === key && ui.pipelineSort.dir === 'asc' ? 'desc' : 'asc' };
    render();
  },
  'open-manage': () => openManage(),
  'qualify-lead': async (id) => {
    const lead = getLead(id);
    if (!lead) return;
    if (await setStage(id, 'Contactado')) toast(`${lead.company} calificado → Contactado.`);
  },
  'add-contact': (id) => openContact(id),
  'edit-contact': (id, btn) => openContact(id, btn.dataset.contact),
  'delete-contact': async (id, btn) => {
    if (confirm('¿Eliminar este contacto?') && await deleteContact(id, btn.dataset.contact)) toast('Contacto eliminado.');
  },
  'call-contact': (id, btn) => {
    const lead = getLead(id);
    const contact = findContact(lead, btn.dataset.contact);
    if (!contact?.phone) return toast('Ese contacto no tiene teléfono.', 'error');
    openExternal(`tel:${contact.phone.replace(/[^\d+]/g, '')}`);
  },
  'open-whatsapp': (id, btn) => openComm(id, btn.dataset.contact, 'whatsapp'),
  'open-email': (id, btn) => openComm(id, btn.dataset.contact, 'email'),
  'remarketing-email': (id, btn) => openComm(id, 'primary', 'email', btn.dataset.template),
  'delete-activity': async (id) => {
    const act = getActivity(id);
    if (act?.task || act?.system) return toast('Los movimientos del historial no se pueden eliminar.', 'error');
    if (confirm('¿Eliminar esta actividad?')) {
      if (await deleteActivity(id)) toast('Actividad eliminada.');
    }
  },
  'delete-lead': async (id) => {
    const lead = getLead(id);
    if (!lead) return;
    if (confirm(`¿Eliminar "${lead.company}" con su levantamiento, actividades y cotizaciones?`)) {
      if (!(await deleteLead(id))) return;
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
  'save-template': async (id) => {
    const draft = templateDraft(id);
    if (!draft) return;
    if (!draft.name.trim()) return toast('El nombre de la plantilla es obligatorio.', 'error');
    const saved = await saveTemplate(id, {
      name: draft.name.trim(),
      channel: draft.channel || 'both',
      subject: draft.subject.trim(),
      body: draft.body
    });
    if (saved) toast('Plantilla guardada.');
  },
  'delete-template': async (id) => {
    if (!confirm('¿Eliminar esta plantilla?')) return;
    if (state.templates.length <= 1) return toast('Debe quedar al menos una plantilla.', 'error');
    if (await deleteTemplate(id)) toast('Plantilla eliminada.');
  },
  'insert-var': (id, btn) => insertVariable(id, btn.dataset.var),
  'back-to-pipeline': async (id) => {
    const lead = getLead(id);
    if (!lead) return;
    if (await setStage(id, 'Contactado')) toast(`${lead.company} volvió al embudo comercial.`);
  },
  'save-profile': async () => {
    if (await saveProfile({ name: $('profileName').value.trim(), phone: $('profilePhone').value.trim() })) toast('Datos guardados.');
  },
  'change-password': async () => {
    const pass = $('newPassword').value;
    if (pass.length < 6) return toast('La contraseña debe tener al menos 6 caracteres.', 'error');
    const { supabase } = await import('./supabase.js');
    const { error } = await supabase.auth.updateUser({ password: pass });
    if (error) return toast(error.message, 'error');
    $('newPassword').value = '';
    toast('Contraseña actualizada.');
  },
  'sign-out': () => signOut(),
  'load-demo': () => seedExample(),
  'clear-demo': () => resetAll(),
  'copy-template': async (id) => {
    const draft = templateDraft(id);
    if (!draft) return;
    const subject = fillTemplate(draft.subject, ui.templateLead);
    const body = fillTemplate(draft.body, ui.templateLead);
    const text = draft.channel === 'whatsapp' || !subject ? body : `${subject}\n\n${body}`;
    const ok = await copyText(text);
    toast(ok ? 'Mensaje copiado con los datos resueltos.' : 'No se pudo copiar.', ok ? 'info' : 'error');
  },
  'quotes-view-list': () => {
    ui.quotesView = 'list';
    render();
  },
  'quotes-view-catalog': () => {
    ui.quotesView = 'catalog';
    render();
  },
  'new-quote': (id) => openQuoteBuilder(id || ''),
  'edit-quote': (id, btn) => {
    const quoteId = id || btn?.dataset.id;
    const q = getQuote(quoteId);
    if (!q) return;
    if ($('quoteViewDialog').open) $('quoteViewDialog').close();
    openQuoteBuilder(q.leadId, quoteId);
  },
  'view-quote': (id) => openQuoteView(id),
  'send-quote': (id, btn) => openQuoteSend(id || btn?.dataset.id),
  'delete-quote': async (id) => {
    if (!confirm('¿Eliminar esta versión de la cotización?')) return;
    if (await deleteQuote(id)) toast('Cotización eliminada.');
  },
  'add-quote-row': () => {
    ui.quoteBuilder.items.push(emptyQuoteRow());
    renderQuoteItemsRoot();
  },
  'remove-quote-row': (id, btn) => {
    const i = Number(btn.dataset.row);
    ui.quoteBuilder.items.splice(i, 1);
    if (!ui.quoteBuilder.items.length) ui.quoteBuilder.items.push(emptyQuoteRow());
    renderQuoteItemsRoot();
  },
  'new-service': () => openService(),
  'edit-service': (id) => openService(id),
  'delete-service': async (id) => {
    if (!confirm('¿Eliminar este servicio del catálogo?')) return;
    if (await deleteService(id)) toast('Servicio eliminado.');
  }
};

function handleClick(ev) {
  const btn = ev.target.closest?.('[data-action]');
  if (!btn) return;
  ACTIONS[btn.dataset.action]?.(btn.dataset.id, btn);
}

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

  if (el.dataset.userField) {
    if (ev.type !== 'change') return;
    updateUser(el.dataset.id, { [el.dataset.userField]: el.type === 'checkbox' ? el.checked : el.value });
    return;
  }

  const id = el.id;
  const value = el.type === 'checkbox' ? el.checked : el.value;
  const map = {
    chartA: () => (ui.chartA = value),
    chartB: () => (ui.chartB = value),
    leadQuery: () => (ui.leadFilters.query = value),
    leadOwner: () => (ui.leadFilters.owner = value),
    leadSort: () => (ui.leadFilters.sort = value),
    pipelineQuery: () => (ui.pipelineFilters.query = value),
    pipelineStage: () => (ui.pipelineFilters.stage = value),
    pipelineOwner: () => (ui.pipelineFilters.owner = value),
    templateLead: () => (ui.templateLead = value),
    templateChannel: () => (ui.templateChannel = value),
    quoteStatus: () => (ui.quoteFilters.status = value)
  };
  if (!map[id]) return;
  map[id]();
  render();
}

/** Cambios dentro del constructor de cotización: no vive en #viewRoot, así que se escucha aparte. */
function handleQuoteFieldChange(ev) {
  const el = ev.target;
  if (!el.dataset.quoteField) return;
  const row = Number(el.dataset.row);
  const item = ui.quoteBuilder.items[row];
  if (!item) return;
  const field = el.dataset.quoteField;
  if (field === 'serviceId') {
    const svc = getService(el.value);
    if (svc) Object.assign(item, { serviceId: svc.id, name: svc.name, unit: svc.unit, unitPrice: svc.netPrice });
    else item.serviceId = '';
    renderQuoteItemsRoot();
    return;
  }
  item[field] = field === 'quantity' || field === 'unitPrice' ? Number(el.value || 0) : el.value;
  // Solo repinta el total de la fila y no todo el bloque, para no perder el foco mientras se escribe.
  const totalCell = document.querySelector(`#quoteItemsRoot tr[data-row="${row}"] .quote-row-total`);
  if (totalCell) totalCell.textContent = fmtMoney(Number(item.quantity || 0) * Number(item.unitPrice || 0));
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
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
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
      if (!confirm(`Se crearán ${imported.leads.length} lead(s) a partir del archivo. ¿Continuar?`)) return;
      const result = await replaceState(imported);
      const importedCount = result.leads + result.discoveries + result.activities;
      if (result.failed) {
        toast(`Importación parcial: ${importedCount} registro(s) confirmados y ${result.failed} rechazado(s).`, 'error');
      } else {
        toast(`Importación completada: ${result.leads} lead(s), ${result.discoveries} levantamiento(s) y ${result.activities} actividad(es).`);
      }
    } catch (err) {
      toast(`No se pudo importar: ${err.message}`, 'error');
    } finally {
      ev.target.value = '';
    }
  };
  reader.readAsText(file);
}

function resetAll() {
  if (!confirm('Se borrarán todas las oportunidades que puedes ver (según tu permiso). Esta acción no se puede deshacer. ¿Continuar?')) return;
  const total = state.leads.length;
  deleteAllVisibleLeads();
  toast(`Eliminando ${total} oportunidad(es)…`);
}

function seedExample() {
  if (state.leads.length && !confirm('Ya existen datos. ¿Agregar ejemplos igualmente?')) return;
  const ownerName = session.profile?.name || '';
  const base = [
    { company: 'Refrigeración Austral', industry: 'HVAC / Climatización', contact: 'Marcela Fuentes', role: 'Administradora', email: 'marcela@ejemplo.cl', phone: '+56 9 5555 1010', stage: 'Lead', priority: 'Media', value: 420000, probability: 5, nextAction: 'Primer contacto telefónico', source: 'Web' },
    { company: 'Montajes del Maipo', industry: 'Construcción / Instalaciones', contact: 'Javier Núñez', role: 'Jefe de Obra', email: 'javier@ejemplo.cl', phone: '+56 9 5555 1011', stage: 'Lead', priority: 'Baja', value: 350000, probability: 5, nextAction: 'Validar tamaño de cuadrilla', source: 'Google Ads' },
    { company: 'PowerGen Chile', industry: 'Grupos electrógenos', contact: 'Carolina Díaz', role: 'Jefa de Servicio Técnico', email: 'carolina@ejemplo.cl', phone: '+56 9 5555 1003', stage: 'Contactado', priority: 'Media', value: 690000, probability: 15, nextAction: 'Coordinar reunión de descubrimiento', source: 'LinkedIn' },
    { company: 'ClimaSur Servicios', industry: 'HVAC / Climatización', contact: 'Paula Rojas', role: 'Jefa de Mantenimiento', email: 'paula@ejemplo.cl', phone: '+56 9 5555 1001', stage: 'Reunión / Demo', priority: 'Alta', value: 890000, probability: 35, nextAction: 'Demo enfocada en preventivos e inventario', source: 'Prospección en frío' },
    { company: 'VerticalTech', industry: 'Ascensores / Transporte vertical', contact: 'Andrés Silva', role: 'Gerente de Operaciones', email: 'andres@ejemplo.cl', phone: '+56 9 5555 1002', stage: 'Propuesta', priority: 'Alta', value: 1250000, probability: 55, nextAction: 'Seguimiento propuesta y alcance de certificación', source: 'Referido' },
    { company: 'Hidráulica Centro', industry: 'Arriendo de maquinaria', contact: 'Ignacio Bravo', role: 'Gerente Comercial', email: 'ignacio@ejemplo.cl', phone: '+56 9 5555 1012', stage: 'Negociación', priority: 'Alta', value: 1680000, probability: 75, nextAction: 'Cerrar condiciones de licencia anual', source: 'Referido' },
    { company: 'Ascensores del Sur', industry: 'Ascensores / Transporte vertical', contact: 'Daniela Vera', role: 'Gerente de Operaciones', email: 'daniela@ejemplo.cl', phone: '+56 9 5555 1013', stage: 'Remarketing', priority: 'Media', value: 780000, probability: 10, remarketingReason: 'Revisar el próximo año', nextAction: 'Retomar en enero', source: 'Evento / Feria' },
    { company: 'Servicios Bío Bío', industry: 'Facility Management', contact: 'Cristián Soto', role: 'Jefe de Contratos', email: 'cristian@ejemplo.cl', phone: '+56 9 5555 1014', stage: 'Remarketing', priority: 'Baja', value: 460000, probability: 10, remarketingReason: 'Sin presupuesto por ahora', nextAction: 'Reconsultar tras cierre de presupuesto', source: 'Base de datos' },
    { company: 'TecnoFrío Ltda.', industry: 'HVAC / Climatización', contact: 'Loreto Cáceres', role: 'Gerente de Servicio', email: 'loreto@ejemplo.cl', phone: '+56 9 5555 1015', stage: 'Ganado', priority: 'Alta', value: 1420000, probability: 100, nextAction: 'Coordinar kick-off e implementación', source: 'Referido' },
    { company: 'Electro Andina', industry: 'Grupos electrógenos', contact: 'Felipe Ortiz', role: 'Subgerente Técnico', email: 'felipe@ejemplo.cl', phone: '+56 9 5555 1016', stage: 'Ganado', priority: 'Media', value: 980000, probability: 100, nextAction: 'Capacitar a técnicos en terreno', source: 'Cliente existente' },
    { company: 'Andes Facility', industry: 'Facility Management', contact: 'Rodrigo Pérez', role: 'Subgerente', email: 'rodrigo@ejemplo.cl', phone: '+56 9 5555 1004', stage: 'Perdido', priority: 'Baja', value: 540000, probability: 0, lossReason: 'Eligió a un competidor', nextAction: '', source: 'Web' }
  ];

  const created = {};
  base.forEach((x) => {
    const lead = upsertLead({ rut: '', notes: '', owner: ownerName, nextDate: todayISO(), expectedCloseDate: '', ...x });
    created[x.company] = lead;
  });

  saveDiscovery(created['ClimaSur Servicios'].id, {
    pain: 'Preventivos vencidos, historial incompleto y poca visibilidad de repuestos.',
    currentManagement: 'Excel / formularios',
    technicians: '18',
    locations: '3',
    buyTrigger: 'Crecimiento de cuadrillas',
    modules: ['Órdenes de trabajo', 'Técnicos en terreno', 'Inventario / Bodegas', 'Trazabilidad / Reportes'],
    integrations: 'Power BI',
    successCriteria: 'Controlar cumplimiento preventivo y trazabilidad por equipo.',
    technicalNotes: ''
  });
  saveDiscovery(created['TecnoFrío Ltda.'].id, {
    pain: 'Sin trazabilidad de las visitas ni respaldo fotográfico ante reclamos.',
    currentManagement: 'WhatsApp / papel',
    technicians: '26',
    locations: '5',
    buyTrigger: 'Auditoría o certificación',
    modules: ['Órdenes de trabajo', 'Checklists / Formularios', 'Fotografías / Firmas', 'Geolocalización'],
    integrations: 'ERP propio',
    successCriteria: 'Evidencia firmada por visita y reportes mensuales automáticos.',
    technicalNotes: ''
  });

  const set = (name, type, action, date) => updateLead(created[name].id, { nextType: type, nextAction: action, nextDate: date });
  set('ClimaSur Servicios', 'Correo', 'Enviar agenda de demo con casos de preventivos', addDaysISO(todayISO(), -3));
  set('VerticalTech', 'Llamada', 'Revisar observaciones de la propuesta', addDaysISO(todayISO(), -1));
  set('Hidráulica Centro', 'Llamada', 'Confirmar condiciones comerciales', todayISO());
  set('PowerGen Chile', 'WhatsApp', 'Coordinar reunión de descubrimiento', addDaysISO(todayISO(), 1));
  set('Refrigeración Austral', 'Llamada', 'Primer contacto', addDaysISO(todayISO(), 4));
  set('Montajes del Maipo', 'Correo', 'Validar tamaño de cuadrilla', addDaysISO(todayISO(), 9));

  addActivity({
    leadId: created['ClimaSur Servicios'].id,
    type: 'Reunión',
    date: localDateTimeInput(new Date(Date.now() - 4 * 86400000)),
    owner: ownerName,
    detail: 'Levantamiento inicial con jefatura de mantenimiento.'
  });
  addActivity({
    leadId: created['TecnoFrío Ltda.'].id,
    type: 'Demo',
    date: localDateTimeInput(new Date(Date.now() - 2 * 86400000)),
    owner: ownerName,
    detail: 'Mostraron interés en checklists y firma digital. Aprueban avanzar.',
    task: 'Presentar demo de checklists al equipo técnico'
  });

  toast('Datos demo cargados en leads, embudo, remarketing e implementación.');
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
  $('syncHint').textContent = `Datos en Supabase. Última actualización: ${meta.lastSyncAt ? fmtDateTime(meta.lastSyncAt) : 'nunca'}.`;
  $('dataDialog').showModal();
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

  $('dataBtn').addEventListener('click', openDataDialog);
  $('syncStatus').addEventListener('click', openDataDialog);

  $('themeToggle').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.documentElement.dataset.theme = dark ? '' : 'dark';
    localStorage.setItem('taskflow-crm-theme', dark ? 'light' : 'dark');
  });
  if (localStorage.getItem('taskflow-crm-theme') === 'dark') document.documentElement.dataset.theme = 'dark';

  $$('[data-close-dialog]').forEach((b) => b.addEventListener('click', () => $(b.dataset.closeDialog).close()));
  // Cerrar al pinchar fuera, salvo en los diálogos que marcan lo contrario: ahí un
  // clic perdido significaba botar un formulario largo ya llenado.
  $$('dialog.modal').forEach((dlg) => dlg.addEventListener('click', (ev) => {
    if (dlg.dataset.keepOpen === 'true') return;
    if (ev.target === dlg) dlg.close();
  }));

  $('leadForm').addEventListener('submit', submitLead);
  $('stage').addEventListener('change', toggleLossField);
  $('discoveryForm').addEventListener('submit', submitDiscovery);
  $('activityForm').addEventListener('submit', submitActivity);
  $('activityLeadId').addEventListener('change', (ev) => {
    fillActivityContacts(ev.target.value);
    syncActivityTaskResolution(ev.target.value, Boolean($('activityId').value));
  });
  $('contactForm').addEventListener('submit', submitContact);
  $('commForm').addEventListener('submit', submitComm);
  $('commTemplate').addEventListener('change', fillCommFields);
  $('commCopyBtn').addEventListener('click', copyComm);
  $('completeForm').addEventListener('submit', submitComplete);
  $('taskForm').addEventListener('submit', submitTask);
  $('manageForm').addEventListener('submit', submitManage);
  $('managePrevBtn').addEventListener('click', () => manageStep(-1));
  $('manageNextBtn').addEventListener('click', () => manageStep(1));
  $('manageRescheduleBtn').addEventListener('click', () => {
    const task = currentTask();
    if (task) openTask(task.lead.id);
  });
  $('stageForm').addEventListener('submit', submitStage);
  $('stageOptions').addEventListener('change', updateStageFields);
  $('exportBtn').addEventListener('click', exportJson);
  $('exportCsvBtn').addEventListener('click', exportCsv);
  $('importInput').addEventListener('change', importJson);
  $('resetBtn').addEventListener('click', resetAll);

  $('serviceForm').addEventListener('submit', submitService);
  $('quoteForm').addEventListener('submit', submitQuoteBuilder);
  $('quoteItemsRoot').parentElement; // noop, root exists once quoteForm renders
  $('quoteForm').addEventListener('input', handleQuoteFieldChange);
  $('quoteForm').addEventListener('change', handleQuoteFieldChange);
  $('quoteSendForm').addEventListener('submit', submitQuoteSend);

  $('authForm').addEventListener('submit', submitAuth);
  $('authToggleMode').addEventListener('click', () => {
    authMode = authMode === 'signup' ? 'signin' : 'signup';
    renderAuthMode();
  });
  $('authForgot').addEventListener('click', forgotPassword);

  document.addEventListener('click', handleClick);
  document.addEventListener('keydown', handleKeydown);
  $('viewRoot').addEventListener('input', handleViewInput);
  $('viewRoot').addEventListener('change', handleViewInput);
  $('viewRoot').addEventListener('focusin', (ev) => {
    if (ev.target.matches('[data-template-body], [data-template-subject]')) lastTemplateField = ev.target;
  });
}

async function start() {
  document.title = `${CFG.appName} · ${CFG.companyName}`;
  fillStaticSelects();
  buildTaskTypeGroups();
  initHyperFocusUI();
  bindEvents();
  renderAuthMode();

  onChange(() => {
    render();
    refreshDetailIfOpen();
  });
  onQuotesChange(() => {
    if (ui.view === 'quotes') render();
    refreshDetailIfOpen();
  });
  onHyperFocusChange(() => {
    if (ui.view === 'hyperfocus') render();
  });

  onAuthChange(async (s) => {
    if (s.status === 'signed-in') {
      $('authScreen').hidden = true;
      $('appShell').hidden = false;
      paintSync({ state: 'syncing', message: 'Cargando datos…' });
      try {
        await Promise.all([hydrate(), quotesHydrate(), hyperFocusHydrate()]);
        startRealtime();
        quotesStartRealtime();
        hyperFocusStartRealtime();
        paintSync({ state: 'ok', message: 'Conectado' });
      } catch (err) {
        paintSync({ state: 'error', message: `Sin conexión: ${err.message}` });
      }
      render();
    } else if (s.status === 'signed-out') {
      stopRealtime();
      quotesStopRealtime();
      hyperFocusStopRealtime();
      clearLocal();
      quotesClearLocal();
      hyperFocusClearLocal();
      $('appShell').hidden = true;
      $('authScreen').hidden = false;
      authMode = 'signin';
      renderAuthMode();
    }
  });

  const { initAuth } = await import('./auth.js');
  await initAuth();
}

start();
