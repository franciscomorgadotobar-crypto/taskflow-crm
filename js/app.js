import {
  ACTIVITY_TYPES,
  BUY_TRIGGERS,
  CURRENT_MANAGEMENT,
  DEFAULT_PROBABILITY,
  INDUSTRIES,
  LOSS_REASONS,
  MODULES,
  PAYMENT_METHODS,
  PAYMENT_TERMS,
  QUOTE_STATUSES,
  REMARKETING_REASONS,
  SOURCES,
  STAGE_TEMPLATE,
  STAGES,
  TASK_TYPES
} from './catalog.js';
import {
  addActivityConfirmed,
  addContact,
  addTemplate,
  clearLocal,
  canEditLeadLocally,
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
  recordActivityWithFollowupAtomic,
  saveDiscovery,
  saveProfile,
  saveTemplate,
  setStage,
  startRealtime,
  state,
  stopRealtime,
  updateLead,
  updateUser,
  upsertLeadConfirmed
} from './store.js';
import {
  buildQuoteEmail,
  clearLocal as quotesClearLocal,
  deletePriceList,
  deletePriceListItem,
  deleteQuote,
  fetchUfValue,
  getPriceList,
  getPriceListItem,
  getQuote,
  hydrate as quotesHydrate,
  importPriceList,
  itemsOfPriceList,
  onChange as onQuotesChange,
  previewQuote,
  savePriceListItem,
  saveQuote,
  startRealtime as quotesStartRealtime,
  state as quoteState,
  stopRealtime as quotesStopRealtime,
  updatePriceList,
  versionsOf
} from './quotes.js';
import { isAdmin, isReadOnly, isSuper, onAuthChange, resetPassword, session, signIn, signOut, signUp } from './auth.js';
import { supabase } from './supabase.js';
import {
  clearLocal as hyperFocusClearLocal,
  hydrate as hyperFocusHydrate,
  initUI as initHyperFocusUI,
  onChange as onHyperFocusChange,
  parseUploadedFile,
  renderHyperFocus,
  startRealtime as hyperFocusStartRealtime,
  stopRealtime as hyperFocusStopRealtime
} from './hyperfocus.js';
import {
  fillTemplate,
  filterPipeline,
  quoteDiscountsHtml,
  quoteDocFromSaved,
  quoteDocHtml,
  quoteLinesHtml,
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
  fmtAmount,
  fmtCurrency,
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

let deferredPwaInstallPrompt = null;
let pwaInstalled =
  window.matchMedia?.('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

function isAppleMobile() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent || '');
}

async function installPwa() {
  if (pwaInstalled) {
    toast('TaskFlow CRM ya está abierto como aplicación.');
    return;
  }

  if (!deferredPwaInstallPrompt) {
    if (isAppleMobile()) {
      toast('En iPhone o iPad: Compartir → Añadir a pantalla de inicio.');
    } else {
      toast('La instalación aún no está disponible. Revisa el menú del navegador o vuelve a intentarlo en unos segundos.');
    }
    return;
  }

  const promptEvent = deferredPwaInstallPrompt;
  deferredPwaInstallPrompt = null;
  await promptEvent.prompt();
  const choice = await promptEvent.userChoice;

  if (choice?.outcome === 'accepted') {
    toast('Instalando TaskFlow CRM…');
  }
}

function initPwa() {
  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();
    deferredPwaInstallPrompt = ev;
    if (ui?.view === 'settings') render();
  });

  window.addEventListener('appinstalled', () => {
    pwaInstalled = true;
    deferredPwaInstallPrompt = null;
    if (ui?.view === 'settings') render();
    toast('TaskFlow CRM quedó instalado.');
  });

  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker
    .register('./service-worker.js', { scope: './' })
    .then((registration) => {
      registration.update().catch(() => {});
    })
    .catch((err) => {
      console.error('No se pudo registrar la PWA', err);
    });
}

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
  priceListId: '',
  auditFilters: { query: '', entity: '', action: '' },
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
  quotes: ['Cotizaciones', 'Listas de precios y cotizaciones para tus clientes.', renderQuotes],
  audit: ['Auditoría', 'Trazabilidad de cambios, responsables y registros modificados.', renderAudit],
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
  $('manageType').innerHTML = options(ACTIVITY_TYPES);
  $('moduleChecks').innerHTML = MODULES.map(
    (v) => `<label><input type="checkbox" value="${escapeHtml(v)}"> ${escapeHtml(v)}</label>`
  ).join('');
  $('quoteStatusField').innerHTML = QUOTE_STATUSES.map((s) => `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join('');
  const choose = '<option value="">— Seleccione —</option>';
  $('quotePaymentMethod').innerHTML = choose + PAYMENT_METHODS.map((m) => `<option value="${m.id}">${escapeHtml(m.label)}</option>`).join('');
  $('quotePaymentTerms').innerHTML = choose + PAYMENT_TERMS.map((t) => `<option value="${t.id}">${escapeHtml(t.label)}</option>`).join('');
}

function fillOwnerSelect(selectedName = '', selectedId = '') {
  const active = state.team.filter((u) => u.active && u.name);
  const duplicateNames = new Map();
  active.forEach((u) => duplicateNames.set(u.name, (duplicateNames.get(u.name) || 0) + 1));

  const options = active.map((u) => {
    const selected = selectedId ? u.id === selectedId : (!selectedId && u.name === selectedName);
    const label = duplicateNames.get(u.name) > 1 && u.email ? `${u.name} · ${u.email}` : u.name;
    return `<option value="${escapeHtml(u.name)}" data-owner-id="${u.id}" ${selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  });

  // Un responsable histórico inactivo sigue visible al editar su oportunidad,
  // pero no aparece como opción para nuevas asignaciones.
  if (selectedName && !active.some((u) => selectedId ? u.id === selectedId : u.name === selectedName)) {
    const historical = state.team.find((u) => selectedId ? u.id === selectedId : u.name === selectedName);
    options.push(`<option value="${escapeHtml(selectedName)}" data-owner-id="${historical?.id || selectedId || ''}" selected>${escapeHtml(selectedName)} · inactivo</option>`);
  }

  $('owner').innerHTML = `<option value="">Sin asignar</option>${options.join('')}`;
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
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  const l = getLead(id) || {};
  if (id && !canEditLeadLocally(l)) return toast('Solo puedes editar oportunidades asignadas a ti.', 'error');
  const editing = Boolean(id);
  $('leadDialogTitle').textContent = editing ? 'Editar datos de la empresa' : 'Nuevo lead';
  $('leadId').value = l.id || '';
  fillOwnerSelect(l.owner || session.profile?.name || '', l.ownerId || (!l.id ? session.user?.id || '' : ''));
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

async function submitLead(e) {
  e.preventDefault();
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
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
  const ownerOption = $('owner').selectedOptions?.[0];
  payload.ownerId = ownerOption?.dataset.ownerId || (payload.owner === session.profile?.name ? session.user?.id || '' : '');
  try {
    const saved = await upsertLeadConfirmed(payload);
    if (!saved) return;
    $('leadDialog').close();
    toast(id ? 'Datos actualizados.' : 'Lead creado.');
  } catch {
    // upsertLeadConfirmed ya restaura el estado local e informa el error.
  }
}

/* ---------- Diálogo: levantamiento ---------- */

const DISCOVERY_FIELDS = ['pain', 'currentManagement', 'technicians', 'locations', 'buyTrigger', 'integrations', 'successCriteria', 'technicalNotes'];

function openDiscovery(id) {
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  const lead = getLead(id);
  if (!lead) return;
  if (!canEditLeadLocally(lead)) return toast('Solo puedes gestionar oportunidades asignadas a ti.', 'error');
  const d = getDiscovery(id) || {};
  $('discoveryLeadId').value = id;
  $('discoverySubtitle').textContent = `${lead.company} · ${lead.stage}`;
  DISCOVERY_FIELDS.forEach((k) => ($(k).value = d[k] ?? ''));
  $$('#moduleChecks input').forEach((c) => (c.checked = (d.modules || []).includes(c.value)));
  $('discoveryDialog').showModal();
}

async function submitDiscovery(e) {
  e.preventDefault();
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  const id = $('discoveryLeadId').value;
  if (!canEditLeadLocally(id)) return toast('Solo puedes gestionar oportunidades asignadas a ti.', 'error');
  const payload = Object.fromEntries(DISCOVERY_FIELDS.map((k) => [k, $(k).value.trim ? $(k).value.trim() : $(k).value]));
  payload.modules = $$('#moduleChecks input:checked').map((x) => x.value);
  if (!(await saveDiscovery(id, payload))) return;
  $('discoveryDialog').close();
  toast('Levantamiento guardado.');
}

/* ---------- Diálogo: actividad ---------- */

function markActivityDatePreset(value) {
  $$('[data-action="activity-date-preset"]').forEach((btn) => {
    btn.classList.toggle('active-view', btn.dataset.value === value);
  });
}

function setActivityDatePreset(value) {
  const input = $('activityDate');
  if (!input) return;

  if (value === 'now') {
    input.value = localDateTimeInput();
  } else if (value === 'yesterday') {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    input.value = localDateTimeInput(date);
  } else {
    markActivityDatePreset('custom');
    input.focus();
    if (typeof input.showPicker === 'function') {
      try { input.showPicker(); } catch {}
    }
    return;
  }

  markActivityDatePreset(value);
}

function syncActivityFollowupFields() {
  const mode = $('activityFollowupMode')?.value || 'preserve';
  const next = $('activityNextFields');
  if (next) next.hidden = mode !== 'replace';

  const lead = getLead($('activityLeadId')?.value);
  const task = taskOf(lead);
  const hint = $('activityFollowupHint');
  if (!hint) return;

  if (mode === 'resolve') {
    hint.textContent = task
      ? `Se cerrará la tarea pendiente: ${task.title}${task.date ? ` · ${fmtDate(task.date)}` : ''}.`
      : 'No hay una tarea pendiente que cerrar.';
  } else if (mode === 'replace') {
    hint.textContent = task
      ? `Esta actividad cerrará “${task.title}” y dejará el nuevo seguimiento indicado abajo.`
      : 'La actividad quedará registrada y se creará el próximo seguimiento.';
  } else {
    hint.textContent = task
      ? `La tarea pendiente se conservará sin cambios: ${task.title}${task.date ? ` · ${fmtDate(task.date)}` : ''}.`
      : 'La actividad se agregará al historial sin crear una tarea nueva.';
  }
}

function syncActivityFollowup(leadId, editing = false) {
  const controls = $('activityFollowupControls');
  if (!controls) return;
  controls.hidden = editing;
  if (editing) return;

  const task = taskOf(getLead(leadId));
  $('activityFollowupMode').innerHTML = [
    '<option value="preserve">Solo registrar la actividad</option>',
    task ? '<option value="resolve">Registrar y cerrar la tarea pendiente</option>' : '',
    '<option value="replace">Registrar y dejar una próxima tarea</option>'
  ].join('');
  $('activityFollowupMode').value = 'preserve';
  $('activityNextAction').value = '';
  $('activityNextDate').value = '';
  setTaskType('activity', '');
  syncActivityFollowupFields();
}

function openActivity(leadId = '') {
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  if (leadId && !canEditLeadLocally(leadId)) return toast('Solo puedes registrar actividad en oportunidades asignadas a ti.', 'error');
  if (!state.leads.length) return toast('Primero registra una empresa.', 'error');

  $('activityId').value = '';
  $('activityDialogTitle').textContent = 'Registrar actividad';
  $('activitySubmitBtn').textContent = 'Guardar actividad';
  $('activityLeadId').innerHTML = leadOptions(leadId);
  fillActivityContacts(leadId);
  $('activityType').value = ACTIVITY_TYPES[0];
  $('activityOwner').value = getLead(leadId)?.owner || session.profile?.name || '';
  $('activityDetail').value = '';
  setActivityDatePreset('now');
  syncActivityFollowup(leadId, false);
  $('activityDialog').showModal();
}

function editActivity(id) {
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  const act = getActivity(id);
  if (!act) return;
  if (act.leadId && !canEditLeadLocally(act.leadId)) return toast('Solo puedes editar actividad de oportunidades asignadas a ti.', 'error');

  $('activityId').value = id;
  $('activityDialogTitle').textContent = 'Editar actividad';
  $('activitySubmitBtn').textContent = 'Guardar cambios';
  $('activityLeadId').innerHTML = leadOptions(act.leadId);
  fillActivityContacts(act.leadId);
  $('activityContactId').value = act.contactId || '';
  $('activityType').value = act.type || ACTIVITY_TYPES[0];
  $('activityDate').value = act.date ? localDateTimeInput(new Date(act.date)) : localDateTimeInput();
  $('activityOwner').value = act.owner || '';
  $('activityDetail').value = act.detail || '';
  markActivityDatePreset('custom');
  syncActivityFollowup(act.leadId, true);
  $('activityDialog').showModal();
}

function fillActivityContacts(leadId) {
  const contacts = contactsOf(getLead(leadId));
  $('activityContactId').innerHTML =
    '<option value="">Sin especificar</option>' +
    contacts
      .map((contact) => `<option value="${contact.key}">${escapeHtml(contact.name || 'Sin nombre')}${contact.role ? ' · ' + escapeHtml(contact.role) : ''}</option>`)
      .join('');
}

async function submitActivity(e) {
  e.preventDefault();
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');

  const id = $('activityId').value;
  const leadId = $('activityLeadId').value;
  if (!leadId) return toast('Selecciona una empresa.', 'error');
  if (!canEditLeadLocally(leadId)) return toast('Solo puedes registrar actividad en oportunidades asignadas a ti.', 'error');

  const detail = $('activityDetail').value.trim();
  if (!detail) return toast('Escribe el detalle de la actividad.', 'error');

  const dateValue = $('activityDate').value;
  if (!dateValue) return toast('Indica cuándo ocurrió la actividad.', 'error');

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return toast('La fecha de la actividad no es válida.', 'error');
  if (!id && date.getTime() > Date.now() + 5 * 60 * 1000) {
    return toast('Una actividad realizada no puede quedar registrada en el futuro. Usa una tarea para programar lo que viene.', 'error');
  }

  const payload = {
    leadId,
    contactId: $('activityContactId').value,
    type: $('activityType').value,
    date: date.toISOString(),
    owner: $('activityOwner').value.trim(),
    detail
  };

  if (id) {
    if (!(await updateActivity(id, payload))) return;
    $('activityDialog').close();
    toast('Actividad actualizada.');
    return;
  }

  const mode = $('activityFollowupMode').value || 'preserve';
  const pendingTask = taskOf(getLead(leadId));
  const setFollowup = mode === 'replace';
  const resolveCurrentTask = mode === 'resolve' || (setFollowup && Boolean(pendingTask));
  const nextType = setFollowup ? taskTypeValue('activity') : '';
  const nextAction = setFollowup ? $('activityNextAction').value.trim() : '';
  const nextDate = setFollowup ? $('activityNextDate').value : '';

  if (setFollowup && !nextType && !nextAction) {
    return toast('Elige el tipo de la próxima tarea o escribe su objetivo.', 'error');
  }
  if (setFollowup && !nextDate) {
    return toast('Elige la fecha de la próxima tarea.', 'error');
  }

  const saved = await recordActivityWithFollowupAtomic(payload, {
    resolveCurrentTask,
    setFollowup,
    nextType,
    nextAction,
    nextDate
  });
  if (!saved) return;

  $('activityDialog').close();
  toast(
    setFollowup
      ? 'Actividad registrada y próximo seguimiento agendado.'
      : resolveCurrentTask
        ? 'Actividad registrada y tarea pendiente cerrada.'
        : 'Actividad registrada.'
  );
}

/* ---------- Diálogo: contacto ---------- */

function openContact(leadId, key = '') {
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  const lead = getLead(leadId);
  if (!lead) return;
  if (!canEditLeadLocally(lead)) return toast('Solo puedes gestionar contactos de oportunidades asignadas a ti.', 'error');
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
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  const leadId = $('contactLeadId').value;
  if (!canEditLeadLocally(leadId)) return toast('Solo puedes gestionar contactos de oportunidades asignadas a ti.', 'error');
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
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  const lead = getLead(leadId);
  if (lead && !canEditLeadLocally(lead)) return toast('Solo puedes contactar desde oportunidades asignadas a ti.', 'error');
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

async function submitComm(e) {
  e.preventDefault();
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  const leadId = $('commLeadId').value;
  const lead = getLead(leadId);
  if (!canEditLeadLocally(lead)) return toast('Solo puedes contactar desde oportunidades asignadas a ti.', 'error');
  const contactKey = $('commContactKey').value;
  const contact = findContact(lead, contactKey);
  const channel = $('commChannel').value;
  const body = $('commBody').value;
  const templateName = state.templates.find((x) => x.id === $('commTemplate').value)?.name || 'Personalizado';

  if (channel === 'whatsapp') {
    if (!contact?.phone) return toast('Ese contacto no tiene teléfono.', 'error');
    const digits = contact.phone.replace(/\D/g, '');
    if (!digits) return toast('El teléfono no es válido.', 'error');
    if (!(await addActivityConfirmed({ leadId, contactId: contactKey, type: 'WhatsApp', date: localDateTimeInput(), owner: lead.owner || '', detail: `WhatsApp preparado con plantilla "${templateName}" para ${contact.name || contact.phone}.` }))) return;
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(body)}`, '_blank', 'noopener');
  } else {
    if (!contact?.email) return toast('Ese contacto no tiene email.', 'error');
    if (!(await addActivityConfirmed({ leadId, contactId: contactKey, type: 'Correo', date: localDateTimeInput(), owner: lead.owner || '', detail: `Correo preparado con plantilla "${templateName}" para ${contact.name || contact.email}.` }))) return;
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
  const all = openTasks();
  if (ui.taskTab === 'today') return all.filter((t) => t.date === today);
  if (ui.taskTab === 'upcoming') return all.filter((t) => t.date && t.date > today);
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
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  const lead = getLead(leadId);
  if (lead && !canEditLeadLocally(lead)) return toast('Solo puedes cerrar tareas de oportunidades asignadas a ti.', 'error');
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
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  const leadId = $('completeLeadId').value;
  if (!canEditLeadLocally(leadId)) return toast('Solo puedes cerrar tareas de oportunidades asignadas a ti.', 'error');
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
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  const lead = getLead(leadId);
  if (lead && !canEditLeadLocally(lead)) return toast('Solo puedes reagendar tareas de oportunidades asignadas a ti.', 'error');
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
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  const leadId = $('taskLeadId').value;
  if (!canEditLeadLocally(leadId)) return toast('Solo puedes reagendar tareas de oportunidades asignadas a ti.', 'error');
  const nextType = taskTypeValue('task');
  const note = $('taskAction').value.trim();
  if (!nextType && !note) return toast('Elige el tipo de tarea o escribe una nota.', 'error');
  const date = $('taskDate').value;
  if (!date) return toast('Elige la fecha de la tarea.', 'error');
  if (!(await updateLead(leadId, { nextType, nextAction: note, nextDate: date }))) return;
  $('taskDialog').close();
  toast('Tarea agendada.');
}

/* ---------- Diálogo: mover de etapa ---------- */

function openStage(id) {
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  const lead = getLead(id);
  if (!lead) return;
  if (!canEditLeadLocally(lead)) return toast('Solo puedes mover oportunidades asignadas a ti.', 'error');
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
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  const id = $('stageLeadId').value;
  if (!canEditLeadLocally(id)) return toast('Solo puedes mover oportunidades asignadas a ti.', 'error');
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
    list.addEventListener('drop', async (ev) => {
      ev.preventDefault();
      if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
      list.classList.remove('drop-target');
      const target = list.dataset.stage;
      const lead = getLead(draggedId);
      if (!lead || lead.stage === target) return;
      if (!canEditLeadLocally(lead)) return toast('Solo puedes mover oportunidades asignadas a ti.', 'error');
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

// El borrador vive en ui.quoteBuilder. Los montos nunca se calculan aquí: cada
// cambio pide quote_preview al servidor (mismo cálculo que save_quote) y se
// pinta lo que devuelve. Las líneas se identifican por `ref` para que los
// descuentos por línea sigan apuntando bien aunque se quiten otras líneas.

const quoteRef = () => uid().slice(0, 8);
let quotePreviewTimer = null;
let quotePreviewSeq = 0;

const activePriceLists = () => quoteState.priceLists.filter((l) => l.status === 'vigente');
const listItemOf = (id) => getPriceListItem(id);

function readQuoteHeader() {
  const b = ui.quoteBuilder;
  const lead = getLead($('quoteLeadId').value);
  Object.assign(b, {
    leadId: $('quoteLeadId').value,
    priceListId: $('quotePriceList').value,
    currency: $('quoteCurrency').value,
    ufValue: $('quoteUfValue').value === '' ? null : Number($('quoteUfValue').value),
    quoteDate: $('quoteDate').value,
    validUntil: $('quoteValidUntil').value,
    contractMonths: Number($('quoteContractMonths').value || 0),
    status: $('quoteStatusField').value,
    paymentMethod: $('quotePaymentMethod').value,
    paymentTerms: $('quotePaymentTerms').value,
    notes: $('quoteNotes').value.trim(),
    client: {
      company: lead?.company || b.client?.company || '',
      rut: lead?.rut || b.client?.rut || '',
      contact: $('quoteContactName').value.trim(),
      role: $('quoteContactRole').value.trim(),
      phone: $('quoteContactPhone').value.trim(),
      email: $('quoteContactEmail').value.trim()
    }
  });
}

function fillQuoteLeadFields(lead, withContact) {
  $('quoteClientRut').value = lead?.rut || '';
  if (!withContact) return;
  $('quoteContactName').value = lead?.contact || '';
  $('quoteContactRole').value = lead?.role || '';
  $('quoteContactPhone').value = lead?.phone || '';
  $('quoteContactEmail').value = lead?.email || '';
}

function fillQuoteServiceOptions() {
  const b = ui.quoteBuilder;
  const list = getPriceList(b.priceListId);
  const items = itemsOfPriceList(b.priceListId).filter((it) => it.active);
  const groups = new Map();
  items.forEach((it) => groups.set(it.category || 'Sin categoría', [...(groups.get(it.category || 'Sin categoría') || []), it]));
  $('quoteAddService').innerHTML = items.length
    ? [...groups]
        .map(
          ([cat, rows]) =>
            `<optgroup label="${escapeHtml(cat)}">${rows
              .map((it) => `<option value="${it.id}">${escapeHtml(it.name)} · ${fmtCurrency(it.price, list?.currency)} ${it.periodicity === 'unico' ? 'único' : 'mensual'}</option>`)
              .join('')}</optgroup>`
        )
        .join('')
    : '<option value="">La lista no tiene servicios activos</option>';
}

/** Mismo formato que quoteDocFromSaved, armado desde el borrador y su último cálculo. */
function builderDoc() {
  const b = ui.quoteBuilder;
  const calc = b.calc;
  const lines = (calc?.items || []).map((ci) => {
    const cl = calc.lines.find((l) => l.ref === ci.ref) || {};
    return {
      code: ci.code,
      name: ci.name,
      periodicity: ci.periodicity,
      quantity: ci.quantity,
      unitPrice: ci.unit_price,
      subtotal: cl.subtotal,
      discount: cl.discount,
      total: cl.total,
      discountMonths: cl.discount_months
    };
  });
  return {
    number: b.number,
    version: b.version,
    status: b.status,
    owner: b.owner,
    currency: b.currency,
    ufValue: b.ufValue,
    ufDate: b.ufDate,
    quoteDate: b.quoteDate,
    validUntil: b.validUntil,
    contractMonths: b.contractMonths,
    paymentMethod: b.paymentMethod,
    paymentTerms: b.paymentTerms,
    notes: b.notes,
    client: b.client,
    lines,
    totals: calc || {}
  };
}

function renderQuoteSummary() {
  const b = ui.quoteBuilder;
  $('quoteLinesRoot').innerHTML = quoteLinesHtml(b);
  $('quoteSummaryRoot').innerHTML = b.calcError
    ? `<p class="import-error">${escapeHtml(b.calcError)}</p>`
    : b.calc
      ? quoteDocHtml(builderDoc())
      : '<p class="muted">Calculando…</p>';
}

function renderQuoteDiscounts() {
  $('quoteDiscountsRoot').innerHTML = quoteDiscountsHtml(ui.quoteBuilder);
  syncQuoteDiscountInputs();
}

function syncQuoteDiscountInputs() {
  const b = ui.quoteBuilder;
  const target = $('quoteDiscTarget')?.value || '';
  const kind = $('quoteDiscKind')?.value || '';
  if (!target) return;
  const ref = target.startsWith('line:') ? target.slice(5) : '';
  const line = b.items.find((it) => it.ref === ref);
  const isSetup = target === 'setup_total' || listItemOf(line?.priceListItemId)?.periodicity === 'unico';
  $('quoteDiscMonths').disabled = isSetup;
  if (isSetup) $('quoteDiscMonths').value = '';
  $('quoteDiscValue').disabled = kind === 'free';
  if (kind === 'free') $('quoteDiscValue').value = '';
  $('quoteDiscValue').placeholder = kind === 'percent' ? '%' : kind === 'free' ? '—' : b.currency === 'CLP' ? '$' : 'UF';
}

function scheduleQuotePreview() {
  clearTimeout(quotePreviewTimer);
  quotePreviewTimer = setTimeout(runQuotePreview, 300);
}

async function runQuotePreview() {
  const b = ui.quoteBuilder;
  if (!b || !$('quoteDialog').open) return;
  readQuoteHeader();
  const seq = ++quotePreviewSeq;
  if (!b.priceListId || !b.items.length) {
    b.calc = null;
    b.calcError = b.priceListId ? 'Agrega al menos una línea de servicio para ver el resumen.' : 'Elige una lista de precios.';
    renderQuoteSummary();
    return;
  }
  try {
    const calc = await previewQuote(b);
    if (seq !== quotePreviewSeq || ui.quoteBuilder !== b) return;
    Object.assign(b, { calc, calcError: '' });
  } catch (err) {
    if (seq !== quotePreviewSeq || ui.quoteBuilder !== b) return;
    Object.assign(b, { calc: null, calcError: err.message || 'No se pudo calcular la cotización.' });
  }
  renderQuoteSummary();
}

async function loadQuoteUf({ force = false } = {}) {
  const b = ui.quoteBuilder;
  if (!b || (b.ufManual && !force)) return scheduleQuotePreview();
  const date = $('quoteDate').value || todayISO();
  $('quoteUfHint').textContent = '· consultando…';
  const value = await fetchUfValue(date);
  if (ui.quoteBuilder !== b) return;
  if (value) {
    $('quoteUfValue').value = value;
    Object.assign(b, { ufDate: date, ufManual: false });
    $('quoteUfHint').textContent = `· mindicador.cl ${fmtDate(date)}`;
  } else {
    $('quoteUfHint').textContent = '· sin dato: ingrésalo a mano';
  }
  scheduleQuotePreview();
}

/** Al cambiar de lista, cada línea se busca por código en la nueva; las que no existan se quitan. */
function remapQuoteItems(newListId) {
  const b = ui.quoteBuilder;
  const target = itemsOfPriceList(newListId).filter((it) => it.active);
  const dropped = [];
  b.items = b.items.filter((it) => {
    const code = listItemOf(it.priceListItemId)?.code;
    const match = target.find((x) => x.code === code);
    if (match) it.priceListItemId = match.id;
    else dropped.push(it.ref);
    return Boolean(match);
  });
  b.discounts = b.discounts.filter((d) => d.scope !== 'line' || !dropped.includes(d.itemRef));
  return dropped.length;
}

function openQuoteBuilder(leadId = '', baseId = '') {
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  const base = baseId ? getQuote(baseId) : null;
  const targetLeadId = base?.leadId || leadId;
  if (targetLeadId && !canEditLeadLocally(targetLeadId)) return toast('Solo puedes cotizar oportunidades asignadas a ti.', 'error');
  if (base && !isAdmin() && base.ownerId !== session.user?.id) return toast('Solo quien creó esta cotización puede generar una nueva versión.', 'error');
  if (base && !base.isCurrent) return toast('Solo se puede editar la versión vigente de la cotización.', 'error');
  const lists = activePriceLists();
  if (!lists.length) {
    return toast(isAdmin() ? 'Primero carga una lista de precios en "Listas de precios".' : 'No hay listas de precios vigentes. Pide a un administrador que cargue una.', 'error');
  }

  const lead = getLead(targetLeadId);
  const refByItemId = new Map();
  const items = (base?.items || [])
    .filter((it) => it.priceListItemId && listItemOf(it.priceListItemId))
    .map((it) => {
      const ref = quoteRef();
      refByItemId.set(it.id, ref);
      return { ref, priceListItemId: it.priceListItemId, quantity: it.quantity };
    });
  const discounts = (base?.discounts || [])
    .filter((d) => d.scope !== 'line' || refByItemId.has(d.quoteItemId))
    .map((d) => ({ scope: d.scope, itemRef: d.scope === 'line' ? refByItemId.get(d.quoteItemId) : '', kind: d.kind, value: d.value, months: d.months }));

  const b = (ui.quoteBuilder = {
    baseId,
    number: base?.number || '',
    version: base ? Math.max(...versionsOf(base.rootId).map((q) => q.version)) + 1 : 1,
    owner: base?.owner || session.profile?.name || '',
    leadId: lead?.id || '',
    priceListId: base?.priceListId || lists[0].id,
    currency: base?.currency || 'UF',
    ufValue: null,
    ufDate: '',
    ufManual: false,
    quoteDate: todayISO(),
    validUntil: addDaysISO(todayISO(), 7),
    contractMonths: base?.contractMonths || 12,
    status: base?.status || 'borrador',
    paymentMethod: base?.paymentMethod || '',
    paymentTerms: base?.paymentTerms || '',
    notes: base?.notes || '',
    client: base?.client || {},
    items,
    discounts,
    calc: null,
    calcError: ''
  });

  // La lista original puede haberse archivado: se pasa a una vigente buscando cada servicio por código.
  let dropped = (base?.items.length || 0) - items.length;
  if (!lists.some((l) => l.id === b.priceListId)) {
    const from = getPriceList(b.priceListId);
    b.priceListId = lists[0].id;
    dropped += remapQuoteItems(b.priceListId);
    toast(`La lista "${from?.name || 'original'}" ya no está vigente; se usó "${lists[0].name}".`);
  }
  if (dropped > 0) toast(`${dropped} línea(s) no existen en la lista vigente y se quitaron.`, 'error');

  $('quoteBaseId').value = baseId;
  $('quoteDialogTitle').textContent = base ? `Editar cotización ${base.number || ''}` : 'Nueva cotización';
  $('quoteDialogSubtitle').textContent = base
    ? `Guardar crea la versión ${b.version}; la anterior queda en el historial.`
    : 'Elige la empresa y la lista de precios, agrega servicios y descuentos.';
  $('quoteNumberBadge').textContent = base?.number || 'N° al guardar';
  $('quoteLeadId').innerHTML = leadOptions(b.leadId);
  $('quoteLeadId').disabled = Boolean(base || leadId);
  $('quoteOwner').value = b.owner;
  fillQuoteLeadFields(lead, !base);
  if (base) {
    $('quoteContactName').value = base.client?.contact || '';
    $('quoteContactRole').value = base.client?.role || '';
    $('quoteContactPhone').value = base.client?.phone || '';
    $('quoteContactEmail').value = base.client?.email || '';
  }
  $('quotePriceList').innerHTML = lists.map((l) => `<option value="${l.id}">${escapeHtml(l.name)} (${l.currency})</option>`).join('');
  $('quotePriceList').value = b.priceListId;
  $('quoteCurrency').value = b.currency;
  $('quoteUfValue').value = '';
  $('quoteDate').value = b.quoteDate;
  $('quoteValidUntil').value = b.validUntil;
  $('quoteContractMonths').value = b.contractMonths;
  $('quoteStatusField').value = b.status;
  $('quotePaymentMethod').value = b.paymentMethod;
  $('quotePaymentTerms').value = b.paymentTerms;
  $('quoteNotes').value = b.notes;
  $('quoteAddQty').value = 1;
  fillQuoteServiceOptions();
  renderQuoteDiscounts();
  renderQuoteSummary();
  $('quoteDialog').showModal();
  loadQuoteUf();
}

function handleQuoteFormChange(ev) {
  const b = ui.quoteBuilder;
  const el = ev.target;
  if (!b || !el) return;
  if (el.dataset.quoteLineQty) {
    if (ev.type !== 'change') return;
    const it = b.items.find((x) => x.ref === el.dataset.quoteLineQty);
    if (!it) return;
    it.quantity = Math.max(1, Math.round(Number(el.value) || 1));
    el.value = it.quantity;
    return scheduleQuotePreview();
  }
  switch (el.id) {
    case 'quoteLeadId':
      if (ev.type === 'change') fillQuoteLeadFields(getLead(el.value), true);
      return scheduleQuotePreview();
    case 'quotePriceList': {
      if (ev.type !== 'change') return;
      const dropped = remapQuoteItems(el.value);
      b.priceListId = el.value;
      if (dropped) toast(`${dropped} línea(s) no existen en la nueva lista y se quitaron.`, 'error');
      fillQuoteServiceOptions();
      renderQuoteDiscounts();
      return scheduleQuotePreview();
    }
    case 'quoteUfValue':
      Object.assign(b, { ufManual: true, ufDate: $('quoteDate').value });
      $('quoteUfHint').textContent = '· ingresado a mano';
      return scheduleQuotePreview();
    case 'quoteDate':
      if (ev.type === 'change') loadQuoteUf();
      return;
    case 'quoteCurrency':
      b.currency = el.value;
      renderQuoteDiscounts();
      return scheduleQuotePreview();
    case 'quoteDiscTarget':
    case 'quoteDiscKind':
      return syncQuoteDiscountInputs();
    case 'quoteAddService':
    case 'quoteAddQty':
    case 'quoteDiscValue':
    case 'quoteDiscMonths':
      return;
    default:
      return scheduleQuotePreview();
  }
}

function addQuoteLine() {
  const b = ui.quoteBuilder;
  const itemId = $('quoteAddService').value;
  const qty = Math.max(1, Math.round(Number($('quoteAddQty').value) || 1));
  if (!itemId) return toast('Elige un servicio.', 'error');
  const existing = b.items.find((it) => it.priceListItemId === itemId);
  if (existing) existing.quantity += qty;
  else b.items.push({ ref: quoteRef(), priceListItemId: itemId, quantity: qty });
  $('quoteAddQty').value = 1;
  renderQuoteDiscounts();
  renderQuoteSummary();
  scheduleQuotePreview();
}

function addQuoteDiscount() {
  const b = ui.quoteBuilder;
  readQuoteHeader();
  const target = $('quoteDiscTarget').value;
  const kind = $('quoteDiscKind').value;
  const scope = target.startsWith('line:') ? 'line' : target;
  const itemRef = scope === 'line' ? target.slice(5) : '';
  const line = b.items.find((it) => it.ref === itemRef);
  const isSetup = scope === 'setup_total' || listItemOf(line?.priceListItemId)?.periodicity === 'unico';
  const value = kind === 'free' ? 0 : Number($('quoteDiscValue').value);
  const months = isSetup || $('quoteDiscMonths').value === '' ? null : Math.round(Number($('quoteDiscMonths').value));
  if (scope === 'line' && !line) return toast('Elige a qué línea aplica el descuento.', 'error');
  if (kind !== 'free' && !(value > 0)) return toast('Ingresa un valor mayor que cero.', 'error');
  if (kind === 'percent' && value > 100) return toast('Un porcentaje no puede superar 100.', 'error');
  if (months != null && (months < 1 || months > b.contractMonths)) return toast(`Los meses deben estar entre 1 y ${b.contractMonths}.`, 'error');
  b.discounts.push({ scope, itemRef, kind, value, months });
  renderQuoteDiscounts();
  scheduleQuotePreview();
}

async function submitQuoteBuilder(e) {
  e.preventDefault();
  const b = ui.quoteBuilder;
  if (!b) return;
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  readQuoteHeader();
  if (!b.leadId) return toast('Selecciona una empresa.', 'error');
  if (!canEditLeadLocally(b.leadId)) return toast('Solo puedes cotizar oportunidades asignadas a ti.', 'error');
  if (!b.client.contact) return toast('Ingresa el nombre del contacto.', 'error');
  if (!b.client.email) return toast('Ingresa el correo del contacto.', 'error');
  if (!b.paymentMethod) return toast('Selecciona la forma de pago.', 'error');
  if (!b.paymentTerms) return toast('Selecciona la condición de pago.', 'error');
  if (!b.items.length) return toast('Agrega al menos una línea de servicio.', 'error');

  const saved = await saveQuote(b, b.baseId);
  if (!saved) return;
  $('quoteDialog').close();
  ui.quoteBuilder = null;
  toast(`Cotización ${saved.number} guardada${saved.version > 1 ? ` como versión ${saved.version}` : ''}.`);
}

/* ---------- PDF ---------- */

async function ensureHtml2Pdf() {
  if (window.html2pdf) return window.html2pdf;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
    script.onload = resolve;
    script.onerror = () => {
      script.remove();
      reject(new Error('No se pudo cargar el generador de PDF. Revisa la conexión.'));
    };
    document.head.appendChild(script);
  });
  return window.html2pdf;
}

async function downloadQuotePdf(doc) {
  const html2pdf = await ensureHtml2Pdf();
  const holder = document.createElement('div');
  holder.className = 'quote-pdf-holder';
  holder.innerHTML = quoteDocHtml(doc);
  document.body.appendChild(holder);
  const safe = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '');
  const filename = `${safe(doc.number) || 'cotizacion'}${doc.version > 1 ? `-v${doc.version}` : ''}-${safe(doc.client?.company)}.pdf`;
  try {
    await html2pdf()
      .set({
        margin: [10, 10, 12, 10],
        filename,
        image: { type: 'jpeg', quality: 0.96 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.qd-totals', '.qd-months', '.qd-head'] }
      })
      .from(holder.firstElementChild)
      .save();
  } finally {
    holder.remove();
  }
}

function openQuoteView(id) {
  const q = getQuote(id);
  if (!q) return;
  const lead = getLead(q.leadId);
  $('quoteViewTitle').textContent = `${q.number || 'Cotización'} · ${lead?.company || q.client?.company || 'Empresa eliminada'}`;
  $('quoteViewSubtitle').textContent = `Versión ${q.version}${q.isCurrent ? ' vigente' : ''} · ${q.owner || 'Sin responsable'} · actualizada ${fmtDateTime(q.updatedAt)}`;
  const versions = versionsOf(q.rootId);
  $('quoteViewBody').innerHTML = `
    ${quoteDocHtml(quoteDocFromSaved(q))}
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
  $('quoteViewEditBtn').dataset.id = versions.find((v) => v.isCurrent)?.id || q.id;
  $('quoteViewSendBtn').dataset.id = q.id;
  $('quoteViewPdfBtn').dataset.id = q.id;
  $('quoteViewDialog').showModal();
}

function openQuoteSend(id) {
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  const q = getQuote(id);
  if (q && !canEditLeadLocally(q.leadId)) return toast('Solo puedes preparar cotizaciones de oportunidades asignadas a ti.', 'error');
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

async function submitQuoteSend(e) {
  e.preventDefault();
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  const id = $('quoteSendId').value;
  const q = getQuote(id);
  const lead = getLead(q?.leadId);
  if (!q || !lead) return;
  if (!canEditLeadLocally(lead)) return toast('Solo puedes preparar cotizaciones de oportunidades asignadas a ti.', 'error');
  if (!(await addActivityConfirmed({
    leadId: lead.id,
    type: 'Correo',
    date: localDateTimeInput(),
    owner: lead.owner || session.profile?.name || '',
    detail: `Correo preparado con cotización v${q.version} para ${lead.contact || lead.email}.`
  }))) return;
  openExternal(`mailto:${encodeURIComponent(lead.email)}?subject=${encodeURIComponent($('quoteSendSubject').value)}&body=${encodeURIComponent($('quoteSendBody').value)}`);
  $('quoteSendDialog').close();
  if ($('quoteViewDialog').open) $('quoteViewDialog').close();
  toast('Correo abierto.');
}

/* ---------- Listas de precios ---------- */

const ADMIN_ONLY_LISTS = 'Solo un administrador puede modificar las listas de precios.';

const normalizeHeader = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9$ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Encabezados aceptados por columna (ya normalizados: sin tildes y en minúscula).
const PRICE_IMPORT_COLUMNS = {
  code: ['codigo', 'cod', 'code', 'sku'],
  name: ['nombre', 'servicio', 'nombre servicio', 'descripcion', 'name', 'item'],
  price: ['precio', 'valor', 'precio neto', 'price'],
  periodicity: ['periodicidad', 'periodo', 'frecuencia', 'cobro', 'tipo de cobro'],
  category: ['categoria', 'category', 'familia', 'grupo'],
  active: ['activo', 'estado', 'active', 'vigente']
};

const PRICE_IMPORT_LABEL = {
  code: 'Código',
  name: 'Nombre',
  price: 'Precio',
  periodicity: 'Periodicidad',
  category: 'Categoría',
  active: 'Activo'
};

const priceImport = { filename: '', headers: [], rows: [], mapping: {}, items: [], errors: [] };

function detectPriceColumns(headers) {
  const normalized = headers.map(normalizeHeader);
  const mapping = {};
  Object.entries(PRICE_IMPORT_COLUMNS).forEach(([field, names]) => {
    let index = normalized.findIndex((h) => names.includes(h));
    // "Precio UF", "Precio CLP", "Valor neto": basta con que empiece igual.
    if (index < 0) index = normalized.findIndex((h) => names.some((n) => h.startsWith(`${n} `)));
    if (index >= 0 && !Object.values(mapping).includes(index)) mapping[field] = index;
  });
  return mapping;
}

function detectPriceCurrency(headers, mapping) {
  const header = normalizeHeader(headers[mapping.price]);
  if (/\bclp\b|\$|peso/.test(header)) return 'CLP';
  if (/\buf\b/.test(header)) return 'UF';
  return '';
}

/** Devuelve el precio como texto decimal con punto ("0.70") o null si no es válido. */
function parseImportPrice(raw, currency) {
  let s = String(raw ?? '').replace(/uf|clp|\$|\s/gi, '');
  if (!s) return null;
  if (s.includes('.') && s.includes(',')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = (s.match(/,/g) || []).length > 1 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (currency === 'CLP' && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  return /^\d+(\.\d+)?$/.test(s) ? s : null;
}

function parseImportPeriodicity(raw) {
  const v = normalizeHeader(raw);
  if (['unico', 'unica', 'pago unico', 'una vez', 'one time'].includes(v)) return 'unico';
  if (['mensual', 'mes', 'monthly', 'recurrente'].includes(v)) return 'mensual';
  return null;
}

function parseImportActive(raw) {
  const v = normalizeHeader(raw);
  if (!v || ['si', 's', 'yes', 'y', 'true', '1', 'activo', 'x', 'vigente'].includes(v)) return true;
  if (['no', 'n', 'false', '0', 'inactivo'].includes(v)) return false;
  return null;
}

function buildPriceImportItems() {
  const currency = $('priceImportCurrency').value;
  const { rows, mapping } = priceImport;
  const cell = (row, field) => (mapping[field] == null ? '' : String(row[mapping[field]] ?? '').trim());
  const seen = new Map();
  priceImport.errors = [];
  priceImport.items = rows.map((row, i) => {
    const problems = [];
    const code = cell(row, 'code');
    const name = cell(row, 'name');
    const price = parseImportPrice(cell(row, 'price'), currency);
    const periodicity = parseImportPeriodicity(cell(row, 'periodicity'));
    const active = parseImportActive(cell(row, 'active'));
    if (!code) problems.push('falta el código');
    else if (seen.has(code)) problems.push(`código repetido (fila ${seen.get(code)})`);
    else seen.set(code, i + 1);
    if (!name) problems.push('falta el nombre');
    if (price == null) problems.push('precio no válido');
    if (!periodicity) problems.push('periodicidad debe ser Único o Mensual');
    if (active == null) problems.push('activo debe ser Sí o No');
    if (problems.length) priceImport.errors.push({ row: i + 1, problems });
    return { code, name, price, periodicity, category: cell(row, 'category'), active, problems };
  });
}

function renderPriceImportPreview() {
  const root = $('priceImportPreview');
  const submit = $('priceImportSubmit');
  submit.disabled = true;
  if (!priceImport.rows.length) {
    root.innerHTML = priceImport.filename ? '<p class="muted">El archivo no trae filas con datos.</p>' : '';
    return;
  }
  const missing = ['code', 'name', 'price', 'periodicity'].filter((f) => priceImport.mapping[f] == null);
  if (missing.length) {
    root.innerHTML = `<p class="import-error">No encontré las columnas: <strong>${missing.map((f) => PRICE_IMPORT_LABEL[f]).join(', ')}</strong>. Encabezados del archivo: ${priceImport.headers.map((h) => escapeHtml(h)).join(', ')}.</p>`;
    return;
  }
  buildPriceImportItems();
  const currency = $('priceImportCurrency').value;
  const items = priceImport.items;
  const detected = Object.entries(priceImport.mapping)
    .map(([f, idx]) => `${PRICE_IMPORT_LABEL[f]} ← "${escapeHtml(priceImport.headers[idx])}"`)
    .join(' · ');
  const errors = priceImport.errors.length;
  root.innerHTML = `
    <p class="muted">Columnas detectadas: ${detected}</p>
    <p><strong>${items.length} servicio(s)</strong> · ${items.filter((it) => it.active === true).length} activos · ${items.filter((it) => it.periodicity === 'unico').length} de pago único · ${
      errors ? `<span class="badge danger">${errors} fila(s) con error</span>` : '<span class="badge success">Sin errores</span>'
    }</p>
    <div class="table-wrap price-import-table"><table class="data-table">
      <thead><tr><th>#</th><th>Código</th><th>Nombre</th><th class="num">Precio ${escapeHtml(currency)}</th><th>Periodicidad</th><th>Categoría</th><th>Activo</th></tr></thead>
      <tbody>${items
        .map(
          (it, i) => `<tr class="${it.problems.length ? 'import-row-error' : ''}">
            <td>${i + 1}</td>
            <td>${escapeHtml(it.code)}</td>
            <td>${escapeHtml(it.name)}${it.problems.length ? `<div class="import-error">${escapeHtml(it.problems.join('; '))}</div>` : ''}</td>
            <td class="num">${it.price == null ? '—' : fmtAmount(it.price, currency)}</td>
            <td>${it.periodicity === 'unico' ? 'Único' : it.periodicity === 'mensual' ? 'Mensual' : '—'}</td>
            <td>${escapeHtml(it.category || '—')}</td>
            <td>${it.active == null ? '—' : it.active ? 'Sí' : 'No'}</td>
          </tr>`
        )
        .join('')}</tbody>
    </table></div>`;
  submit.disabled = errors > 0 || !$('priceImportName').value.trim();
}

function openPriceImport() {
  if (!isAdmin()) return toast(ADMIN_ONLY_LISTS, 'error');
  Object.assign(priceImport, { filename: '', headers: [], rows: [], mapping: {}, items: [], errors: [] });
  $('priceImportFile').value = '';
  $('priceImportName').value = '';
  $('priceImportCurrency').value = 'UF';
  renderPriceImportPreview();
  $('priceImportDialog').showModal();
}

async function handlePriceImportFile() {
  const file = $('priceImportFile').files?.[0];
  if (!file) return;
  $('priceImportPreview').innerHTML = '<p class="muted">Leyendo archivo…</p>';
  try {
    const parsed = await parseUploadedFile(file);
    Object.assign(priceImport, { filename: file.name, headers: parsed.headers, rows: parsed.rows });
    priceImport.mapping = detectPriceColumns(parsed.headers);
    const currency = detectPriceCurrency(parsed.headers, priceImport.mapping);
    if (currency) $('priceImportCurrency').value = currency;
    if (!$('priceImportName').value.trim()) $('priceImportName').value = file.name.replace(/\.[^.]+$/, '');
  } catch (err) {
    Object.assign(priceImport, { filename: file.name, headers: [], rows: [], mapping: {} });
    $('priceImportPreview').innerHTML = `<p class="import-error">${escapeHtml(err.message || 'No se pudo leer el archivo.')}</p>`;
    $('priceImportSubmit').disabled = true;
    return;
  }
  renderPriceImportPreview();
}

async function submitPriceImport(e) {
  e.preventDefault();
  if (!isAdmin()) return toast(ADMIN_ONLY_LISTS, 'error');
  const name = $('priceImportName').value.trim();
  if (!name) return toast('Ponle un nombre a la lista.', 'error');
  buildPriceImportItems();
  if (!priceImport.items.length || priceImport.errors.length) return toast('Corrige las filas con error antes de importar.', 'error');
  const id = await importPriceList({
    name,
    currency: $('priceImportCurrency').value,
    sourceFile: priceImport.filename,
    items: priceImport.items.map(({ problems, ...it }) => it)
  });
  if (!id) return;
  $('priceImportDialog').close();
  ui.quotesView = 'lists';
  ui.priceListId = id;
  render();
  toast(`Lista "${name}" importada con ${priceImport.items.length} servicios.`);
}

function openPriceItem(listId, itemId = '') {
  if (!isAdmin()) return toast(ADMIN_ONLY_LISTS, 'error');
  const item = itemId ? getPriceListItem(itemId) : null;
  const list = getPriceList(item?.priceListId || listId);
  if (!list) return;
  $('priceItemDialogTitle').textContent = item ? 'Editar servicio' : 'Nuevo servicio';
  $('priceItemDialogSubtitle').textContent = `Lista "${list.name}"`;
  $('priceItemPriceLabel').textContent = `Precio ${list.currency}`;
  $('priceItemId').value = item?.id || '';
  $('priceItemListId').value = list.id;
  $('priceItemCode').value = item?.code || '';
  $('priceItemName').value = item?.name || '';
  $('priceItemPrice').value = item ? item.price : '';
  $('priceItemPeriodicity').value = item?.periodicity || 'mensual';
  $('priceItemCategory').value = item?.category || '';
  $('priceItemActive').checked = item ? item.active : true;
  $('priceItemDialog').showModal();
}

async function submitPriceItem(e) {
  e.preventDefault();
  if (!isAdmin()) return toast(ADMIN_ONLY_LISTS, 'error');
  const code = $('priceItemCode').value.trim();
  const name = $('priceItemName').value.trim();
  const price = $('priceItemPrice').value;
  if (!code || !name) return toast('Código y nombre son obligatorios.', 'error');
  if (price === '' || Number(price) < 0) return toast('Ingresa un precio válido.', 'error');
  const saved = await savePriceListItem({
    id: $('priceItemId').value || undefined,
    priceListId: $('priceItemListId').value,
    code,
    name,
    price: Number(price),
    periodicity: $('priceItemPeriodicity').value,
    category: $('priceItemCategory').value.trim(),
    active: $('priceItemActive').checked
  });
  if (!saved) return;
  $('priceItemDialog').close();
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
      toast('Cuenta creada. Un súper administrador debe activarla antes de usar el CRM.');
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
  'activity-date-preset': (id, btn) => setActivityDatePreset(btn.dataset.value),
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
  'complete-task-inline': async (id) => {
    if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
    if (!canEditLeadLocally(id)) return toast('Solo puedes cerrar tareas de oportunidades asignadas a ti.', 'error');
    const result = $('fichaResult').value.trim();
    if (!result) return toast('Cuenta cómo resultó la tarea.', 'error');
    const nextType = taskTypeValue('ficha');
    const nextAction = $('fichaNextAction').value.trim();
    const nextDate = $('fichaNextDate').value;
    if ((nextType || nextAction) && !nextDate) return toast('Elige la fecha de la siguiente tarea.', 'error');
    const task = taskOf(getLead(id));
    const closed = await completeTaskAtomic(id, {
      type: task?.type || 'Actividad',
      date: localDateTimeInput(),
      result,
      nextType,
      nextAction,
      nextDate
    });
    if (!closed) return;
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
    if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
    const lead = getLead(id);
    if (lead && !canEditLeadLocally(lead)) return toast('Solo puedes calificar oportunidades asignadas a ti.', 'error');
    if (!lead) return;
    if (await setStage(id, 'Contactado')) toast(`${lead.company} calificado → Contactado.`);
  },
  'add-contact': (id) => openContact(id),
  'edit-contact': (id, btn) => openContact(id, btn.dataset.contact),
  'delete-contact': async (id, btn) => {
    if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
    if (!canEditLeadLocally(id)) return toast('Solo puedes gestionar contactos de oportunidades asignadas a ti.', 'error');
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
    if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
    const act = getActivity(id);
    if (act?.task || act?.system) return toast('Los movimientos del historial no se pueden eliminar.', 'error');
    if (act?.leadId && !canEditLeadLocally(act.leadId)) return toast('Solo puedes eliminar actividad de oportunidades asignadas a ti.', 'error');
    if (confirm('¿Eliminar esta actividad?')) {
      if (await deleteActivity(id)) toast('Actividad eliminada.');
    }
  },
  'delete-lead': async (id) => {
    if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
    if (!canEditLeadLocally(id)) return toast('Solo puedes eliminar oportunidades asignadas a ti.', 'error');
    const lead = getLead(id);
    if (!lead) return;
    if (confirm(`¿Eliminar "${lead.company}" con su levantamiento, actividades y cotizaciones?`)) {
      if (!(await deleteLead(id))) return;
      if ($('detailDialog').open) $('detailDialog').close();
      toast('Oportunidad eliminada.');
    }
  },
  'new-template': async () => {
    if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
    const record = await addTemplate(ui.templateChannel || 'both');
    if (!record) return;
    ui.templateOpen = record.id;
    render();
    toast('Plantilla creada. Complétala y guárdala.');
  },
  'save-template': async (id) => {
    if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
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
    if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
    if (!confirm('¿Eliminar esta plantilla?')) return;
    if (state.templates.length <= 1) return toast('Debe quedar al menos una plantilla.', 'error');
    if (await deleteTemplate(id)) toast('Plantilla eliminada.');
  },
  'insert-var': (id, btn) => insertVariable(id, btn.dataset.var),
  'back-to-pipeline': async (id) => {
    if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
    const lead = getLead(id);
    if (!lead) return;
    if (!canEditLeadLocally(lead)) return toast('Solo puedes gestionar oportunidades asignadas a ti.', 'error');
    if (await setStage(id, 'Contactado')) toast(`${lead.company} volvió al embudo comercial.`);
  },
  'save-profile': async () => {
    if (await saveProfile({ name: $('profileName').value.trim(), phone: $('profilePhone').value.trim() })) toast('Datos guardados.');
  },
  'install-pwa': () => installPwa(),
  'refresh-audit': () => hydrateAudit(),
  'change-password': async () => {
    const pass = $('newPassword').value;
    if (pass.length < 6) return toast('La contraseña debe tener al menos 6 caracteres.', 'error');
    const { supabase } = await import('./supabase.js');
    const { error } = await supabase.auth.updateUser({ password: pass });
    if (error) return toast(error.message, 'error');
    $('newPassword').value = '';
    toast('Contraseña actualizada.');
  },
  'sign-out': async () => {
    try {
      await signOut();
    } catch (err) {
      toast(`No se pudo cerrar la sesión: ${err.message}`, 'error');
    }
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
  'quotes-view-list': () => {
    ui.quotesView = 'list';
    render();
  },
  'quotes-view-lists': () => {
    ui.quotesView = 'lists';
    render();
  },
  'view-price-list': (id) => {
    ui.priceListId = id;
    render();
  },
  'import-price-list': () => openPriceImport(),
  'toggle-price-list': async (id) => {
    if (!isAdmin()) return toast(ADMIN_ONLY_LISTS, 'error');
    const list = getPriceList(id);
    if (!list) return;
    const archive = list.status === 'vigente';
    if (archive && !confirm(`¿Archivar "${list.name}"? No se podrá usar en cotizaciones nuevas; las existentes no cambian.`)) return;
    if (await updatePriceList(id, { status: archive ? 'archivada' : 'vigente' })) toast(archive ? 'Lista archivada.' : 'Lista reactivada.');
  },
  'delete-price-list': async (id) => {
    if (!isAdmin()) return toast(ADMIN_ONLY_LISTS, 'error');
    const list = getPriceList(id);
    if (!list) return;
    if (!confirm(`¿Eliminar la lista "${list.name}" con todos sus servicios?`)) return;
    if (await deletePriceList(id)) {
      if (ui.priceListId === id) ui.priceListId = '';
      toast('Lista eliminada.');
    }
  },
  'new-price-item': (id) => openPriceItem(id),
  'edit-price-item': (id) => openPriceItem('', id),
  'delete-price-item': async (id) => {
    if (!isAdmin()) return toast(ADMIN_ONLY_LISTS, 'error');
    const item = getPriceListItem(id);
    if (!item) return;
    if (!confirm(`¿Eliminar "${item.code} · ${item.name}" de la lista?`)) return;
    if (await deletePriceListItem(id)) toast('Servicio eliminado.');
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
    if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
    const quote = getQuote(id);
    if (!quote) return;
    if (!canEditLeadLocally(quote.leadId) || (!isAdmin() && quote.ownerId !== session.user?.id)) {
      return toast('No tienes permiso para eliminar esta versión de la cotización.', 'error');
    }
    if (!confirm('¿Eliminar esta versión de la cotización?')) return;
    if (await deleteQuote(id)) toast('Cotización eliminada.');
  },
  'add-quote-line': () => addQuoteLine(),
  'remove-quote-line': (ref) => {
    const b = ui.quoteBuilder;
    b.items = b.items.filter((it) => it.ref !== ref);
    b.discounts = b.discounts.filter((d) => d.scope !== 'line' || d.itemRef !== ref);
    renderQuoteDiscounts();
    renderQuoteSummary();
    scheduleQuotePreview();
  },
  'add-quote-discount': () => addQuoteDiscount(),
  'remove-quote-discount': (index) => {
    ui.quoteBuilder.discounts.splice(Number(index), 1);
    renderQuoteDiscounts();
    scheduleQuotePreview();
  },
  'refresh-uf': () => loadQuoteUf({ force: true }),
  'quote-builder-pdf': async () => {
    const b = ui.quoteBuilder;
    if (!b?.calc) return toast(b?.calcError || 'Completa la cotización para generar el PDF.', 'error');
    await downloadQuotePdf(builderDoc());
  },
  'quote-pdf': async (id, btn) => {
    const q = getQuote(id || btn?.dataset.id);
    if (q) await downloadQuotePdf(quoteDocFromSaved(q));
  }
};

function dispatchAction(btn) {
  const action = ACTIONS[btn?.dataset.action];
  if (!action || btn.dataset.actionBusy === '1') return;

  let result;
  try {
    result = action(btn.dataset.id, btn);
  } catch (err) {
    console.error('Acción no completada', err);
    toast(err.message || 'No se pudo completar la acción.', 'error');
    return;
  }

  if (!result || typeof result.then !== 'function') return;
  btn.dataset.actionBusy = '1';
  btn.setAttribute('aria-disabled', 'true');
  if ('disabled' in btn) btn.disabled = true;
  Promise.resolve(result)
    .catch((err) => {
      console.error('Acción asíncrona no completada', err);
      toast(err.message || 'No se pudo completar la acción.', 'error');
    })
    .finally(() => {
      if (!btn.isConnected) return;
      delete btn.dataset.actionBusy;
      btn.removeAttribute('aria-disabled');
      if ('disabled' in btn) btn.disabled = false;
    });
}

function handleClick(ev) {
  const btn = ev.target.closest?.('[data-action]');
  if (!btn) return;
  dispatchAction(btn);
}

function handleKeydown(ev) {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  const el = ev.target.closest?.('[data-action][role="button"]');
  if (!el) return;
  ev.preventDefault();
  dispatchAction(el);
}

/* ---------- Controles de vista ---------- */

async function handleViewInput(ev) {
  const el = ev.target;
  const tplId = el.dataset.templateName || el.dataset.templateChannel || el.dataset.templateSubject || el.dataset.templateBody;
  if (tplId) return onTemplateEdit(tplId, el);

  if (el.dataset.userField) {
    if (ev.type !== 'change') return;
    if (!isSuper()) return render();
    const saved = await updateUser(el.dataset.id, { [el.dataset.userField]: el.type === 'checkbox' ? el.checked : el.value });
    if (!saved) render();
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
    quoteStatus: () => (ui.quoteFilters.status = value),
    auditQuery: () => (ui.auditFilters.query = value),
    auditEntity: () => (ui.auditFilters.entity = value),
    auditAction: () => (ui.auditFilters.action = value)
  };
  if (!map[id]) return;
  map[id]();
  render();
}

/* ---------- Auditoría de cambios ---------- */

const auditState = {
  entries: [],
  loading: false,
  schemaReady: true,
  loaded: false
};

const AUDIT_ENTITY_LABEL = {
  leads: 'Oportunidad',
  activities: 'Actividad',
  discoveries: 'Levantamiento',
  quotes: 'Cotización',
  price_lists: 'Lista de precios',
  price_list_items: 'Servicio de lista',
  hyperfocus_campaigns: 'Campaña Híper Foco',
  profiles: 'Usuario'
};

const AUDIT_ACTION_LABEL = {
  insert: 'Creó',
  update: 'Modificó',
  delete: 'Eliminó'
};

function auditSchemaMissing(error) {
  const msg = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return msg.includes('42p01') || msg.includes('pgrst205') || msg.includes('audit_log');
}

async function hydrateAudit() {
  if (!isAdmin()) {
    auditState.entries = [];
    auditState.loaded = false;
    return;
  }

  auditState.loading = true;
  if (ui.view === 'audit') render();

  try {
    const { data, error } = await supabase
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      if (auditSchemaMissing(error)) {
        auditState.schemaReady = false;
        auditState.entries = [];
        auditState.loaded = true;
        return;
      }
      console.error('No se pudo cargar la auditoría', error);
      toast('No se pudo cargar la auditoría.', 'error');
      return;
    }

    auditState.schemaReady = true;
    auditState.entries = data || [];
    auditState.loaded = true;
  } catch (err) {
    console.error('No se pudo cargar la auditoría', err);
    toast('No se pudo cargar la auditoría.', 'error');
  } finally {
    auditState.loading = false;
    if (ui.view === 'audit') render();
  }
}

function auditEntityName(row) {
  const after = row.after_data || {};
  const before = row.before_data || {};
  const data = Object.keys(after).length ? after : before;

  const leadId = row.lead_id || data.lead_id || before.lead_id || after.lead_id || '';
  if (leadId) {
    const lead = getLead(leadId);
    if (lead?.company) return lead.company;
  }

  return data.company || data.name || data.email || data.client_snapshot?.company || row.entity_id || '';
}

function auditValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') {
    const text = JSON.stringify(value);
    return text.length > 180 ? text.slice(0, 177) + '…' : text;
  }
  const text = String(value);
  return text.length > 180 ? text.slice(0, 177) + '…' : text;
}

function auditChangeSummary(row) {
  if (row.action === 'insert') return 'Registro creado';
  if (row.action === 'delete') return 'Registro eliminado';

  const fields = row.changed_fields || [];
  if (!fields.length) return 'Sin campos visibles';
  return fields.slice(0, 6).join(', ') + (fields.length > 6 ? ` +${fields.length - 6}` : '');
}

function auditChangeDetails(row) {
  const fields = row.changed_fields || [];
  if (row.action !== 'update' || !fields.length) {
    return `<span class="muted">${escapeHtml(auditChangeSummary(row))}</span>`;
  }

  const before = row.before_data || {};
  const after = row.after_data || {};

  return `
    <details class="audit-diff">
      <summary>${escapeHtml(auditChangeSummary(row))}</summary>
      <div class="audit-diff-list">
        ${fields.map((field) => `
          <div>
            <strong>${escapeHtml(field)}</strong>
            <span class="audit-before">${escapeHtml(auditValue(before[field]))}</span>
            <span aria-hidden="true">→</span>
            <span class="audit-after">${escapeHtml(auditValue(after[field]))}</span>
          </div>`).join('')}
      </div>
    </details>`;
}

function filteredAuditEntries() {
  const filters = ui.auditFilters;
  const query = normalizeGlobalSearch(filters.query);

  return auditState.entries.filter((row) => {
    if (filters.entity && row.entity_type !== filters.entity) return false;
    if (filters.action && row.action !== filters.action) return false;
    if (!query) return true;

    const searchable = normalizeGlobalSearch([
      row.actor_name,
      AUDIT_ENTITY_LABEL[row.entity_type] || row.entity_type,
      AUDIT_ACTION_LABEL[row.action] || row.action,
      auditEntityName(row),
      ...(row.changed_fields || []),
      JSON.stringify(row.before_data || {}),
      JSON.stringify(row.after_data || {})
    ].join(' '));

    return searchable.includes(query);
  });
}

function renderAudit() {
  if (!isAdmin()) {
    return '<div class="card"><div class="card-body"><div class="empty"><strong>Acceso restringido</strong><p>La auditoría está disponible para administradores.</p></div></div></div>';
  }

  if (!auditState.schemaReady) {
    return '<div class="card"><div class="card-body"><div class="notice warn">Falta aplicar la migración <strong>supabase/0027_audit_log.sql</strong>.</div></div></div>';
  }

  if (auditState.loading && !auditState.loaded) {
    return '<div class="card"><div class="card-body"><div class="empty"><strong>Cargando auditoría…</strong></div></div></div>';
  }

  const rows = filteredAuditEntries();
  const entityOptions = Object.entries(AUDIT_ENTITY_LABEL)
    .map(([value, label]) =>
      `<option value="${escapeHtml(value)}" ${ui.auditFilters.entity === value ? 'selected' : ''}>${escapeHtml(label)}</option>`
    )
    .join('');

  return `
    <div class="card">
      <div class="card-head">
        <div>
          <h3>Auditoría de cambios</h3>
          <div class="muted">Quién cambió qué, cuándo y sobre qué registro.</div>
        </div>
        <button class="small-btn" data-action="refresh-audit">Actualizar</button>
      </div>
      <div class="card-body">
        <div class="toolbar">
          <input id="auditQuery" placeholder="Buscar empresa, usuario, campo o valor…" value="${escapeHtml(ui.auditFilters.query)}" />
          <select id="auditEntity"><option value="">Todas las entidades</option>${entityOptions}</select>
          <select id="auditAction">
            <option value="">Todas las acciones</option>
            <option value="insert" ${ui.auditFilters.action === 'insert' ? 'selected' : ''}>Creó</option>
            <option value="update" ${ui.auditFilters.action === 'update' ? 'selected' : ''}>Modificó</option>
            <option value="delete" ${ui.auditFilters.action === 'delete' ? 'selected' : ''}>Eliminó</option>
          </select>
          <span class="toolbar-summary">${rows.length} de ${auditState.entries.length}</span>
        </div>

        ${rows.length
          ? `<div class="table-wrap"><table class="data-table audit-table">
              <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Registro</th><th>Cambios</th></tr></thead>
              <tbody>
                ${rows.map((row) => `<tr>
                  <td>${escapeHtml(fmtDateTime(row.created_at))}</td>
                  <td>${escapeHtml(row.actor_name || 'Sistema')}</td>
                  <td><span class="badge ${row.action === 'delete' ? 'danger' : row.action === 'insert' ? 'success' : ''}">${escapeHtml(AUDIT_ACTION_LABEL[row.action] || row.action)}</span></td>
                  <td>${escapeHtml(AUDIT_ENTITY_LABEL[row.entity_type] || row.entity_type)}</td>
                  <td>${escapeHtml(auditEntityName(row) || '—')}</td>
                  <td>${auditChangeDetails(row)}</td>
                </tr>`).join('')}
              </tbody>
            </table></div>`
          : '<div class="empty"><strong>Sin resultados</strong><p>No hay movimientos que coincidan con los filtros.</p></div>'}
      </div>
    </div>`;
}

/* ---------- Buscador global ---------- */

let globalSearchGeneration = 0;
let globalSearchTimer = null;

function normalizeGlobalSearch(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es');
}

function localGlobalSearch(term) {
  const needle = normalizeGlobalSearch(term);
  if (!needle) return [];

  const results = [];

  state.leads.forEach((lead) => {
    const contacts = [
      lead.contact, lead.role, lead.email, lead.phone,
      ...(lead.contacts || []).flatMap((contact) => [contact.name, contact.role, contact.email, contact.phone])
    ];

    const searchable = normalizeGlobalSearch([
      lead.company, lead.rut, lead.industry, lead.source, lead.stage, lead.owner,
      lead.notes, lead.nextAction, ...contacts
    ].join(' '));

    if (!searchable.includes(needle)) return;

    results.push({
      key: `lead:${lead.id}`,
      kind: 'Oportunidad',
      title: lead.company,
      meta: [lead.rut ? `RUT ${lead.rut}` : '', lead.stage, lead.owner].filter(Boolean).join(' · '),
      action: 'open-detail',
      id: lead.id
    });
  });

  state.activities.forEach((activity) => {
    if (!activity.leadId) return;
    const searchable = normalizeGlobalSearch([
      activity.company, activity.type, activity.detail, activity.task, activity.owner
    ].join(' '));
    if (!searchable.includes(needle)) return;

    results.push({
      key: `activity:${activity.id}`,
      kind: 'Actividad',
      title: activity.company || 'Actividad',
      meta: [activity.type, activity.detail].filter(Boolean).join(' · '),
      action: 'open-detail',
      id: activity.leadId
    });
  });

  quoteState.quotes.forEach((quote) => {
    const lead = getLead(quote.leadId);
    const client = quote.client || {};
    const searchable = normalizeGlobalSearch([
      lead?.company, lead?.rut, client.company, client.rut, client.email,
      client.phone, client.contact, quote.number, quote.notes, quote.status, quote.total
    ].join(' '));
    if (!searchable.includes(needle)) return;

    results.push({
      key: `quote:${quote.id}`,
      kind: 'Cotización',
      title: `${lead?.company || client.company || 'Cotización'} · ${quote.number || ''} v${quote.version}`,
      meta: `${quote.status || 'Sin estado'} · ${fmtCurrency(quote.total, quote.currency)}`,
      action: 'view-quote',
      id: quote.id
    });
  });

  return results.slice(0, 18);
}

async function hyperFocusGlobalSearch(term, generation) {
  const value = String(term || '').trim();
  if (value.length < 3) return [];

  try {
    const [companyR, rutR] = await Promise.all([
      supabase
        .from('hyperfocus_records')
        .select('id,company,rut,status,existing_lead_id')
        .ilike('company', `%${value}%`)
        .limit(6),
      supabase
        .from('hyperfocus_records')
        .select('id,company,rut,status,existing_lead_id')
        .ilike('rut', `%${value}%`)
        .limit(6)
    ]);

    if (generation !== globalSearchGeneration) return null;
    if (companyR.error && rutR.error) return [];

    const unique = new Map();
    [...(companyR.data || []), ...(rutR.data || [])].forEach((row) => unique.set(row.id, row));

    return [...unique.values()].slice(0, 8).map((row) => ({
      key: `hf:${row.id}`,
      kind: 'Híper Foco',
      title: row.company,
      meta: [row.rut ? `RUT ${row.rut}` : '', row.status].filter(Boolean).join(' · '),
      action: row.existing_lead_id ? 'open-detail' : '',
      id: row.existing_lead_id || '',
      view: row.existing_lead_id ? '' : 'hyperfocus'
    }));
  } catch (err) {
    console.error('Búsqueda Híper Foco no disponible', err);
    return generation === globalSearchGeneration ? [] : null;
  }
}

function renderGlobalSearchResults(localRows, remoteRows = [], { loading = false } = {}) {
  const root = $('globalSearchResults');
  if (!root) return;

  const rows = [...localRows, ...(remoteRows || [])];
  if (!rows.length && loading) {
    root.innerHTML = '<div class="empty"><strong>Buscando también en Híper Foco…</strong></div>';
    return;
  }

  if (!rows.length) {
    root.innerHTML = '<div class="empty"><strong>Sin resultados</strong><p>Prueba con empresa, RUT, teléfono, correo o contacto.</p></div>';
    return;
  }

  root.innerHTML = rows.map((row) => {
    const attrs = row.action
      ? `data-action="${escapeHtml(row.action)}" data-id="${escapeHtml(row.id)}"`
      : `data-search-view="${escapeHtml(row.view || '')}"`;

    return `<button type="button" class="global-search-result" ${attrs}>
      <span class="global-search-kind">${escapeHtml(row.kind)}</span>
      <strong>${escapeHtml(row.title)}</strong>
      <span>${escapeHtml(row.meta || '')}</span>
    </button>`;
  }).join('');
}

async function runGlobalSearch() {
  const input = $('globalSearchInput');
  if (!input) return;

  const term = input.value.trim();
  const generation = ++globalSearchGeneration;

  if (!term) {
    $('globalSearchResults').innerHTML =
      '<div class="empty"><strong>Busca en todo TaskFlow</strong><p>Empresa, RUT, contacto, teléfono, correo, actividad o cotización.</p></div>';
    return;
  }

  const localRows = localGlobalSearch(term);
  renderGlobalSearchResults(localRows, [], { loading: term.length >= 3 });

  if (term.length < 3) return;

  const remoteRows = await hyperFocusGlobalSearch(term, generation);
  if (remoteRows === null || generation !== globalSearchGeneration) return;
  renderGlobalSearchResults(localRows, remoteRows);
}

function openGlobalSearch() {
  const dialog = $('globalSearchDialog');
  if (!dialog) return;
  dialog.showModal();
  $('globalSearchInput').focus();
  runGlobalSearch();
}

function bindGlobalSearch() {
  const button = $('globalSearchBtn');
  const input = $('globalSearchInput');
  const dialog = $('globalSearchDialog');
  if (!button || !input || !dialog) return;

  button.addEventListener('click', openGlobalSearch);
  input.addEventListener('input', () => {
    clearTimeout(globalSearchTimer);
    globalSearchTimer = setTimeout(runGlobalSearch, 160);
  });

  dialog.addEventListener('click', (ev) => {
    if (ev.target === dialog) {
      dialog.close();
      return;
    }

    const result = ev.target.closest?.('.global-search-result');
    if (!result) return;

    if (result.dataset.searchView) {
      document.querySelector(`.nav-item[data-view="${result.dataset.searchView}"]`)?.click();
    }
    dialog.close();
  });

  document.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLocaleLowerCase() === 'k') {
      ev.preventDefault();
      openGlobalSearch();
    }
  });
}

/* ---------- Notificaciones internas ---------- */

function latestActivityByLead() {
  const map = new Map();
  state.activities.forEach((activity) => {
    if (!activity.leadId || !activity.date) return;
    const current = map.get(activity.leadId);
    if (!current || String(activity.date) > String(current)) map.set(activity.leadId, activity.date);
  });
  return map;
}

function notificationItems() {
  const today = todayISO();
  const soon = addDaysISO(today, 3);
  const tasks = openTasks();
  const open = metrics().open;
  const lastActivity = latestActivityByLead();
  const items = [];

  tasks.filter((task) => !task.date || task.date < today).forEach((task) => {
    items.push({
      priority: 1,
      type: 'Vencida',
      title: task.lead.company,
      detail: task.title + (task.date ? ` · ${fmtDate(task.date)}` : ' · sin fecha'),
      action: 'open-detail',
      id: task.lead.id
    });
  });

  tasks.filter((task) => task.date === today).forEach((task) => {
    items.push({
      priority: 2,
      type: 'Hoy',
      title: task.lead.company,
      detail: task.title,
      action: 'open-detail',
      id: task.lead.id
    });
  });

  open.filter((lead) => !taskOf(lead)).forEach((lead) => {
    items.push({
      priority: 3,
      type: 'Sin próxima acción',
      title: lead.company,
      detail: [lead.stage, lead.owner].filter(Boolean).join(' · '),
      action: 'open-detail',
      id: lead.id
    });
  });

  open.forEach((lead) => {
    const last = lastActivity.get(lead.id) || lead.updatedAt || lead.createdAt;
    const timestamp = new Date(last).getTime();
    const days = Number.isFinite(timestamp) ? Math.floor((Date.now() - timestamp) / 86400000) : 0;
    if (days <= 14) return;

    items.push({
      priority: 4,
      type: 'Estancada',
      title: lead.company,
      detail: `${days} días sin movimiento`,
      action: 'open-detail',
      id: lead.id
    });
  });

  quoteState.quotes
    .filter((quote) => quote.isCurrent && quote.validUntil && !['aceptada', 'rechazada'].includes(quote.status))
    .filter((quote) => quote.validUntil <= soon)
    .forEach((quote) => {
      const lead = getLead(quote.leadId);
      items.push({
        priority: quote.validUntil < today ? 1 : 3,
        type: quote.validUntil < today ? 'Cotización vencida' : 'Cotización por vencer',
        title: lead?.company || quote.client?.company || 'Cotización',
        detail: `${quote.number || ''} v${quote.version} · ${fmtCurrency(quote.total, quote.currency)} · válida hasta ${fmtDate(quote.validUntil)}`,
        action: 'view-quote',
        id: quote.id
      });
    });

  const unique = new Map();
  items.forEach((item) => {
    const key = [item.type, item.id, item.detail].join('|');
    if (!unique.has(key)) unique.set(key, item);
  });

  return [...unique.values()].sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title, 'es'));
}

function renderNotifications() {
  const root = $('notificationBody');
  if (!root) return;

  const items = notificationItems();
  if (!items.length) {
    root.innerHTML = '<div class="empty"><strong>Todo al día</strong><p>No hay seguimientos que requieran atención.</p></div>';
    return;
  }

  root.innerHTML = `
    <div class="notification-summary">${items.length.toLocaleString('es-CL')} pendiente${items.length === 1 ? '' : 's'}</div>
    <div class="notification-list">
      ${items.slice(0, 40).map((item) => `
        <button type="button" class="notification-item" data-action="${escapeHtml(item.action)}" data-id="${escapeHtml(item.id)}">
          <span class="badge ${item.priority === 1 ? 'danger' : item.priority === 2 ? 'warning' : ''}">${escapeHtml(item.type)}</span>
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.detail)}</span>
        </button>`).join('')}
    </div>
    ${items.length > 40 ? '<p class="muted notification-more">Se muestran los 40 pendientes más prioritarios.</p>' : ''}`;
}

function refreshNotificationBadge() {
  const badge = $('notificationBadge');
  if (!badge) return;
  const count = notificationItems().length;
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.hidden = count === 0;
  if ($('notificationDialog')?.open) renderNotifications();
}

function openNotifications() {
  renderNotifications();
  $('notificationDialog')?.showModal();
}

function bindNotifications() {
  const button = $('notificationBtn');
  const dialog = $('notificationDialog');
  if (!button || !dialog) return;

  button.addEventListener('click', openNotifications);
  dialog.addEventListener('click', (ev) => {
    if (ev.target === dialog) {
      dialog.close();
      return;
    }
    if (ev.target.closest?.('.notification-item')) dialog.close();
  });

  refreshNotificationBadge();
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
  reader.onload = async () => {
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

async function resetAll() {
  if (!isAdmin()) return toast('Solo un administrador puede ejecutar el borrado masivo.', 'error');
  if (!confirm('Se borrarán todas las oportunidades que puedes ver (según tu permiso). Esta acción no se puede deshacer. ¿Continuar?')) return;
  const result = await deleteAllVisibleLeads();
  if (!result.failed) return toast(`${result.deleted} oportunidad(es) eliminada(s).`);
  toast(`Borrado parcial: ${result.deleted} eliminada(s) y ${result.failed} no eliminada(s).`, 'error');
}

async function seedExample() {
  if (!isAdmin()) return toast('Solo un administrador puede cargar datos de demostración.', 'error');
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
  try {
    for (const x of base) {
      const lead = await upsertLeadConfirmed({ rut: '', notes: '', owner: ownerName, nextDate: todayISO(), expectedCloseDate: '', ...x });
      created[x.company] = lead;
    }
  } catch {
    toast('La carga demo quedó incompleta. Revisa los registros creados antes de reintentar.', 'error');
    return;
  }

  const discoveryA = await saveDiscovery(created['ClimaSur Servicios'].id, {
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
  const discoveryB = await saveDiscovery(created['TecnoFrío Ltda.'].id, {
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
  if (!discoveryA || !discoveryB) {
    toast('La carga demo quedó incompleta al guardar los levantamientos. Revisa los datos antes de reintentar.', 'error');
    return;
  }

  const tasks = [
    ['ClimaSur Servicios', 'Correo', 'Enviar agenda de demo con casos de preventivos', addDaysISO(todayISO(), -3)],
    ['VerticalTech', 'Llamada', 'Revisar observaciones de la propuesta', addDaysISO(todayISO(), -1)],
    ['Hidráulica Centro', 'Llamada', 'Confirmar condiciones comerciales', todayISO()],
    ['PowerGen Chile', 'WhatsApp', 'Coordinar reunión de descubrimiento', addDaysISO(todayISO(), 1)],
    ['Refrigeración Austral', 'Llamada', 'Primer contacto', addDaysISO(todayISO(), 4)],
    ['Montajes del Maipo', 'Correo', 'Validar tamaño de cuadrilla', addDaysISO(todayISO(), 9)]
  ];
  for (const [name, type, action, date] of tasks) {
    if (!(await updateLead(created[name].id, { nextType: type, nextAction: action, nextDate: date }))) {
      toast('La carga demo quedó incompleta al programar tareas. Revisa los datos antes de reintentar.', 'error');
      return;
    }
  }

  if (!(await addActivityConfirmed({
    leadId: created['ClimaSur Servicios'].id,
    type: 'Reunión',
    date: localDateTimeInput(new Date(Date.now() - 4 * 86400000)),
    owner: ownerName,
    detail: 'Levantamiento inicial con jefatura de mantenimiento.'
  }))) return toast('La carga demo quedó incompleta al registrar actividades.', 'error');
  if (!(await addActivityConfirmed({
    leadId: created['TecnoFrío Ltda.'].id,
    type: 'Demo',
    date: localDateTimeInput(new Date(Date.now() - 2 * 86400000)),
    owner: ownerName,
    detail: 'Mostraron interés en checklists y firma digital. Aprueban avanzar.',
    task: 'Presentar demo de checklists al equipo técnico'
  }))) return toast('La carga demo quedó incompleta al registrar actividades.', 'error');

  await hydrate();
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

function bindSubmitOnce(formId, handler) {
  const form = $(formId);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (form.dataset.submitting === '1') return;
    form.dataset.submitting = '1';
    const btn = ev.submitter || form.querySelector('[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      await handler(ev);
    } catch (err) {
      console.error(`No se pudo completar ${formId}`, err);
      toast(err.message || 'No se pudo completar la operación.', 'error');
    } finally {
      delete form.dataset.submitting;
      if (btn?.isConnected) btn.disabled = false;
    }
  });
}

function bindEvents() {
  $$('.nav-item').forEach((btn) =>
    btn.addEventListener('click', () => {
      ui.view = btn.dataset.view;
      $$('.nav-item').forEach((x) => x.classList.toggle('active', x === btn));
      render();
      if (ui.view === 'audit' && isAdmin()) hydrateAudit();
    })
  );

  $('dataBtn').addEventListener('click', openDataDialog);
  $('syncStatus').addEventListener('click', openDataDialog);
  bindGlobalSearch();
  bindNotifications();

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

  bindSubmitOnce('leadForm', submitLead);
  $('stage').addEventListener('change', toggleLossField);
  bindSubmitOnce('discoveryForm', submitDiscovery);
  bindSubmitOnce('activityForm', submitActivity);
  $('activityLeadId').addEventListener('change', (ev) => {
    fillActivityContacts(ev.target.value);
    $('activityOwner').value = getLead(ev.target.value)?.owner || session.profile?.name || '';
    syncActivityFollowup(ev.target.value, Boolean($('activityId').value));
  });
  $('activityFollowupMode').addEventListener('change', syncActivityFollowupFields);
  $('activityDate').addEventListener('input', () => markActivityDatePreset('custom'));
  bindSubmitOnce('contactForm', submitContact);
  bindSubmitOnce('commForm', submitComm);
  $('commTemplate').addEventListener('change', fillCommFields);
  $('commCopyBtn').addEventListener('click', copyComm);
  bindSubmitOnce('completeForm', submitComplete);
  bindSubmitOnce('taskForm', submitTask);
  $('manageForm').addEventListener('submit', submitManage);
  $('managePrevBtn').addEventListener('click', () => manageStep(-1));
  $('manageNextBtn').addEventListener('click', () => manageStep(1));
  $('manageRescheduleBtn').addEventListener('click', () => {
    const task = currentTask();
    if (task) openTask(task.lead.id);
  });
  bindSubmitOnce('stageForm', submitStage);
  $('stageOptions').addEventListener('change', updateStageFields);
  $('exportBtn').addEventListener('click', exportJson);
  $('exportCsvBtn').addEventListener('click', exportCsv);
  $('importInput').addEventListener('change', importJson);
  $('resetBtn').addEventListener('click', resetAll);

  bindSubmitOnce('priceImportForm', submitPriceImport);
  $('priceImportFile').addEventListener('change', handlePriceImportFile);
  $('priceImportCurrency').addEventListener('change', renderPriceImportPreview);
  $('priceImportName').addEventListener('input', () => {
    $('priceImportSubmit').disabled = !priceImport.items.length || priceImport.errors.length > 0 || !$('priceImportName').value.trim();
  });
  bindSubmitOnce('priceItemForm', submitPriceItem);
  bindSubmitOnce('quoteForm', submitQuoteBuilder);
  $('quoteForm').addEventListener('input', handleQuoteFormChange);
  $('quoteForm').addEventListener('change', handleQuoteFormChange);
  bindSubmitOnce('quoteSendForm', submitQuoteSend);

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

let authSyncGeneration = 0;

async function start() {
  document.title = `${CFG.appName} · ${CFG.companyName}`;
  initPwa();
  fillStaticSelects();
  buildTaskTypeGroups();
  initHyperFocusUI();
  bindEvents();
  renderAuthMode();

  onChange(() => {
    render();
    refreshDetailIfOpen();
    refreshNotificationBadge();
  });
  onQuotesChange(() => {
    if (ui.view === 'quotes') render();
    refreshDetailIfOpen();
    refreshNotificationBadge();
  });
  onHyperFocusChange(() => {
    if (ui.view === 'hyperfocus') render();
  });

  onAuthChange(async (s) => {
    const generation = ++authSyncGeneration;
    if (s.status === 'signed-in') {
      $('authScreen').hidden = true;
      $('appShell').hidden = false;
      if ($('auditNav')) $('auditNav').hidden = !isAdmin();
      paintSync({ state: 'syncing', message: 'Cargando datos…' });
      try {
        await Promise.all([hydrate(), quotesHydrate(), hyperFocusHydrate()]);
        if (generation !== authSyncGeneration || session.status !== 'signed-in') {
          // Una hidratación iniciada por una sesión anterior no puede volver a
          // poblar el estado local ni reactivar Realtime después de cerrar sesión.
          stopRealtime();
          quotesStopRealtime();
          hyperFocusStopRealtime();
          clearLocal();
          quotesClearLocal();
          hyperFocusClearLocal();
          return;
        }
        startRealtime();
        quotesStartRealtime();
        hyperFocusStartRealtime();
        refreshNotificationBadge();
        paintSync({ state: 'ok', message: 'Conectado' });
      } catch (err) {
        if (generation !== authSyncGeneration) return;
        paintSync({ state: 'error', message: `Sin conexión: ${err.message}` });
      }
      if (generation === authSyncGeneration) render();
    } else if (s.status === 'profile-error') {
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
      $('authError').textContent = s.error?.message || 'No se pudo cargar tu perfil. Revisa la conexión e intenta entrar nuevamente.';
      $('authError').hidden = false;
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
  try {
    await initAuth();
  } catch (err) {
    // Un fallo de getSession no debe dejar la aplicación detenida en el estado
    // inicial sin ninguna explicación ni posibilidad de volver a autenticarse.
    $('appShell').hidden = true;
    $('authScreen').hidden = false;
    authMode = 'signin';
    renderAuthMode();
    toast(`No se pudo comprobar la sesión: ${err.message}`, 'error');
  }
}

start();
