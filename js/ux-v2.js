/* TaskFlow CRM · UX/UI V2
   Enhancement layer: mantiene intacta la lógica de app.js/store.js. */
import { state, onChange, openTasks, metrics } from './store.js';
import { session, onAuthChange, signOut } from './auth.js';

const $ = (id) => document.getElementById(id);
const q = (sel, root = document) => root.querySelector(sel);
const qa = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const todayISO = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const money = (n) => new Intl.NumberFormat('es-CL', {
  style: 'currency', currency: 'CLP', maximumFractionDigits: 0
}).format(Number(n || 0));

const initials = (name = '') => {
  const clean = name.trim();
  if (!clean) return 'TF';
  return clean.split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase() || '').join('');
};

const roleLabel = (role) => ({ super: 'Superadmin', admin: 'Administrador', comercial: 'Comercial', visita: 'Visita' }[role] || role || 'Usuario');

function currentName() {
  return state.me?.name || session.profile?.name || session.user?.email?.split('@')[0] || 'Usuario';
}

function currentEmail() {
  return session.user?.email || state.me?.email || '';
}

/* ---------- Navegación ---------- */
function decorateNavigation() {
  const nav = $('nav');
  if (!nav || nav.dataset.v2 === '1') return;
  nav.dataset.v2 = '1';

  const labels = [
    ['dashboard', 'General'],
    ['leads', 'Comercial'],
    ['implementation', 'Operación'],
    ['settings', 'Sistema']
  ];
  labels.forEach(([view, text]) => {
    const item = q(`.nav-item[data-view="${view}"]`, nav);
    if (!item) return;
    const label = document.createElement('span');
    label.className = 'v2-nav-label';
    label.textContent = text;
    nav.insertBefore(label, item);
  });

  const pipeline = q('.nav-item[data-view="pipeline"]', nav);
  if (pipeline) pipeline.textContent = 'Pipeline';
}

function gotoView(view) {
  q(`.nav-item[data-view="${view}"]`)?.click();
}

/* ---------- Header ---------- */
function buildHeaderTools() {
  const actions = q('.top-actions');
  if (!actions || actions.dataset.v2 === '1') return;
  actions.dataset.v2 = '1';
  actions.innerHTML = `
    <div class="v2-global-tools">
      <div class="v2-search-wrap">
        <span class="v2-search-icon" aria-hidden="true">⌕</span>
        <input id="v2GlobalSearch" class="v2-search" type="search" placeholder="Buscar empresa, contacto, RUT..." autocomplete="off" />
        <span class="v2-search-shortcut">⌘K</span>
        <div id="v2SearchResults" class="v2-search-results" hidden></div>
      </div>
      <button class="primary-btn v2-new-lead" type="button" data-action="new-lead">+ Nuevo lead</button>
      <div class="v2-user-wrap">
        <button id="v2UserBtn" class="v2-user-btn" type="button" aria-haspopup="menu" aria-expanded="false">
          <span id="v2Avatar" class="v2-avatar">TF</span>
          <span class="v2-user-copy"><strong id="v2UserName">Usuario</strong><span id="v2UserRole">CRM</span></span>
          <span aria-hidden="true">⌄</span>
        </button>
        <div id="v2UserMenu" class="v2-user-menu" role="menu" hidden>
          <div class="v2-menu-profile"><strong id="v2MenuName">Usuario</strong><span id="v2MenuEmail"></span></div>
          <button class="v2-menu-item" type="button" data-v2-action="profile"><span>Mi cuenta</span><span>›</span></button>
          <button class="v2-menu-item" type="button" data-v2-action="data"><span>Datos y respaldo</span><span>›</span></button>
          <button class="v2-menu-item" type="button" data-v2-action="theme"><span>Cambiar apariencia</span><span>◐</span></button>
          <button class="v2-menu-item danger" type="button" data-v2-action="signout"><span>Cerrar sesión</span><span>↗</span></button>
          <div id="v2SystemLine" class="v2-system-line"><span class="v2-system-dot"></span><span id="v2SystemText">Estado del sistema</span></div>
        </div>
      </div>
    </div>`;

  $('v2GlobalSearch')?.addEventListener('input', renderSearchResults);
  $('v2GlobalSearch')?.addEventListener('focus', renderSearchResults);
  $('v2UserBtn')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggleUserMenu();
  });
  $('v2UserMenu')?.addEventListener('click', handleMenuAction);
  updateHeaderIdentity();
  updateSystemStatus();
}

function updateHeaderIdentity() {
  const name = currentName();
  const role = roleLabel(state.me?.role || session.profile?.role);
  if ($('v2Avatar')) $('v2Avatar').textContent = initials(name);
  if ($('v2UserName')) $('v2UserName').textContent = name;
  if ($('v2UserRole')) $('v2UserRole').textContent = role;
  if ($('v2MenuName')) $('v2MenuName').textContent = name;
  if ($('v2MenuEmail')) $('v2MenuEmail').textContent = currentEmail();
}

function toggleUserMenu(force) {
  const menu = $('v2UserMenu');
  const btn = $('v2UserBtn');
  if (!menu || !btn) return;
  const open = force ?? menu.hidden;
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
}

async function handleMenuAction(ev) {
  const btn = ev.target.closest('[data-v2-action]');
  if (!btn) return;
  const action = btn.dataset.v2Action;
  toggleUserMenu(false);
  if (action === 'profile') gotoView('settings');
  if (action === 'data') $('dataBtn')?.click();
  if (action === 'theme') $('themeToggle')?.click();
  if (action === 'signout') await signOut();
}

function updateSystemStatus() {
  const hiddenStatus = $('syncStatus');
  const text = $('syncStatusText')?.textContent || 'Estado del sistema';
  const line = $('v2SystemLine');
  if (!line) return;
  line.dataset.state = hiddenStatus?.dataset.state || '';
  if ($('v2SystemText')) {
    const friendly = text === 'Conectado' ? 'Sistema operativo' : text;
    $('v2SystemText').textContent = friendly;
  }
}

/* ---------- Búsqueda global ---------- */
function contactStrings(lead) {
  const values = [lead.contact, lead.role, lead.email, lead.phone];
  const extra = Array.isArray(lead.contacts) ? lead.contacts : [];
  extra.forEach((c) => values.push(c?.name, c?.role, c?.email, c?.phone));
  return values.filter(Boolean);
}

function searchLeads(term) {
  const needle = term.trim().toLocaleLowerCase('es');
  if (!needle) return [];
  return state.leads
    .map((lead) => {
      const fields = [lead.company, lead.rut, lead.industry, lead.source, lead.stage, lead.owner, ...contactStrings(lead)]
        .filter(Boolean)
        .map((x) => String(x).toLocaleLowerCase('es'));
      const hay = fields.join(' · ');
      const score = String(lead.company || '').toLocaleLowerCase('es').startsWith(needle) ? 3 : hay.includes(needle) ? 1 : 0;
      return { lead, score };
    })
    .filter((x) => x.score)
    .sort((a, b) => b.score - a.score || String(a.lead.company).localeCompare(String(b.lead.company)))
    .slice(0, 8)
    .map((x) => x.lead);
}

function renderSearchResults() {
  const input = $('v2GlobalSearch');
  const root = $('v2SearchResults');
  if (!input || !root) return;
  const term = input.value.trim();
  if (!term) {
    root.hidden = true;
    root.innerHTML = '';
    return;
  }
  const rows = searchLeads(term);
  root.hidden = false;
  root.innerHTML = rows.length
    ? rows.map((l) => `
      <button class="v2-search-result" type="button" data-action="open-detail" data-id="${esc(l.id)}">
        <strong>${esc(l.company || 'Sin empresa')}</strong>
        <span class="badge">${esc(l.stage || 'Sin etapa')}</span>
        <small>${esc([l.contact, l.email || l.phone, l.rut].filter(Boolean).join(' · ') || 'Sin datos de contacto')}</small>
      </button>`).join('')
    : '<div class="v2-search-empty">No encontramos empresas o contactos con ese criterio.</div>';
}

/* ---------- Dashboard ---------- */
function dashboardTaskCounts() {
  const today = todayISO();
  const tasks = openTasks();
  return {
    overdue: tasks.filter((t) => !t.date || t.date < today).length,
    today: tasks.filter((t) => t.date === today).length
  };
}

function readCloseRateFromOriginalDashboard(root) {
  const cards = qa('.kpi', root);
  const card = cards.find((item) => {
    const label = q('.label', item)?.textContent?.trim().toLocaleLowerCase('es') || '';
    return label.includes('tasa de cierre');
  });

  if (!card) return { value: '—', hint: 'Sin datos suficientes' };

  const rawValue = q('.value', card)?.textContent?.trim() || '—';
  // El markup de views.js usa .sub para la línea de apoyo del KPI, no .hint:
  // con el selector equivocado nunca se detectaba "0 ganadas · 0 perdidas".
  const rawHint = q('.sub', card)?.textContent?.trim() || '';
  const noClosures = /0\s*ganad/i.test(rawHint) && /0\s*perdid/i.test(rawHint);

  return noClosures
    ? { value: '—', hint: 'Sin cierres aún' }
    : { value: rawValue, hint: rawHint || 'Sobre oportunidades cerradas' };
}

function renderDashboardSummary() {
  if ($('viewTitle')?.textContent.trim() !== 'Resumen') return;
  const root = $('viewRoot');
  if (!root) return;

  // La V2 anterior agregaba una bienvenida y un panel de atención que repetían
  // datos ya presentes en el dashboard. Si existe al actualizar, se retira.
  q('.v2-focus', root)?.remove();

  const originalKpis = q('.kpi-grid', root);
  if (!originalKpis) return;

  const m = metrics();
  const counts = dashboardTaskCounts();
  const closeRate = readCloseRateFromOriginalDashboard(root);

  let summary = q('.v2-dashboard-summary', root);
  if (!summary) {
    summary = document.createElement('section');
    summary.className = 'v2-dashboard-summary';
    originalKpis.insertAdjacentElement('beforebegin', summary);
  }

  const signature = JSON.stringify([m.pipelineValue, m.open.length, counts.today, counts.overdue, closeRate.value, closeRate.hint]);
  if (summary.dataset.signature !== signature) {
    summary.dataset.signature = signature;
    summary.innerHTML = `
      <article class="v2-summary-kpi">
        <span>Pipeline activo</span>
        <strong>${esc(money(m.pipelineValue))}</strong>
        <small>Valor de oportunidades abiertas</small>
      </article>
      <article class="v2-summary-kpi">
        <span>Oportunidades</span>
        <strong>${m.open.length}</strong>
        <small>Activas en el pipeline</small>
      </article>
      <article class="v2-summary-kpi ${counts.today ? 'attention' : ''}">
        <span>Pendientes hoy</span>
        <strong>${counts.today}</strong>
        <small>${counts.today === 1 ? '1 seguimiento para hoy' : `${counts.today} seguimientos para hoy`}</small>
      </article>
      <article class="v2-summary-kpi ${counts.overdue ? 'danger' : ''}">
        <span>Tareas vencidas</span>
        <strong>${counts.overdue}</strong>
        <small>${counts.overdue ? 'Requieren acción' : 'Sin atrasos'}</small>
      </article>
      <article class="v2-summary-kpi">
        <span>Tasa de cierre</span>
        <strong>${esc(closeRate.value)}</strong>
        <small>${esc(closeRate.hint)}</small>
      </article>`;
  }

  // Evita mostrar dos veces las mismas métricas. La grilla original permanece
  // en el DOM para que app.js pueda seguir actualizándola sin alterar su lógica.
  originalKpis.classList.add('v2-original-kpis');

  refinePriorityBlock(root);
  if ($('viewSubtitle')) $('viewSubtitle').textContent = 'Seguimiento de tu gestión comercial.';
}

function refinePriorityBlock(root) {
  const heads = qa('.card-head', root);
  const taskHead = heads.find((head) => {
    const title = q('h3', head)?.textContent?.trim().toLocaleLowerCase('es') || '';
    return title === 'próximas tareas' || title === 'prioridades';
  });
  if (!taskHead) return;

  const card = taskHead.closest('.card');
  if (card) card.classList.add('v2-priorities-card');
  const title = q('h3', taskHead);
  if (title) title.textContent = 'Prioridades';

  qa('button', taskHead).forEach((btn) => {
    const text = btn.textContent.trim();
    if (/^Próximas a vencer/i.test(text)) btn.textContent = text.replace(/^Próximas a vencer/i, 'Próximas');
  });
}

/* ---------- Nuevo lead progresivo ---------- */
function setupLeadForm() {
  const grid = q('#leadForm .form-grid');
  if (!grid || grid.dataset.v2 === '1') return;
  grid.dataset.v2 = '1';

  const nodeFor = (id) => $(id)?.closest('label') || $(id);
  const basicIds = ['company', 'contact', 'phone', 'email', 'source', 'owner'];
  const advancedIds = ['rut', 'industry', 'stage', 'priority', 'value', 'probability', 'expectedCloseDate'];
  const taskRow = q('#leadTaskTypeRow');
  const nextAction = nodeFor('nextAction');
  const nextDate = nodeFor('nextDate');
  const loss = $('lossReasonField');
  const notes = nodeFor('notes');

  const basic = basicIds.map(nodeFor).filter(Boolean);
  const advanced = advancedIds.map(nodeFor).filter(Boolean);
  const details = document.createElement('details');
  details.className = 'v2-advanced';
  details.id = 'v2LeadAdvanced';
  details.innerHTML = '<summary>Agregar información comercial y seguimiento</summary><div class="v2-advanced-grid"></div>';
  const inner = q('.v2-advanced-grid', details);

  basic.forEach((node) => grid.appendChild(node));
  [...advanced, taskRow, nextAction, nextDate, loss, notes].filter(Boolean).forEach((node) => inner.appendChild(node));
  grid.appendChild(details);

  const observer = new MutationObserver(() => {
    if ($('leadDialog')?.open) refreshLeadDialogMode();
  });
  observer.observe($('leadDialog'), { attributes: true, attributeFilter: ['open'] });
  refreshLeadDialogMode();
}

function refreshLeadDialogMode() {
  const edit = Boolean($('leadId')?.value);
  const details = $('v2LeadAdvanced');
  if (details) details.open = edit;
  const p = q('#leadDialog .modal-head p');
  if (p) p.textContent = edit
    ? 'Actualiza los datos comerciales, contacto y seguimiento de esta oportunidad.'
    : 'Crea el lead con lo esencial. El resto puede completarse después.';
}

/* ---------- Levantamiento con progreso ---------- */
function setupDiscoveryProgress() {
  const head = q('#discoveryDialog .modal-head > div:first-child');
  if (!head || q('.v2-discovery-progress', head)) return;
  const wrap = document.createElement('div');
  wrap.className = 'v2-discovery-progress';
  wrap.innerHTML = `
    <div class="v2-progress-head"><span>Completitud del levantamiento</span><strong id="v2DiscoveryPct">0%</strong></div>
    <div class="v2-progress-track"><div id="v2DiscoveryFill" class="v2-progress-fill"></div></div>`;
  head.appendChild(wrap);

  $('discoveryForm')?.addEventListener('input', updateDiscoveryProgress);
  $('discoveryForm')?.addEventListener('change', updateDiscoveryProgress);
  const observer = new MutationObserver(() => $('discoveryDialog')?.open && updateDiscoveryProgress());
  observer.observe($('discoveryDialog'), { attributes: true, attributeFilter: ['open'] });
}

function updateDiscoveryProgress() {
  const checks = [
    $('pain')?.value.trim(),
    $('currentManagement')?.value,
    $('technicians')?.value,
    $('locations')?.value,
    $('buyTrigger')?.value,
    qa('#moduleChecks input:checked').length ? 'x' : '',
    $('integrations')?.value.trim(),
    $('successCriteria')?.value.trim(),
    $('technicalNotes')?.value.trim()
  ];
  const pct = Math.round((checks.filter(Boolean).length / checks.length) * 100);
  if ($('v2DiscoveryPct')) $('v2DiscoveryPct').textContent = `${pct}%`;
  if ($('v2DiscoveryFill')) $('v2DiscoveryFill').style.width = `${pct}%`;
}

/* ---------- Ficha por tabs ---------- */
const DETAIL_TABS = [
  { id: 'summary', label: 'Resumen', sections: ['Próxima tarea', 'Datos comerciales'] },
  { id: 'contacts', label: 'Contactos', sections: ['Contactos'] },
  { id: 'discovery', label: 'Levantamiento', sections: ['Levantamiento'] },
  { id: 'quotes', label: 'Cotizaciones', sections: ['Cotizaciones'] },
  { id: 'activity', label: 'Actividad', sections: ['Historial'] },
  { id: 'more', label: 'Más', sections: ['Otros'] }
];

function enhanceDetail() {
  const body = $('detailBody');
  if (!body || !q('.detail-grid', body)) return;
  let tabs = q('.v2-detail-tabs', body);
  if (!tabs) {
    tabs = document.createElement('div');
    tabs.className = 'v2-detail-tabs';
    tabs.innerHTML = DETAIL_TABS.map((t, i) => `<button type="button" class="v2-detail-tab ${i === 0 ? 'active' : ''}" data-v2-detail-tab="${t.id}">${t.label}</button>`).join('');
    body.prepend(tabs);
    tabs.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-v2-detail-tab]');
      if (!btn) return;
      setDetailTab(btn.dataset.v2DetailTab);
    });
  }
  const selected = q('.v2-detail-tab.active', tabs)?.dataset.v2DetailTab || 'summary';
  setDetailTab(selected);
}

function setDetailTab(id) {
  const body = $('detailBody');
  if (!body) return;
  const tab = DETAIL_TABS.find((t) => t.id === id) || DETAIL_TABS[0];
  qa('.v2-detail-tab', body).forEach((b) => b.classList.toggle('active', b.dataset.v2DetailTab === tab.id));
  qa('.detail-section', body).forEach((section) => {
    const title = q('.detail-section-title', section)?.textContent.trim() || '';
    const visible = tab.sections.includes(title);
    section.classList.toggle('v2-hidden', !visible);
    if (visible) section.open = true;
  });
}

/* ---------- Settings ---------- */
function injectSettingsDataCard() {
  if ($('viewTitle')?.textContent.trim() !== 'Configuración') return;
  const root = $('viewRoot');
  if (!root || q('.v2-data-card', root)) return;
  const cards = qa(':scope > .card', root);
  if (!cards.length) return;
  const card = document.createElement('div');
  card.className = 'card v2-data-card';
  card.innerHTML = `
    <div class="card-head"><h3>Datos y respaldo</h3><span class="muted">Administración</span></div>
    <div class="card-body">
      <p class="muted">Exporta o importa respaldos, descarga leads y revisa el estado de sincronización. Las acciones sensibles quedan separadas de la operación comercial.</p>
      <div class="v2-data-actions"><button type="button" class="ghost-btn" data-v2-open-data>Gestionar datos y respaldo</button></div>
    </div>`;
  cards[0].insertAdjacentElement('afterend', card);
  q('[data-v2-open-data]', card)?.addEventListener('click', () => $('dataBtn')?.click());
}

/* ---------- Microcopy de tareas/actividades ---------- */
function refineDialogs() {
  const completeTitle = q('#completeDialog h2');
  if (completeTitle) completeTitle.textContent = 'Completar tarea';
  const completeSubmit = q('#completeDialog button[type="submit"]');
  if (completeSubmit) completeSubmit.textContent = 'Guardar y continuar';

  const manageTitle = q('#manageDialog h2');
  if (manageTitle) manageTitle.textContent = 'Resolver seguimiento';
  const manageSubmit = q('#manageDialog button[type="submit"]');
  if (manageSubmit) manageSubmit.textContent = 'Guardar como realizada';

  const activityNote = q('#activityDialog .form-note');
  if (activityNote) activityNote.textContent = 'Registra una interacción sin modificar la tarea pendiente. Para cerrar el seguimiento actual usa “Completar tarea”.';

  const dataTitle = q('#dataDialog h2');
  if (dataTitle) dataTitle.textContent = 'Datos y respaldo';
}

/* ---------- Vista actual ---------- */
function enhanceCurrentView() {
  renderDashboardSummary();
  injectSettingsDataCard();
}

function observeApp() {
  const root = $('viewRoot');
  if (root) {
    new MutationObserver(() => {
      queueMicrotask(() => {
        enhanceCurrentView();
        enhanceDetail();
      });
    }).observe(root, { childList: true, subtree: true });
  }

  const detail = $('detailDialog');
  if (detail) {
    new MutationObserver(() => {
      if (detail.open) queueMicrotask(enhanceDetail);
    }).observe(detail, { attributes: true, attributeFilter: ['open'] });
  }

  const detailBody = $('detailBody');
  if (detailBody) {
    new MutationObserver(() => {
      if ($('detailDialog')?.open) queueMicrotask(enhanceDetail);
    }).observe(detailBody, { childList: true });
  }

  const sync = $('syncStatus');
  if (sync) {
    new MutationObserver(updateSystemStatus).observe(sync, { attributes: true, childList: true, subtree: true });
  }
}

/* ---------- Eventos globales ---------- */
function bindGlobalEvents() {
  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('.v2-user-wrap')) toggleUserMenu(false);
    if (!ev.target.closest('.v2-search-wrap')) {
      const results = $('v2SearchResults');
      if (results) results.hidden = true;
    }
  });

  document.addEventListener('keydown', (ev) => {
    const shortcut = (ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k';
    if (shortcut) {
      ev.preventDefault();
      const input = $('v2GlobalSearch');
      if (input) {
        input.focus();
        input.select();
      }
    }
    if (ev.key === 'Escape') {
      toggleUserMenu(false);
      const results = $('v2SearchResults');
      if (results) results.hidden = true;
    }
  });
}

function init() {
  decorateNavigation();
  buildHeaderTools();
  setupLeadForm();
  setupDiscoveryProgress();
  refineDialogs();
  observeApp();
  bindGlobalEvents();
  enhanceCurrentView();
  enhanceDetail();

  onChange(() => {
    queueMicrotask(() => {
      updateHeaderIdentity();
      enhanceCurrentView();
      enhanceDetail();
    });
  });

  onAuthChange(() => queueMicrotask(() => {
    updateHeaderIdentity();
    updateSystemStatus();
  }));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
