/* CRM Personal · UX/UI V2
   Enhancement layer: mantiene intacta la lógica de app.js/store.js. */
import { state, onChange, openTasks, metrics, saveProfile } from './store.js';
import { DEFAULT_BOTTOM_NAV, OPEN_STAGES, USER_MODULES } from './catalog.js';
import { session, onAuthChange, signOut } from './auth.js';
import { chilecompraDashboardStats, chilecompraLocalBreakdown, loadChileCompraAnalytics, onChileCompraChange } from './chilecompra.js';
import { startContextTutorial } from './tutorials.js';
import { canAccessView } from './access.js';

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
  if (!clean) return 'CR';
  return clean.split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase() || '').join('');
};

const roleLabel = (role) => ({ super: 'Superadmin', admin: 'Administrador', comercial: 'Comercial', visita: 'Visita' }[role] || role || 'Usuario');

function currentName() {
  return state.me?.name || session.profile?.name || session.user?.email?.split('@')[0] || 'Usuario';
}

function currentEmail() {
  return session.user?.email || state.me?.email || '';
}

const MASCOT_PREF_PREFIX = 'crm.personal.mascot.enabled';

function mascotPreferenceKey() {
  return `${MASCOT_PREF_PREFIX}:${session.user?.id || 'default'}`;
}

function mascotEnabled() {
  if (typeof state.me?.mascotEnabled === 'boolean') return state.me.mascotEnabled;
  try {
    return localStorage.getItem(mascotPreferenceKey()) !== '0';
  } catch {
    return true;
  }
}

async function setMascotPreference(enabled) {
  const next = Boolean(enabled);
  try {
    localStorage.setItem(mascotPreferenceKey(), next ? '1' : '0');
  } catch {
    // La preferencia visual no debe bloquear Mi cuenta.
  }

  document.dispatchEvent(new CustomEvent('crm-personal:mascot-preference', {
    detail: { enabled: next }
  }));

  const status = $('v2MascotStatus');
  if (status) {
    status.textContent = next ? 'Activada' : 'Desactivada';
    status.classList.toggle('success', next);
  }

  const saved = await saveProfile({ mascotEnabled: next });
  if (!saved) {
    const current = mascotEnabled();
    const toggle = $('v2MascotToggle');
    if (toggle) toggle.checked = current;
    if (status) {
      status.textContent = current ? 'Activada' : 'Desactivada';
      status.classList.toggle('success', current);
    }
  }
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
    ['templates', 'Herramientas'],
    ['help', 'Sistema']
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

  // Compatibilidad con shells antiguos en caché: ChileCompra ya no lleva badge "Nuevo".
  qa('.nav-new-badge', nav).forEach((badge) => badge.remove());
}

function effectiveBottomNav() {
  const preferred = Array.isArray(state.me?.bottomNav) && state.me.bottomNav.length
    ? state.me.bottomNav
    : DEFAULT_BOTTOM_NAV;
  const fallback = ['dashboard', 'chilecompra', 'hyperfocus', 'pipeline', 'remarketing', 'leads', 'implementation', 'templates', 'quotes'];
  const result = [];

  [...preferred, ...fallback].forEach((view) => {
    if (result.length >= 4 || result.includes(view) || !canAccessView(view)) return;
    if (!q(`.nav-item[data-view="${view}"]`)) return;
    result.push(view);
  });
  return result;
}

function mobileDrawerIcon(view) {
  if (view === 'chilecompra') return '<span class="v2-drawer-logo v2-drawer-logo--chilecompra" aria-hidden="true"></span>';
  const symbols = {
    dashboard:'⌂', leads:'♟', hyperfocus:'⚡', pipeline:'▥', remarketing:'↺',
    implementation:'✓', templates:'✎', quotes:'$', help:'?', profile:'◉',
    settings:'⚙', audit:'≡'
  };
  return `<span class="v2-drawer-symbol" aria-hidden="true">${symbols[view] || '•'}</span>`;
}

function renderMobileDrawer() {
  let overlay = $('v2MobileDrawerOverlay');
  let drawer = $('v2MobileDrawer');
  if (!overlay) {
    overlay = document.createElement('button');
    overlay.id = 'v2MobileDrawerOverlay';
    overlay.className = 'v2-mobile-drawer-overlay';
    overlay.type = 'button';
    overlay.setAttribute('aria-label', 'Cerrar menú');
    overlay.hidden = true;
    document.body.appendChild(overlay);
  }
  if (!drawer) {
    drawer = document.createElement('aside');
    drawer.id = 'v2MobileDrawer';
    drawer.className = 'v2-mobile-drawer';
    drawer.setAttribute('aria-label', 'Todos los módulos');
    drawer.hidden = true;
    document.body.appendChild(drawer);
  }

  const groups = [...new Set(USER_MODULES.map((module) => module.group || 'Otros'))];
  const moduleGroups = groups.map((group) => {
    const modules = USER_MODULES.filter((module) => (module.group || 'Otros') === group && canAccessView(module.id));
    if (!modules.length) return '';
    return `<section class="v2-drawer-group">
      <strong class="v2-drawer-group-title">${esc(group)}</strong>
      <div class="v2-drawer-links">
        ${modules.map((module) => `<button type="button" class="v2-drawer-link" data-v2-drawer-view="${esc(module.id)}">
          ${mobileDrawerIcon(module.id)}
          <span>${esc(module.label)}</span>
          <b aria-hidden="true">›</b>
        </button>`).join('')}
      </div>
    </section>`;
  }).join('');

  const systemLinks = [
    { id:'profile', label:'Mi cuenta', allowed:true },
    { id:'help', label:'Ayuda', allowed:true },
    { id:'settings', label:'Configuración', allowed:canAccessView('settings') },
    { id:'audit', label:'Auditoría', allowed:canAccessView('audit') }
  ].filter((item) => item.allowed);

  drawer.innerHTML = `
    <div class="v2-drawer-head">
      <div><strong>CRM</strong><span>Todos tus módulos</span></div>
      <button type="button" class="v2-drawer-close" data-v2-drawer-close aria-label="Cerrar">×</button>
    </div>
    <div class="v2-drawer-scroll">
      ${moduleGroups}
      <section class="v2-drawer-group v2-drawer-system">
        <strong class="v2-drawer-group-title">Sistema</strong>
        <div class="v2-drawer-links">
          ${systemLinks.map((item) => `<button type="button" class="v2-drawer-link" data-v2-drawer-view="${item.id}">
            ${mobileDrawerIcon(item.id)}<span>${item.label}</span><b aria-hidden="true">›</b>
          </button>`).join('')}
        </div>
      </section>
    </div>`;

  const activeView = q('.nav-item.active')?.dataset.view || '';
  qa('[data-v2-drawer-view]', drawer).forEach((button) => {
    button.classList.toggle('is-active', button.dataset.v2DrawerView === activeView);
  });
}

function toggleMobileDrawer(force) {
  const drawer = $('v2MobileDrawer');
  const overlay = $('v2MobileDrawerOverlay');
  if (!drawer || !overlay) return;
  const open = force ?? drawer.hidden;
  drawer.hidden = !open;
  overlay.hidden = !open;
  document.documentElement.classList.toggle('v2-drawer-open', open);
  q('[data-mobile-more]', $('nav'))?.setAttribute('aria-expanded', String(open));
}

function applyMobileBottomNav() {
  const nav = $('nav');
  if (!nav) return;
  qa('.nav-item', nav).forEach((item) => {
    if (item.dataset.mobileMore === 'true') return;
    delete item.dataset.mobileNavSlot;
    item.style.removeProperty('--mobile-order');
  });

  let more = q('[data-mobile-more]', nav);
  if (!more) {
    more = document.createElement('button');
    more.type = 'button';
    more.className = 'nav-item v2-more-nav';
    more.dataset.mobileMore = 'true';
    more.setAttribute('aria-label', 'Ver todos los módulos');
    more.setAttribute('aria-expanded', 'false');
    more.innerHTML = '<span class="v2-more-icon" aria-hidden="true">☰</span><span>Más</span>';
    nav.appendChild(more);
  }

  const views = effectiveBottomNav();
  nav.style.setProperty('--mobile-nav-count', '5');
  views.forEach((view, index) => {
    const item = q(`.nav-item[data-view="${view}"]`, nav);
    if (!item) return;
    item.dataset.mobileNavSlot = String(index + 1);
    item.style.setProperty('--mobile-order', String(index + 1));
  });
  more.dataset.mobileNavSlot = '5';
  more.style.setProperty('--mobile-order', '5');
  renderMobileDrawer();
}

function gotoView(view) {
  if (!canAccessView(view)) return;
  toggleMobileDrawer(false);
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
      <button id="v2ContextHelp" class="v2-context-help" type="button" title="Ayuda de esta pantalla" aria-label="Ayuda de esta pantalla">?</button>
      <button class="primary-btn v2-new-lead" type="button" data-action="new-lead">+ Nuevo lead</button>
      <div class="v2-user-wrap">
        <button id="v2UserBtn" class="v2-user-btn" type="button" aria-haspopup="menu" aria-expanded="false">
          <span id="v2Avatar" class="v2-avatar">CR</span>
          <span class="v2-user-copy"><strong id="v2UserName">Usuario</strong><span id="v2UserRole">CRM</span></span>
          <span aria-hidden="true">⌄</span>
        </button>
        <div id="v2UserMenu" class="v2-user-menu" role="menu" hidden>
          <div class="v2-menu-profile"><strong id="v2MenuName">Usuario</strong><span id="v2MenuEmail"></span></div>
          <button class="v2-menu-item" type="button" data-v2-action="profile"><span>Mi cuenta</span><span>›</span></button>
          <button id="v2SettingsMenu" class="v2-menu-item" type="button" data-v2-view="settings" hidden><span>Configuración</span><span>›</span></button>
          <button class="v2-menu-item v2-mobile-only-menu" type="button" data-v2-view="implementation"><span>Implementación</span><span>›</span></button>
          <button class="v2-menu-item v2-mobile-only-menu" type="button" data-v2-view="templates"><span>Plantillas</span><span>›</span></button>
          <button class="v2-menu-item v2-mobile-only-menu" type="button" data-v2-view="quotes"><span>Cotizaciones</span><span>›</span></button>
          <button class="v2-menu-item v2-mobile-only-menu" type="button" data-v2-view="chilecompra"><span>ChileCompra</span><span>›</span></button>
          <button id="v2AuditMenu" class="v2-menu-item v2-mobile-only-menu" type="button" data-v2-view="audit" hidden><span>Auditoría</span><span>›</span></button>
          <button class="v2-menu-item" type="button" data-v2-view="help"><span>Ayuda y tutoriales</span><span>›</span></button>
          <button class="v2-menu-item" type="button" data-v2-action="data"><span>Datos y respaldo</span><span>›</span></button>
          <button class="v2-menu-item" type="button" data-v2-action="theme"><span>Cambiar apariencia</span><span>◐</span></button>
          <button class="v2-menu-item danger" type="button" data-v2-action="signout"><span>Cerrar sesión</span><span>↗</span></button>
          <div id="v2SystemLine" class="v2-system-line"><span class="v2-system-dot"></span><span id="v2SystemText">Estado del sistema</span></div>
        </div>
      </div>
    </div>`;

  const titleWrap = q('.topbar > div:first-child');
  if (titleWrap && !q('.v2-mobile-heading', titleWrap)) {
    const mobileHeading = document.createElement('div');
    mobileHeading.className = 'v2-mobile-heading';
    mobileHeading.innerHTML = '<strong id="v2MobileGreeting">Hola</strong><span id="v2MobileContext">Resumen comercial</span>';
    titleWrap.prepend(mobileHeading);
  }

    $('v2GlobalSearch')?.addEventListener('input', renderSearchResults);
  $('v2GlobalSearch')?.addEventListener('focus', renderSearchResults);
  $('v2ContextHelp')?.addEventListener('click', async () => {
    const activeView = q('.nav-item.active')?.dataset.view || 'dashboard';
    const started = await startContextTutorial(activeView);
    if (!started) gotoView('help');
  });
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
  const auditMenu = $('v2AuditMenu');
  if (auditMenu) auditMenu.hidden = !canAccessView('audit');
  const settingsMenu = $('v2SettingsMenu');
  if (settingsMenu) settingsMenu.hidden = !canAccessView('settings');
  qa('#v2UserMenu [data-v2-view]').forEach((button) => {
    const view = button.dataset.v2View;
    if (view === 'settings' || view === 'audit') return;
    button.hidden = !canAccessView(view);
  });
  updateMobileHeader();
}

function updateMobileHeader() {
  const fullName = currentName().trim();
  const first = fullName.split(/\s+/)[0] || 'Usuario';
  const title = $('viewTitle')?.textContent?.trim() || 'Resumen';
  const subtitle = $('viewSubtitle')?.textContent?.trim() || '';
  const activeView = q('.nav-item.active')?.dataset.view || 'dashboard';

  if ($('v2MobileGreeting')) {
    $('v2MobileGreeting').textContent = activeView === 'dashboard' ? `Hola, ${first}` : title;
  }
  if ($('v2MobileContext')) {
    $('v2MobileContext').textContent = activeView === 'dashboard' ? 'Resumen comercial' : subtitle;
  }

  document.documentElement.dataset.crmView = activeView;
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
  const btn = ev.target.closest('[data-v2-action], [data-v2-view]');
  if (!btn) return;
  const action = btn.dataset.v2Action;
  const view = btn.dataset.v2View;
  toggleUserMenu(false);
  if (view) gotoView(view);
  if (action === 'profile') gotoView('profile');
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

function pipelineStageSnapshot(openLeads = []) {
  const short = {
    Lead: 'Lead',
    Contactado: 'Contact.',
    'Reunión / Demo': 'Reunión',
    Propuesta: 'Propuesta',
    Negociación: 'Negoc.'
  };
  const counts = OPEN_STAGES.map((stage) => ({
    stage,
    label: short[stage] || stage,
    value: openLeads.filter((lead) => lead.stage === stage).length
  }));
  const max = Math.max(1, ...counts.map((row) => row.value));
  const top = [...counts].sort((a, b) => b.value - a.value)[0] || { stage: 'Sin actividad', value: 0 };
  return {
    counts,
    top,
    bars: counts.map((row) => {
      const height = row.value ? Math.max(20, Math.round((row.value / max) * 100)) : 8;
      return `<button type="button" class="v2-pipeline-stage" data-v2-dashboard-action="pipeline" title="${esc(row.stage)}: ${row.value}">
        <span class="v2-stage-count">${row.value}</span>
        <i style="--h:${height}%"></i>
        <small>${esc(row.label)}</small>
      </button>`;
    }).join('')
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
  const rawHint = q('.sub', card)?.textContent?.trim() || '';
  const noClosures = /0\s*ganad/i.test(rawHint) && /0\s*perdid/i.test(rawHint);
  return noClosures
    ? { value: '—', hint: 'Sin cierres aún' }
    : { value: rawValue, hint: rawHint || 'Sobre oportunidades cerradas' };
}

const CC_HOME_DEFAULT = Object.freeze({ universe: 'general', metric: 'publications' });
let ccHomeUniverse = CC_HOME_DEFAULT.universe;
let ccHomeMetric = CC_HOME_DEFAULT.metric;
let ccHomeAnalytics = null;
let ccHomeAnalyticsLoading = false;
let ccHomeFallbackNotice = '';
const CC_HOME_COLORS = ['#0b73df','#36a2f5','#31bd98','#ffad43','#ef6670','#8668e8','#97a7ba'];

function compactNumber(value, metric) {
  const n = Number(value || 0);
  if (metric === 'amount') {
    if (!n) return '$0';
    if (n >= 1_000_000_000) return '$' + (n / 1_000_000_000).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + ' mil MM';
    if (n >= 1_000_000) return '$' + (n / 1_000_000).toLocaleString('es-CL', { maximumFractionDigits: 0 }) + ' MM';
    return money(n);
  }
  return n.toLocaleString('es-CL');
}

function homeChileCompraMarket() {
  if (ccHomeUniverse === 'campaigns') return chilecompraLocalBreakdown({ metric: ccHomeMetric });
  if (ccHomeAnalytics?.universe === ccHomeUniverse && ccHomeAnalytics?.metric === ccHomeMetric) return ccHomeAnalytics;
  return null;
}

function homeMarketHasData(data, metric = ccHomeMetric) {
  const categories = (data?.categories || []).filter((row) => Number(row.value || 0) > 0);
  if (!categories.length) return false;
  const categoryTotal = categories.reduce((sum, row) => sum + Number(row.value || 0), 0);
  const total = metric === 'amount'
    ? Number(data?.amount || categoryTotal)
    : metric === 'buyers'
      ? Number(data?.buyers || categoryTotal)
      : Number(data?.publications || categoryTotal);
  return total > 0;
}

function homeMarketPresetCopy(data) {
  const universeLabel = ccHomeUniverse === 'campaigns'
    ? 'Mis seguimientos'
    : ccHomeUniverse === 'business'
      ? 'Mi negocio'
      : 'Mercado general Chile';
  const metricLabel = ccHomeMetric === 'amount'
    ? 'Monto publicado'
    : ccHomeMetric === 'buyers'
      ? 'Compradores'
      : 'Publicaciones';

  if (ccHomeUniverse !== CC_HOME_DEFAULT.universe || ccHomeMetric !== CC_HOME_DEFAULT.metric) {
    return `${universeLabel} · ${metricLabel} por rubro`;
  }

  const categories = (data?.categories || [])
    .filter((row) => row.label !== 'Sin clasificar' && Number(row.value || 0) > 0)
    .slice(0, 3);
  const names = categories.map((row) => row.label);
  const base = 'Mercado general Chile · Publicaciones activas por rubro';
  if (!data || !homeMarketHasData(data, 'publications')) return base;
  if (!names.length) return `${Number(data.publications || 0).toLocaleString('es-CL')} publicaciones activas`;
  return `${Number(data.publications || 0).toLocaleString('es-CL')} publicaciones activas · lideran ${names.join(', ')}`;
}

function homeMarketIsDefault() {
  return ccHomeUniverse === CC_HOME_DEFAULT.universe && ccHomeMetric === CC_HOME_DEFAULT.metric;
}

function resetHomeMarketView({ notice = '' } = {}) {
  ccHomeUniverse = CC_HOME_DEFAULT.universe;
  ccHomeMetric = CC_HOME_DEFAULT.metric;
  ccHomeAnalytics = null;
  ccHomeFallbackNotice = notice;
}

function homeChileCompraBars(data) {
  const categories = (data?.categories || []).filter((row) => Number(row.value || 0) > 0);
  const categoryTotal = categories.reduce((sum, row) => sum + Number(row.value || 0), 0);
  const total = ccHomeMetric === 'amount'
    ? Number(data?.amount || categoryTotal)
    : ccHomeMetric === 'buyers'
      ? Number(data?.buyers || categoryTotal)
      : Number(data?.publications || categoryTotal);
  if (!categories.length || total <= 0) {
    const text = data?.configured === false
      ? (ccHomeUniverse === 'business' ? 'Configura “Mi negocio” dentro de ChileCompra.' : 'Crea un seguimiento para comenzar a medir el mercado.')
      : 'No hay datos suficientes para este filtro.';
    return `<div class="v2-cc-market-empty">${esc(text)}</div>`;
  }

  const top = categories.slice(0, 8);
  const unit = ccHomeMetric === 'amount' ? 'monto observado' : ccHomeMetric === 'buyers' ? 'compradores' : 'publicaciones';
  const examplesFor = (label) => (data?.categoryExamples?.[label] || []).slice(0, 3);

  return `<div class="v2-cc-bars">
    <div class="v2-cc-bars-total"><strong>${esc(compactNumber(total, ccHomeMetric))}</strong><span>${unit}</span><small>${categories.length} rubros</small></div>
    <div class="v2-cc-bars-list">
      ${top.map((row) => {
        const value = Number(row.value || 0);
        const pct = total ? (value / total) * 100 : 0;
        const shown = ccHomeMetric === 'amount' ? compactNumber(value, ccHomeMetric) : value.toLocaleString('es-CL');
        const examples = examplesFor(row.label);
        return `<details class="v2-cc-bar-row">
          <summary>
            <div class="v2-cc-bar-label"><span>${esc(row.label)}</span><strong>${esc(shown)} · ${pct.toFixed(0)}%</strong></div>
            <div class="v2-cc-bar-track"><i style="width:${Math.max(2,pct).toFixed(1)}%"></i></div>
          </summary>
          ${examples.length ? `<div class="v2-cc-bar-examples">${examples.map((item) => `<button type="button" data-action="open-chilecompra" data-cc-tab="buscar" data-query="${esc(item.code || '')}"><span>${esc(item.name || 'Sin nombre')}</span><small>${esc(item.buyer || 'Comprador no informado')}</small></button>`).join('')}</div>` : '<div class="v2-cc-bar-examples-empty">Sin ejemplos disponibles.</div>'}
        </details>`;
      }).join('')}
      ${categories.length > top.length ? `<button type="button" class="v2-cc-all-categories" data-action="open-chilecompra" data-cc-tab="mercado">Ver los ${categories.length} rubros →</button>` : ''}
    </div>
  </div>`;
}

async function refreshHomeChileCompraAnalytics({ allowFallback = true } = {}) {
  if (ccHomeUniverse === 'campaigns') {
    ccHomeAnalytics = null;
    ccHomeFallbackNotice = '';
    renderDashboardSummary();
    return;
  }

  ccHomeAnalyticsLoading = true;
  renderDashboardSummary();

  try {
    const requestedUniverse = ccHomeUniverse;
    const requestedMetric = ccHomeMetric;
    const data = await loadChileCompraAnalytics({ universe: requestedUniverse, metric: requestedMetric, groupBy: 'industry' });

    if (
      allowFallback
      && !homeMarketHasData(data, requestedMetric)
      && (requestedUniverse !== CC_HOME_DEFAULT.universe || requestedMetric !== CC_HOME_DEFAULT.metric)
    ) {
      resetHomeMarketView({ notice: 'Ese filtro no entregó datos. Volvimos a la vista inicial para no dejar el Resumen vacío.' });
      ccHomeAnalyticsLoading = false;
      renderDashboardSummary();
      return refreshHomeChileCompraAnalytics({ allowFallback: false });
    }

    ccHomeAnalytics = data;
  } catch (err) {
    console.error('No se pudo cargar analítica ChileCompra para el Home', err);
    ccHomeAnalytics = null;
  } finally {
    ccHomeAnalyticsLoading = false;
    renderDashboardSummary();
  }
}

function handleDashboardAction(action) {
  if (['pipeline','opportunities','close'].includes(action)) {
    gotoView('pipeline');
    return;
  }
  if (action === 'today' || action === 'overdue') {
    const tab = q(`[data-action="tasks-tab"][data-tab="${action}"]`, $('viewRoot'));
    tab?.click();
    q('.commercial-center-card', $('viewRoot'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderDashboardSummary() {
  if ($('viewTitle')?.textContent.trim() !== 'Resumen') return;
  const root = $('viewRoot');
  if (!root) return;
  q('.v2-focus', root)?.remove();

  const originalKpis = q('.kpi-grid', root);
  if (!originalKpis) return;

  const m = metrics();
  const counts = dashboardTaskCounts();
  const closeRate = readCloseRateFromOriginalDashboard(root);
  const pipelineSnapshot = pipelineStageSnapshot(m.open);
  const chilecompra = chilecompraDashboardStats();
  const market = homeChileCompraMarket();

  let summary = q('.v2-dashboard-summary', root);
  if (!summary) {
    summary = document.createElement('section');
    summary.className = 'v2-dashboard-summary';
    originalKpis.insertAdjacentElement('beforebegin', summary);
  }

  const signature = JSON.stringify([
    m.pipelineValue, m.open.length, counts.today, counts.overdue, closeRate.value, closeRate.hint,
    pipelineSnapshot.counts.map((row) => row.value), pipelineSnapshot.top.stage, pipelineSnapshot.top.value,
    chilecompra.total, chilecompra.activeCampaigns,
    chilecompra.campaigns.map((c) => [c.id, c.name, chilecompra.newByCampaign?.[c.id] || 0]),
    ccHomeUniverse, ccHomeMetric, ccHomeAnalyticsLoading, ccHomeFallbackNotice,
    market?.categories, market?.publications, market?.buyers, market?.amount
  ]);

  if (summary.dataset.signature !== signature) {
    summary.dataset.signature = signature;
    const campaignButtons = chilecompra.campaigns.slice(0, 4).map((campaign) => `<button type="button" class="v2-cc-campaign-chip" data-action="open-chilecompra" data-campaign="${esc(campaign.id)}">
      <span>${esc(campaign.name)}</span><strong>${chilecompra.newByCampaign?.[campaign.id] || 0}</strong>
    </button>`).join('') + (chilecompra.campaigns.length > 4
      ? `<button type="button" class="v2-cc-campaign-chip v2-cc-campaign-chip--all" data-action="open-chilecompra" data-cc-tab="campanas"><span>Ver todos los seguimientos</span><strong>+${chilecompra.campaigns.length - 4}</strong></button>`
      : '');

    summary.innerHTML = `
      <article class="v2-summary-kpi v2-pipeline-hero is-clickable" data-v2-dashboard-action="pipeline" role="button" tabindex="0">
        <div class="v2-kpi-label-row"><span>Pipeline activo</span><span class="v2-kpi-info" aria-label="Valor total de oportunidades abiertas">i</span></div>
        <strong>${esc(money(m.pipelineValue))}</strong>
        <small><b>${m.open.length}</b> ${m.open.length === 1 ? 'oportunidad abierta' : 'oportunidades abiertas'}</small>
        <div class="v2-pipeline-insight"><span>Mayor carga</span><strong>${esc(pipelineSnapshot.top.stage)}</strong><small>${pipelineSnapshot.top.value} ${pipelineSnapshot.top.value === 1 ? 'oportunidad' : 'oportunidades'}</small></div>
        <div class="v2-pipeline-chart" aria-label="Oportunidades por etapa">${pipelineSnapshot.bars}</div>
      </article>
      <article class="v2-summary-kpi v2-kpi-opportunities is-clickable" data-v2-dashboard-action="opportunities" role="button" tabindex="0">
        <span class="v2-kpi-icon" aria-hidden="true">▦</span><span>Oportunidades</span><strong>${m.open.length}</strong><small>Activas en el pipeline</small><b class="v2-card-chevron">›</b>
      </article>
      <article class="v2-summary-kpi v2-kpi-today ${counts.today ? 'attention' : ''} is-clickable" data-v2-dashboard-action="today" role="button" tabindex="0">
        <span class="v2-kpi-icon" aria-hidden="true">✓</span><span>Pendientes hoy</span><strong>${counts.today}</strong><small>Seguimientos para hoy</small><b class="v2-card-chevron">›</b>
      </article>
      <article class="v2-summary-kpi v2-kpi-overdue ${counts.overdue ? 'danger' : ''} is-clickable" data-v2-dashboard-action="overdue" role="button" tabindex="0">
        <span class="v2-kpi-icon" aria-hidden="true">!</span><span>Tareas vencidas</span><strong>${counts.overdue}</strong><small>Requieren acción</small><b class="v2-card-chevron">›</b>
      </article>
      <article class="v2-summary-kpi v2-kpi-close is-clickable" data-v2-dashboard-action="close" role="button" tabindex="0">
        <span class="v2-kpi-icon" aria-hidden="true">▥</span><span>Tasa de cierre</span><strong>${esc(closeRate.value)}</strong><small>${esc(closeRate.hint)}</small><b class="v2-card-chevron">›</b>
      </article>

      <article class="v2-summary-kpi v2-chilecompra-card v2-chilecompra-card--compact">
        <div class="v2-cc-brand">
          <span class="v2-cc-brand-icon" aria-hidden="true"><img src="https://www.chilecompra.cl/wp-content/uploads/2016/12/datosabiertoslogochilecompra-300x169.jpg" alt="" /></span>
          <div>
            <strong>ChileCompra</strong>
            <small>${chilecompra.activeCampaigns
              ? `<b>${chilecompra.activeCampaigns}</b> ${chilecompra.activeCampaigns === 1 ? 'seguimiento activo' : 'seguimientos activos'} · <b>${chilecompra.total}</b> coincidencias por revisar`
              : 'Aún no tienes seguimientos activos'}</small>
          </div>
          <button type="button" class="v2-cc-arrow" data-action="open-chilecompra" aria-label="Abrir ChileCompra"><span>Abrir</span><b>›</b></button>
        </div>
        <div class="v2-cc-compact-summary">
          <button type="button" class="v2-cc-compact-stat v2-cc-compact-stat--primary" data-action="open-chilecompra" data-cc-tab="coincidencias">
            <span>Coincidencias por revisar</span><strong>${chilecompra.total}</strong><small>Según tus seguimientos activos</small>
          </button>
          <button type="button" class="v2-cc-compact-stat" data-action="open-chilecompra" data-cc-tab="campanas">
            <span>Seguimientos</span><strong>${chilecompra.activeCampaigns}</strong><small>Activos ahora</small>
          </button>
          <button type="button" class="v2-cc-compact-stat" data-action="open-chilecompra" data-cc-tab="mercado">
            <span>Mercado Público</span><strong>${market?.publications != null ? Number(market.publications).toLocaleString('es-CL') : '—'}</strong>
            <small>${market?.categories?.[0]?.label ? `Mayor actividad: ${esc(market.categories[0].label)}` : 'Ver panorama de compras'}</small>
          </button>
        </div>
        <div class="v2-cc-compact-campaigns">
          <div class="v2-cc-compact-campaigns-head">
            <strong>Seguimientos con actividad</strong>
            <button type="button" class="link-btn" data-action="open-chilecompra" data-cc-tab="campanas">Ver todos</button>
          </div>
          <div class="v2-cc-compact-campaign-list">
            ${chilecompra.campaigns.length
              ? chilecompra.campaigns.slice().sort((a,b) => Number(chilecompra.newByCampaign?.[b.id] || 0) - Number(chilecompra.newByCampaign?.[a.id] || 0)).slice(0,3).map((campaign) => `<button type="button" class="v2-cc-compact-campaign" data-action="open-chilecompra" data-campaign="${esc(campaign.id)}"><span>${esc(campaign.name)}</span><strong>${chilecompra.newByCampaign?.[campaign.id] || 0}</strong></button>`).join('')
              : '<button type="button" class="v2-cc-empty-campaigns" data-action="open-chilecompra" data-cc-tab="campanas">+ Crear seguimiento</button>'}
          </div>
        </div>
      </article>`;
  }

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
  // Solo escribir si el texto cambia de verdad: asignar textContent siempre cuenta
  // como mutación del DOM y vuelve a disparar el MutationObserver que llama a esta
  // función, lo que producía un bucle infinito que congelaba la página.
  if (title && title.textContent.trim() !== 'Prioridades') title.textContent = 'Prioridades';

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
  // Los campos que no estén en ninguna de las dos listas se quedan donde estaban,
  // es decir arriba de todo: por eso "Cargo" aparecía antes que "Empresa".
  const basicIds = ['company', 'contact', 'role', 'phone', 'email', 'source', 'owner'];
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
  // La marca de oportunidad privada se decide al crear, así que cierra el bloque
  // esencial en vez de quedar suelta antes de los datos de la empresa.
  const privacy = nodeFor('isPrivate');
  if (privacy) grid.appendChild(privacy);
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
  { id: 'summary', label: 'Resumen', sections: ['Gestión pendiente', 'Datos comerciales'] },
  { id: 'contacts', label: 'Contactos', sections: ['Contactos'] },
  { id: 'discovery', label: 'Levantamiento', sections: ['Levantamiento'] },
  { id: 'quotes', label: 'Cotizaciones', sections: ['Cotizaciones'] },
  { id: 'activity', label: 'Actividad', sections: ['Historial'] },
  { id: 'more', label: 'Administración', sections: ['Administración'] }
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
function injectMascotSettingsCard() {
  if ($('viewTitle')?.textContent.trim() !== 'Mi cuenta') return;
  const root = $('viewRoot');
  if (!root || q('.v2-mascot-settings-card', root)) return;

  const cards = qa(':scope > .card', root);
  if (!cards.length) return;

  const enabled = mascotEnabled();
  const card = document.createElement('div');
  card.className = 'card v2-mascot-settings-card';
  card.innerHTML = `
    <div class="card-head">
      <div>
        <h3>Mascota</h3>
        <span class="muted">Preferencia visual</span>
      </div>
      <span id="v2MascotStatus" class="badge ${enabled ? 'success' : ''}">${enabled ? 'Activada' : 'Desactivada'}</span>
    </div>
    <div class="card-body">
      <label class="v2-setting-toggle" for="v2MascotToggle">
        <span class="v2-setting-toggle__copy">
          <strong>Activar o desactivar mascota</strong>
          <small>La mascota aparece solo al iniciar una sesión y ante cambios importantes de gestión. Si la desactivas, la preferencia queda guardada en tu cuenta.</small>
        </span>
        <span class="v2-switch">
          <input id="v2MascotToggle" type="checkbox" ${enabled ? 'checked' : ''} />
          <span class="v2-switch__track" aria-hidden="true"></span>
        </span>
      </label>
    </div>`;

  const appCard = cards.find((node) => q('.card-head h3', node)?.textContent?.trim() === 'Aplicación CRM');
  if (appCard) appCard.insertAdjacentElement('afterend', card);
  else cards[0].insertAdjacentElement('afterend', card);

  $('v2MascotToggle')?.addEventListener('change', async (event) => {
    await setMascotPreference(event.currentTarget.checked);
  });
}

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
  root.appendChild(card);
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
  updateMobileHeader();
  renderDashboardSummary();
  if (document.documentElement.dataset.crmView === 'dashboard' && ccHomeUniverse !== 'campaigns' && !ccHomeAnalytics && !ccHomeAnalyticsLoading) {
    queueMicrotask(refreshHomeChileCompraAnalytics);
  }
  injectMascotSettingsCard();
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
  document.addEventListener('toggle', (ev) => {
    const row = ev.target?.closest?.('.v2-cc-bar-row');
    if (!row?.open) return;
    qa('.v2-cc-bar-row[open]').forEach((other) => {
      if (other !== row) other.open = false;
    });
  }, true);

  document.addEventListener('click', (ev) => {
    const moreNav = ev.target.closest?.('[data-mobile-more]');
    if (moreNav) {
      ev.preventDefault();
      ev.stopPropagation();
      toggleMobileDrawer();
      return;
    }
    const drawerView = ev.target.closest?.('[data-v2-drawer-view]');
    if (drawerView) {
      gotoView(drawerView.dataset.v2DrawerView);
      return;
    }
    if (ev.target.closest?.('[data-v2-drawer-close]') || ev.target.id === 'v2MobileDrawerOverlay') {
      toggleMobileDrawer(false);
      return;
    }
    const dashboardTarget = ev.target.closest?.('[data-v2-dashboard-action]');
    if (dashboardTarget) {
      handleDashboardAction(dashboardTarget.dataset.v2DashboardAction);
      return;
    }
    if (!ev.target.closest('.v2-user-wrap')) toggleUserMenu(false);
    if (!ev.target.closest('.v2-search-wrap')) {
      const results = $('v2SearchResults');
      if (results) results.hidden = true;
    }
  });

  document.addEventListener('change', (ev) => {
    if (ev.target.id === 'v2CcUniverse') {
      ccHomeUniverse = ev.target.value;
      ccHomeAnalytics = null;
      ccHomeFallbackNotice = '';
      refreshHomeChileCompraAnalytics();
      return;
    }
    if (ev.target.id === 'v2CcMetric') {
      ccHomeMetric = ev.target.value;
      ccHomeAnalytics = null;
      ccHomeFallbackNotice = '';
      refreshHomeChileCompraAnalytics();
    }
  });

  document.addEventListener('keydown', (ev) => {
    const shortcut = (ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k';
    if (shortcut) {
      if (document.documentElement.dataset.crmView === 'chilecompra') return;
      ev.preventDefault();
      const input = $('v2GlobalSearch');
      if (input) {
        input.focus();
        input.select();
      }
    }
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches?.('[data-v2-dashboard-action][role="button"]')) {
      ev.preventDefault();
      handleDashboardAction(ev.target.dataset.v2DashboardAction);
    }
    if (ev.key === 'Escape') {
      toggleMobileDrawer(false);
      toggleUserMenu(false);
      const results = $('v2SearchResults');
      if (results) results.hidden = true;
    }
  });
}

function init() {
  decorateNavigation();
  applyMobileBottomNav();
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
      applyMobileBottomNav();
      enhanceCurrentView();
      enhanceDetail();
    });
  });

  onAuthChange(() => queueMicrotask(() => {
    updateHeaderIdentity();
    applyMobileBottomNav();
    updateSystemStatus();
    enhanceCurrentView();
  }));

  onChileCompraChange(() => queueMicrotask(() => {
    renderDashboardSummary();
  }));

  window.addEventListener('storage', (event) => {
    if (event.key !== mascotPreferenceKey()) return;
    const toggle = $('v2MascotToggle');
    const enabled = event.newValue !== '0';
    if (toggle) toggle.checked = enabled;
    const status = $('v2MascotStatus');
    if (status) {
      status.textContent = enabled ? 'Activada' : 'Desactivada';
      status.classList.toggle('success', enabled);
    }
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();