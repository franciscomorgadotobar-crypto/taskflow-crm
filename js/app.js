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
  STAGES,
  TASK_TYPES
} from './catalog.js';
import {
  addActivity,
  addContact,
  addTemplate,
  addUser,
  deleteUser,
  saveProfile,
  updateUser,
  contactsOf,
  deleteActivity,
  deleteContact,
  updateContact,
  deleteLead,
  completeTask,
  deleteTemplate,
  emptyData,
  findContact,
  taskOf,
  updateActivity,
  findDuplicate,
  getActivity,
  getDiscovery,
  getLead,
  metrics,
  openTasks,
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
  renderSettings,
  renderTemplates,
  templatePreviewHtml
} from './views.js';
import { $, $$, addDaysISO, copyText, escapeHtml, fmtDate, fmtDateTime, localDateTimeInput, nowISO, todayISO, toast, uid } from './utils.js';

const CFG = window.TASKFLOW_CRM_CONFIG;

const ui = {
  view: 'dashboard',
  taskTab: 'overdue',
  leadFilters: { query: '', owner: '', sort: 'updated' },
  pipelineView: 'kanban',
  pipelineFilters: { query: '', stage: '', owner: '' },
  pipelineSort: { key: 'company', dir: 'asc' },
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
  templates: ['Plantillas', 'Mensajes comerciales con variables por empresa.', renderTemplates],
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
}

/**
 * Responsables disponibles: yo y los usuarios activos configurados. Si el lead
 * ya tenía un responsable que ya no está activo, se conserva para no perderlo.
 */
function fillOwnerSelect(selected = '') {
  const { profile, users } = state.settings;
  const names = [profile.name, ...users.filter((u) => u.active && u.name).map((u) => u.name)].filter(Boolean);
  const unique = [...new Set(names)];
  if (selected && !unique.includes(selected)) unique.push(selected);
  $('owner').innerHTML =
    `<option value="">Sin asignar</option>` +
    unique.map((n) => `<option ${n === selected ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('');
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

/** Al editar, la etapa y la tarea se cambian con sus propios botones en la ficha, no acá. */
const OWNED_ELSEWHERE = ['stage', 'lossReason', 'nextAction', 'nextDate', 'nextType'];

function openLead(id) {
  const l = getLead(id) || {};
  const editing = Boolean(id);
  $('leadDialogTitle').textContent = editing ? 'Editar datos de la empresa' : 'Nuevo lead';
  $('leadId').value = l.id || '';
  fillOwnerSelect(l.owner || '');
  LEAD_FIELDS.forEach((k) => {
    const el = $(k);
    if (!el) return;
    const fallback = k === 'stage' ? 'Lead' : k === 'priority' ? 'Media' : k === 'probability' ? DEFAULT_PROBABILITY.Lead : '';
    el.value = l[k] ?? fallback;
  });
  toggleLossField();
  setTaskType('lead', l.nextType || '');
  // En edición se ocultan los campos que ya tienen su propio flujo en la ficha.
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
  if (dup && !confirm(`Ya existe “${dup.company}”. ¿Guardar de todos modos?`)) return;

  const payload = { id: id || undefined };
  const fields = id ? LEAD_FIELDS.filter((k) => !OWNED_ELSEWHERE.includes(k)) : LEAD_FIELDS;
  fields.forEach((k) => (payload[k] = $(k).value.trim ? $(k).value.trim() : $(k).value));
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
  $('activityId').value = '';
  $('activityDialogTitle').textContent = 'Nueva actividad';
  $('activitySubmitBtn').textContent = 'Guardar actividad';
  $('activityLeadId').innerHTML = leadOptions(leadId);
  fillActivityContacts(leadId);
  $('activityType').value = ACTIVITY_TYPES[0];
  $('activityDate').value = localDateTimeInput();
  $('activityOwner').value = getLead(leadId)?.owner || '';
  $('activityDetail').value = '';
  $('activityDialog').showModal();
}

/** Reabre una actividad existente para corregir fecha, detalle o compromiso. */
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

  if (id) updateActivity(id, payload);
  else addActivity(payload);

  $('activityDialog').close();
  toast(id ? 'Actividad actualizada.' : 'Actividad registrada.');
}

/* ---------- Diálogo: contacto ---------- */

/** Sin `key` crea uno nuevo; con `key` edita el existente (incluido el principal). */
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

function submitContact(e) {
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
  if (key) updateContact(leadId, key, payload);
  else addContact(leadId, payload);

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
    addActivity({ leadId, contactId: contactKey, type: 'WhatsApp', date: localDateTimeInput(), owner: lead.owner || '', detail: `Plantilla “${templateName}” enviada por WhatsApp a ${contact.name || contact.phone}.` });
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(body)}`, '_blank', 'noopener');
  } else {
    if (!contact?.email) return toast('Ese contacto no tiene email.', 'error');
    addActivity({ leadId, contactId: contactKey, type: 'Correo', date: localDateTimeInput(), owner: lead.owner || '', detail: `Plantilla “${templateName}” enviada por correo a ${contact.name || contact.email}.` });
    window.location.href = `mailto:${encodeURIComponent(contact.email)}?subject=${encodeURIComponent($('commSubject').value)}&body=${encodeURIComponent(body)}`;
  }
  $('commDialog').close();
  toast(channel === 'whatsapp' ? 'WhatsApp abierto.' : 'Correo abierto.');
}

/* ---------- Gestionar pendientes, una por una ---------- */

let manageQueue = [];
let manageIndex = 0;

/** Cola de tareas de la pestaña activa del Resumen, en el mismo orden que se ven. */
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
  // La siguiente tarea nace en blanco: se define después de saber cómo resultó esta.
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

/** Gestionar una tarea es cerrarla: qué resultó y cuál es la siguiente. */
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

  // Cerrada, sale de la cola aunque su reemplazo sea otra tarea del mismo prospecto.
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
  $('completeType').value = task.type || ACTIVITY_TYPES[0];
  $('completeDate').value = localDateTimeInput();
  $('completeResult').value = '';
  $('completeNextAction').value = '';
  $('completeNextDate').value = '';
  setTaskType('complete', '');
  $('completeDialog').showModal();
  setTimeout(() => $('completeResult').focus(), 50);
}

function submitComplete(e) {
  e.preventDefault();
  const leadId = $('completeLeadId').value;
  const result = $('completeResult').value.trim();
  if (!result) return toast('Cuenta cómo resultó la tarea.', 'error');

  const nextType = taskTypeValue('complete');
  const nextAction = $('completeNextAction').value.trim();
  completeTask(leadId, {
    type: $('completeType').value,
    date: $('completeDate').value || localDateTimeInput(),
    result,
    nextType,
    nextAction,
    nextDate: $('completeNextDate').value
  });

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

function submitTask(e) {
  e.preventDefault();
  const nextType = taskTypeValue('task');
  const note = $('taskAction').value.trim();
  if (!nextType && !note) return toast('Elige el tipo de tarea o escribe una nota.', 'error');
  updateLead($('taskLeadId').value, { nextType, nextAction: note, nextDate: $('taskDate').value });
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
      if (target === 'Perdido') return openStage(lead.id); // exige motivo
      setStage(lead.id, target);
      toast(`${lead.company} → ${target}`);
    });
  });
}

/* ---------- Tipo de tarea (botones en vez de texto libre) ---------- */

/** Pinta los botones de tipo dentro de cada grupo declarado en el HTML. */
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

/** Marca el tipo elegido y lo deja en el input oculto del grupo. */
function setTaskType(prefix, value) {
  const input = $(prefix === 'lead' ? 'nextType' : `${prefix}NextType`);
  if (input) input.value = value;
  $$(`[data-task-type="${prefix}"]`).forEach((btn) => btn.classList.toggle('active-view', btn.dataset.value === value));
}

const taskTypeValue = (prefix) => $(prefix === 'lead' ? 'nextType' : `${prefix}NextType`)?.value || '';

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
  // Misma gestión que el diálogo, pero resuelta dentro de la propia ficha.
  'complete-task-inline': (id) => {
    const result = $('fichaResult').value.trim();
    if (!result) return toast('Cuenta cómo resultó la tarea.', 'error');
    const nextType = taskTypeValue('ficha');
    const nextAction = $('fichaNextAction').value.trim();
    completeTask(id, {
      type: $('fichaType').value,
      date: $('fichaDate').value || localDateTimeInput(),
      result,
      nextType,
      nextAction,
      nextDate: $('fichaNextDate').value
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
  'qualify-lead': (id) => {
    const lead = getLead(id);
    if (!lead) return;
    setStage(id, 'Contactado');
    toast(`${lead.company} calificado → Contactado.`);
  },
  'add-contact': (id) => openContact(id),
  'edit-contact': (id, btn) => openContact(id, btn.dataset.contact),
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
    addActivity({ leadId: id, contactId: btn.dataset.contact, type: 'Llamada', date: localDateTimeInput(), owner: lead.owner || '', detail: `Llamada iniciada a ${contact.name || contact.phone}.` });
    window.location.href = `tel:${contact.phone.replace(/[^\d+]/g, '')}`;
  },
  'open-whatsapp': (id, btn) => openComm(id, btn.dataset.contact, 'whatsapp'),
  'open-email': (id, btn) => openComm(id, btn.dataset.contact, 'email'),
  'remarketing-email': (id, btn) => openComm(id, 'primary', 'email', btn.dataset.template),
  'delete-activity': (id) => {
    const act = getActivity(id);
    if (act?.task || act?.system) return toast('Los movimientos del historial no se pueden eliminar.', 'error');
    if (confirm('¿Eliminar esta actividad?')) {
      deleteActivity(id);
      toast('Actividad eliminada.');
    }
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
  'back-to-pipeline': (id) => {
    const lead = getLead(id);
    if (!lead) return;
    setStage(id, 'Contactado');
    toast(`${lead.company} volvió al embudo comercial.`);
  },
  'save-profile': () => {
    saveProfile({
      name: $('profileName').value.trim(),
      email: $('profileEmail').value.trim(),
      phone: $('profilePhone').value.trim(),
      password: $('profilePassword').value
    });
    toast('Datos guardados.');
  },
  'new-user': () => {
    addUser();
    toast('Usuario creado. Completa sus datos y su permiso.');
  },
  'delete-user': (id) => {
    if (!confirm('¿Eliminar este usuario?')) return;
    deleteUser(id);
    toast('Usuario eliminado.');
  },
  'toggle-password': (id, btn) => {
    const input = $(btn.dataset.target);
    if (!input) return;
    const shown = input.type === 'text';
    input.type = shown ? 'password' : 'text';
    btn.textContent = shown ? 'Ver' : 'Ocultar';
  },
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
};

function handleClick(ev) {
  const btn = ev.target.closest?.('[data-action]');
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

  // Los usuarios se guardan al salir del campo, no en cada tecla.
  if (el.dataset.userField) {
    if (ev.type !== 'change') return;
    updateUser(el.dataset.id, { [el.dataset.userField]: el.type === 'checkbox' ? el.checked : el.value });
    return;
  }

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
    // Leads por calificar
    { company: 'Refrigeración Austral', industry: 'HVAC / Climatización', contact: 'Marcela Fuentes', role: 'Administradora', email: 'marcela@ejemplo.cl', phone: '+56 9 5555 1010', stage: 'Lead', priority: 'Media', value: 420000, probability: 5, nextAction: 'Primer contacto telefónico', source: 'Web' },
    { company: 'Montajes del Maipo', industry: 'Construcción / Instalaciones', contact: 'Javier Núñez', role: 'Jefe de Obra', email: 'javier@ejemplo.cl', phone: '+56 9 5555 1011', stage: 'Lead', priority: 'Baja', value: 350000, probability: 5, nextAction: 'Validar tamaño de cuadrilla', source: 'Google Ads' },
    // Embudo comercial
    { company: 'PowerGen Chile', industry: 'Grupos electrógenos', contact: 'Carolina Díaz', role: 'Jefa de Servicio Técnico', email: 'carolina@ejemplo.cl', phone: '+56 9 5555 1003', stage: 'Contactado', priority: 'Media', value: 690000, probability: 15, nextAction: 'Coordinar reunión de descubrimiento', source: 'LinkedIn' },
    { company: 'ClimaSur Servicios', industry: 'HVAC / Climatización', contact: 'Paula Rojas', role: 'Jefa de Mantenimiento', email: 'paula@ejemplo.cl', phone: '+56 9 5555 1001', stage: 'Reunión / Demo', priority: 'Alta', value: 890000, probability: 35, nextAction: 'Demo enfocada en preventivos e inventario', source: 'Prospección en frío' },
    { company: 'VerticalTech', industry: 'Ascensores / Transporte vertical', contact: 'Andrés Silva', role: 'Gerente de Operaciones', email: 'andres@ejemplo.cl', phone: '+56 9 5555 1002', stage: 'Propuesta', priority: 'Alta', value: 1250000, probability: 55, nextAction: 'Seguimiento propuesta y alcance de certificación', source: 'Referido' },
    { company: 'Hidráulica Centro', industry: 'Arriendo de maquinaria', contact: 'Ignacio Bravo', role: 'Gerente Comercial', email: 'ignacio@ejemplo.cl', phone: '+56 9 5555 1012', stage: 'Negociación', priority: 'Alta', value: 1680000, probability: 75, nextAction: 'Cerrar condiciones de licencia anual', source: 'Referido' },
    // Remarketing
    { company: 'Ascensores del Sur', industry: 'Ascensores / Transporte vertical', contact: 'Daniela Vera', role: 'Gerente de Operaciones', email: 'daniela@ejemplo.cl', phone: '+56 9 5555 1013', stage: 'Remarketing', priority: 'Media', value: 780000, probability: 10, remarketingReason: 'Revisar el próximo año', nextAction: 'Retomar en enero', source: 'Evento / Feria' },
    { company: 'Servicios Bío Bío', industry: 'Facility Management', contact: 'Cristián Soto', role: 'Jefe de Contratos', email: 'cristian@ejemplo.cl', phone: '+56 9 5555 1014', stage: 'Remarketing', priority: 'Baja', value: 460000, probability: 10, remarketingReason: 'Sin presupuesto por ahora', nextAction: 'Reconsultar tras cierre de presupuesto', source: 'Base de datos' },
    // Implementación (ganados)
    { company: 'TecnoFrío Ltda.', industry: 'HVAC / Climatización', contact: 'Loreto Cáceres', role: 'Gerente de Servicio', email: 'loreto@ejemplo.cl', phone: '+56 9 5555 1015', stage: 'Ganado', priority: 'Alta', value: 1420000, probability: 100, nextAction: 'Coordinar kick-off e implementación', source: 'Referido' },
    { company: 'Electro Andina', industry: 'Grupos electrógenos', contact: 'Felipe Ortiz', role: 'Subgerente Técnico', email: 'felipe@ejemplo.cl', phone: '+56 9 5555 1016', stage: 'Ganado', priority: 'Media', value: 980000, probability: 100, nextAction: 'Capacitar a técnicos en terreno', source: 'Cliente existente' },
    // Perdido
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
  const byName = (name) => base.find((l) => l.company === name);

  state.discoveries[byName('ClimaSur Servicios').id] = {
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
  state.discoveries[byName('TecnoFrío Ltda.').id] = {
    pain: 'Sin trazabilidad de las visitas ni respaldo fotográfico ante reclamos.',
    currentManagement: 'WhatsApp / papel',
    technicians: '26',
    locations: '5',
    buyTrigger: 'Auditoría o certificación',
    modules: ['Órdenes de trabajo', 'Checklists / Formularios', 'Fotografías / Firmas', 'Geolocalización'],
    integrations: 'ERP propio',
    successCriteria: 'Evidencia firmada por visita y reportes mensuales automáticos.',
    technicalNotes: '',
    updatedAt: nowISO()
  };

  // Tareas repartidas: una vencida, una para hoy y una más adelante.
  const set = (name, action, date) => Object.assign(byName(name), { nextAction: action, nextDate: date });
  set('ClimaSur Servicios', 'Enviar agenda de demo con casos de preventivos', addDaysISO(todayISO(), -3));
  set('VerticalTech', 'Llamar para revisar observaciones de la propuesta', addDaysISO(todayISO(), -1));
  set('Hidráulica Centro', 'Confirmar condiciones comerciales', todayISO());
  set('PowerGen Chile', 'Coordinar reunión de descubrimiento', addDaysISO(todayISO(), 1));
  set('Refrigeración Austral', 'Primer contacto telefónico', addDaysISO(todayISO(), 4));
  set('Montajes del Maipo', 'Validar tamaño de cuadrilla', addDaysISO(todayISO(), 9));

  state.activities.push(
    {
      id: uid('act'),
      leadId: byName('ClimaSur Servicios').id,
      type: 'Reunión',
      date: localDateTimeInput(new Date(Date.now() - 4 * 86400000)),
      owner: 'Comercial TaskFlow',
      detail: 'Levantamiento inicial con jefatura de mantenimiento.',
      task: ''
    },
    {
      id: uid('act'),
      leadId: byName('TecnoFrío Ltda.').id,
      type: 'Demo',
      date: localDateTimeInput(new Date(Date.now() - 2 * 86400000)),
      owner: 'Comercial TaskFlow',
      detail: 'Mostraron interés en checklists y firma digital. Aprueban avanzar.',
      task: 'Presentar demo de checklists al equipo técnico'
    }
  );
  persist();
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
  buildTaskTypeGroups();
  bindEvents();

  onChange(() => {
    render();
    if ($('detailDialog').open && detailLeadId) {
      $('detailBody').innerHTML = renderLeadDetail(detailLeadId);
      buildTaskTypeGroups($('detailBody'));
    }
    api.queuePush();
  });
  api.onStatus(paintSync);

  render();
  if (api.isConfigured()) api.health();
  else paintSync(api.getStatus());
}

init();
