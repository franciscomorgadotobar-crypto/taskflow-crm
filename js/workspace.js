import { metrics, openTasks, state as crmState, taskOf } from './store.js';
import { state as quoteState } from './quotes.js';
import { supabase } from './supabase.js';
import { addDaysISO, escapeHtml as e, fmtDate, fmtMoney, todayISO } from './utils.js';

let bound = false;
let remoteGeneration = 0;

const byId = (id) => document.getElementById(id);
const q = (sel, root = document) => root.querySelector(sel);

const normalize = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es');

function dialogsMarkup() {
  return `
    <dialog id="globalSearchDialog" class="modal workspace-dialog">
      <div class="modal-card workspace-card">
        <div class="modal-head">
          <div><h2>Buscar en TaskFlow</h2><p>Empresas, RUT, contactos, actividades, cotizaciones e Híper Foco.</p></div>
          <button type="button" class="icon-btn" data-workspace-close="globalSearchDialog" aria-label="Cerrar">×</button>
        </div>
        <div class="workspace-search-box">
          <input id="globalSearchInput" autocomplete="off" placeholder="Empresa, RUT, teléfono, correo, contacto…" />
          <span class="muted">Ctrl/⌘ + K</span>
        </div>
        <div id="globalSearchResults" class="workspace-results"></div>
      </div>
    </dialog>

    <dialog id="notificationDialog" class="modal workspace-dialog notification-dialog">
      <div class="modal-card workspace-card">
        <div class="modal-head">
          <div><h2>Notificaciones</h2><p>Seguimientos comerciales que requieren atención.</p></div>
          <button type="button" class="icon-btn" data-workspace-close="notificationDialog" aria-label="Cerrar">×</button>
        </div>
        <div id="notificationBody" class="notification-body"></div>
      </div>
    </dialog>`;
}

function topActionsMarkup() {
  return `
    <button id="globalSearchBtn" type="button" class="top-action-btn" title="Buscar en TaskFlow">
      <span aria-hidden="true">⌕</span><span class="top-action-label">Buscar</span>
    </button>
    <button id="notificationBtn" type="button" class="top-action-btn notification-btn" title="Notificaciones">
      <span aria-hidden="true">◉</span>
      <span class="top-action-label">Alertas</span>
      <span id="notificationBadge" class="notification-badge" hidden>0</span>
    </button>`;
}

function localSearch(term) {
  const needle = normalize(term);
  if (!needle) return [];
  const results = [];

  crmState.leads.forEach((lead) => {
    const contacts = [
      lead.contact, lead.role, lead.email, lead.phone,
      ...(lead.contacts || []).flatMap((c) => [c.name, c.role, c.email, c.phone])
    ];
    const text = normalize([
      lead.company, lead.rut, lead.industry, lead.source, lead.stage, lead.owner,
      lead.notes, ...contacts
    ].join(' '));
    if (text.includes(needle)) {
      results.push({
        key: 'lead:' + lead.id,
        kind: 'Oportunidad',
        title: lead.company,
        meta: [lead.rut ? 'RUT ' + lead.rut : '', lead.stage, lead.owner].filter(Boolean).join(' · '),
        action: `data-action="open-detail" data-id="${e(lead.id)}"`
      });
    }
  });

  crmState.activities.forEach((activity) => {
    const text = normalize([activity.company, activity.type, activity.detail, activity.task, activity.owner].join(' '));
    if (!text.includes(needle) || !activity.leadId) return;
    results.push({
      key: 'activity:' + activity.id,
      kind: 'Actividad',
      title: activity.company || 'Actividad',
      meta: [activity.type, activity.detail].filter(Boolean).join(' · '),
      action: `data-action="open-detail" data-id="${e(activity.leadId)}"`
    });
  });

  quoteState.quotes.forEach((quote) => {
    const lead = crmState.leads.find((x) => x.id === quote.leadId);
    const text = normalize([
      lead?.company, lead?.rut, quote.client?.company, quote.client?.rut,
      quote.client?.email, quote.notes, quote.status, quote.total
    ].join(' '));
    if (!text.includes(needle)) return;
    results.push({
      key: 'quote:' + quote.id,
      kind: 'Cotización',
      title: `${lead?.company || quote.client?.company || 'Cotización'} · v${quote.version}`,
      meta: `${quote.status} · ${fmtMoney(quote.total)}`,
      action: `data-action="view-quote" data-id="${e(quote.id)}"`
    });
  });

  return results.slice(0, 18);
}

async function remoteHyperFocusSearch(term) {
  const value = String(term || '').trim();
  if (value.length < 3) return [];

  const generation = ++remoteGeneration;
  const [companyR, rutR] = await Promise.all([
    supabase
      .from('hyperfocus_records')
      .select('id,campaign_id,company,rut,status,existing_lead_id')
      .ilike('company', `%${value}%`)
      .limit(6),
    supabase
      .from('hyperfocus_records')
      .select('id,campaign_id,company,rut,status,existing_lead_id')
      .ilike('rut', `%${value}%`)
      .limit(6)
  ]);

  if (generation !== remoteGeneration) return null;
  if (companyR.error && rutR.error) return [];

  const byIdMap = new Map();
  [...(companyR.data || []), ...(rutR.data || [])].forEach((row) => byIdMap.set(row.id, row));

  return [...byIdMap.values()].slice(0, 8).map((row) => ({
    key: 'hf:' + row.id,
    kind: 'Híper Foco',
    title: row.company,
    meta: [row.rut ? 'RUT ' + row.rut : '', row.status].filter(Boolean).join(' · '),
    action: row.existing_lead_id
      ? `data-action="open-detail" data-id="${e(row.existing_lead_id)}"`
      : 'data-workspace-view="hyperfocus"'
  }));
}

function renderSearchResults(local, remote = [], loading = false) {
  const root = byId('globalSearchResults');
  if (!root) return;

  const all = [...local, ...(remote || [])];
  if (!all.length && loading) {
    root.innerHTML = '<div class="empty"><strong>Buscando…</strong></div>';
    return;
  }
  if (!all.length) {
    root.innerHTML = '<div class="empty"><strong>Sin resultados</strong><p>Prueba con empresa, RUT, teléfono, correo o contacto.</p></div>';
    return;
  }

  root.innerHTML = all.map((row) => `
    <button type="button" class="workspace-result" ${row.action}>
      <span class="workspace-result-kind">${e(row.kind)}</span>
      <strong>${e(row.title)}</strong>
      <span>${e(row.meta || '')}</span>
    </button>`).join('');
}

async function runSearch() {
  const input = byId('globalSearchInput');
  const term = input?.value.trim() || '';
  if (!term) {
    byId('globalSearchResults').innerHTML = '<div class="empty"><strong>Busca en todo el CRM</strong><p>Escribe al menos parte de un nombre, RUT, teléfono o correo.</p></div>';
    return;
  }

  const local = localSearch(term);
  renderSearchResults(local, [], term.length >= 3);
  if (term.length < 3) return;

  const remote = await remoteHyperFocusSearch(term);
  if (remote === null) return;
  renderSearchResults(local, remote, false);
}

function latestActivityByLead() {
  const map = new Map();
  crmState.activities.forEach((activity) => {
    if (!activity.leadId || !activity.date) return;
    const current = map.get(activity.leadId);
    if (!current || String(activity.date) > String(current)) map.set(activity.leadId, activity.date);
  });
  return map;
}

export function notificationItems() {
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
      detail: task.title + (task.date ? ' · ' + fmtDate(task.date) : ' · sin fecha'),
      action: `data-action="open-detail" data-id="${e(task.lead.id)}"`
    });
  });

  tasks.filter((task) => task.date === today).forEach((task) => {
    items.push({
      priority: 2,
      type: 'Hoy',
      title: task.lead.company,
      detail: task.title,
      action: `data-action="open-detail" data-id="${e(task.lead.id)}"`
    });
  });

  open.filter((lead) => !taskOf(lead)).forEach((lead) => {
    items.push({
      priority: 3,
      type: 'Sin próxima acción',
      title: lead.company,
      detail: lead.stage + (lead.owner ? ' · ' + lead.owner : ''),
      action: `data-action="open-detail" data-id="${e(lead.id)}"`
    });
  });

  open.forEach((lead) => {
    const last = lastActivity.get(lead.id) || lead.updatedAt || lead.createdAt;
    const days = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
    if (Number.isFinite(days) && days > 14) {
      items.push({
        priority: 4,
        type: 'Estancada',
        title: lead.company,
        detail: days + ' días sin movimiento',
        action: `data-action="open-detail" data-id="${e(lead.id)}"`
      });
    }
  });

  quoteState.quotes
    .filter((quote) => quote.isCurrent && quote.validUntil && !['aceptada', 'rechazada'].includes(quote.status))
    .filter((quote) => quote.validUntil <= soon)
    .forEach((quote) => {
      const lead = crmState.leads.find((x) => x.id === quote.leadId);
      items.push({
        priority: quote.validUntil < today ? 1 : 3,
        type: quote.validUntil < today ? 'Cotización vencida' : 'Cotización por vencer',
        title: lead?.company || quote.client?.company || 'Cotización',
        detail: `v${quote.version} · ${fmtMoney(quote.total)} · válida hasta ${fmtDate(quote.validUntil)}`,
        action: `data-action="view-quote" data-id="${e(quote.id)}"`
      });
    });

  const unique = new Map();
  items.forEach((item) => {
    const key = [item.type, item.title, item.detail].join('|');
    if (!unique.has(key)) unique.set(key, item);
  });

  return [...unique.values()].sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title, 'es'));
}

function renderNotifications() {
  const root = byId('notificationBody');
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
        <button type="button" class="notification-item" ${item.action}>
          <span class="badge ${item.priority === 1 ? 'danger' : item.priority === 2 ? 'warning' : ''}">${e(item.type)}</span>
          <strong>${e(item.title)}</strong>
          <span>${e(item.detail)}</span>
        </button>`).join('')}
    </div>
    ${items.length > 40 ? '<p class="muted notification-more">Se muestran los 40 pendientes más prioritarios.</p>' : ''}`;
}

export function refreshWorkspace() {
  const badge = byId('notificationBadge');
  if (!badge) return;
  const count = notificationItems().length;
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.hidden = count === 0;
  if (byId('notificationDialog')?.open) renderNotifications();
}

function openSearch() {
  const dialog = byId('globalSearchDialog');
  if (!dialog) return;
  dialog.showModal();
  byId('globalSearchInput').focus();
  runSearch();
}

function openNotifications() {
  renderNotifications();
  byId('notificationDialog')?.showModal();
}

export function initWorkspace() {
  if (bound) return;
  bound = true;

  const top = q('.top-actions');
  if (top) top.innerHTML = topActionsMarkup();

  const wrap = document.createElement('div');
  wrap.innerHTML = dialogsMarkup();
  while (wrap.firstElementChild) document.body.appendChild(wrap.firstElementChild);

  byId('globalSearchBtn')?.addEventListener('click', openSearch);
  byId('notificationBtn')?.addEventListener('click', openNotifications);

  let timer = null;
  byId('globalSearchInput')?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(runSearch, 180);
  });

  document.addEventListener('click', (ev) => {
    const close = ev.target.closest?.('[data-workspace-close]');
    if (close) {
      byId(close.dataset.workspaceClose)?.close();
      return;
    }

    const result = ev.target.closest?.('.workspace-result, .notification-item');
    if (result) {
      if (result.dataset.workspaceView) {
        q(`.nav-item[data-view="${result.dataset.workspaceView}"]`)?.click();
      }
      byId('globalSearchDialog')?.close();
      byId('notificationDialog')?.close();
    }
  });

  document.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLocaleLowerCase() === 'k') {
      ev.preventDefault();
      openSearch();
    }
  });

  refreshWorkspace();
}
