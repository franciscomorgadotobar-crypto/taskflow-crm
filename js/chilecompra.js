import { supabase } from './supabase.js';
import { isReadOnly } from './auth.js';
import { hydrate as hydrateCrm } from './store.js';
import { escapeHtml as e, fmtDate, openExternal, toast } from './utils.js';

const CAMPAIGNS = [
  {
    id: 'NEOFF',
    name: 'NEOFF',
    subtitle: 'IoT · telemetría · RFID · sensores · integración',
    scope: 'NEOFF'
  },
  {
    id: 'TaskFlow',
    name: 'TaskFlow',
    subtitle: 'OT · mantenimiento · terreno · inventario · activos',
    scope: 'TaskFlow'
  },
  {
    id: 'BOTH',
    name: 'TaskFlow + NEOFF',
    subtitle: 'Operación conectada · equipos · infraestructura',
    scope: 'BOTH'
  }
];

export const chilecompraState = {
  campaigns: [],
  opportunities: [],
  loading: false,
  syncing: false,
  searching: false,
  hydrated: false,
  tab: 'buscar',
  query: '',
  results: [],
  sourceCount: 0,
  activeCampaign: '',
  fit: new Set(['alto', 'parcial', 'bajo']),
  selectedId: '',
  detailTab: 'resumen',
  sort: 'fit',
  lastSyncAt: ''
};

const listeners = new Set();
export const onChileCompraChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const notify = () => listeners.forEach((fn) => fn(chilecompraState));

export function clearChileCompra() {
  chilecompraState.campaigns = [];
  chilecompraState.opportunities = [];
  chilecompraState.loading = false;
  chilecompraState.syncing = false;
  chilecompraState.searching = false;
  chilecompraState.hydrated = false;
  chilecompraState.query = '';
  chilecompraState.results = [];
  chilecompraState.sourceCount = 0;
  chilecompraState.activeCampaign = '';
  chilecompraState.selectedId = '';
  chilecompraState.lastSyncAt = '';
  notify();
}

export function chilecompraDashboardStats() {
  const active = chilecompraState.opportunities.filter((o) => o.radar_state === 'nuevo');
  return {
    total: active.filter((o) => o.fit_level === 'alto' || o.fit_level === 'parcial').length,
    high: active.filter((o) => o.fit_level === 'alto').length,
    partial: active.filter((o) => o.fit_level === 'parcial').length,
    saved: chilecompraState.opportunities.filter((o) => o.radar_state === 'guardado').length,
    crm: chilecompraState.opportunities.filter((o) => o.radar_state === 'crm').length,
    discarded: chilecompraState.opportunities.filter((o) => o.radar_state === 'descartado').length,
    lastSyncAt: chilecompraState.lastSyncAt
  };
}

function mergeRows(rows = []) {
  const byCode = new Map(chilecompraState.opportunities.map((o) => [o.external_code, o]));
  rows.forEach((row) => byCode.set(row.external_code, row));
  chilecompraState.opportunities = [...byCode.values()];
}

export async function hydrateChileCompra() {
  if (chilecompraState.loading) return;
  chilecompraState.loading = true;
  notify();
  try {
    const [campaigns, opportunities] = await Promise.all([
      supabase.from('chilecompra_campaigns').select('*').order('created_at', { ascending: true }),
      supabase.from('chilecompra_opportunities').select('*').order('updated_at', { ascending: false }).limit(800)
    ]);
    if (campaigns.error) throw campaigns.error;
    if (opportunities.error) throw opportunities.error;

    chilecompraState.campaigns = campaigns.data || [];
    chilecompraState.opportunities = opportunities.data || [];
    chilecompraState.hydrated = true;
    chilecompraState.lastSyncAt = chilecompraState.opportunities
      .map((o) => o.updated_at)
      .filter(Boolean)
      .sort()
      .at(-1) || '';
  } finally {
    chilecompraState.loading = false;
    notify();
  }
}

export async function syncChileCompra() {
  if (chilecompraState.syncing) return;
  chilecompraState.syncing = true;
  notify();
  try {
    const { data, error } = await supabase.functions.invoke('chilecompra-radar', {
      body: { action: 'sync' }
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.message || data.error);
    await hydrateChileCompra();
    toast('Base de oportunidades actualizada.');
  } finally {
    chilecompraState.syncing = false;
    notify();
  }
}

function rowSource() {
  if (chilecompraState.tab === 'guardadas') {
    return chilecompraState.opportunities.filter((o) => o.radar_state === 'guardado');
  }
  if (chilecompraState.tab === 'crm') {
    return chilecompraState.opportunities.filter((o) => o.radar_state === 'crm');
  }
  if (chilecompraState.tab === 'descartadas') {
    return chilecompraState.opportunities.filter((o) => o.radar_state === 'descartado');
  }
  return chilecompraState.results;
}

function filteredRows() {
  const rows = rowSource().filter((o) => chilecompraState.fit.has(o.fit_level || 'bajo'));
  rows.sort((a, b) => {
    if (chilecompraState.sort === 'close') {
      return String(a.close_at || '9999').localeCompare(String(b.close_at || '9999'));
    }
    if (chilecompraState.sort === 'recent') {
      return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    }
    return (b.fit_score || 0) - (a.fit_score || 0);
  });
  return rows;
}

function selectedOpportunity() {
  const all = [...chilecompraState.results, ...chilecompraState.opportunities];
  return all.find((o) => o.id === chilecompraState.selectedId) || filteredRows()[0] || null;
}

function fitLabel(level) {
  return level === 'alto' ? 'Encaje alto' : level === 'parcial' ? 'Encaje parcial' : 'Sin encaje';
}

function amountLabel(o) {
  if (o.amount == null) return 'No informado';
  try {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0
    }).format(Number(o.amount));
  } catch {
    return String(o.amount);
  }
}

function tag(text) {
  return `<span class="cc-tag">${e(text)}</span>`;
}

function knownCampaignCount(scope) {
  return chilecompraState.opportunities.filter((o) => {
    const solutions = new Set(o.matched_solutions || []);
    if (scope === 'NEOFF') return solutions.has('NEOFF');
    if (scope === 'TaskFlow') return solutions.has('TaskFlow');
    return solutions.has('NEOFF') && solutions.has('TaskFlow');
  }).length;
}

function campaignCard(c) {
  const active = chilecompraState.activeCampaign === c.scope && chilecompraState.tab === 'campanas';
  return `<button type="button" class="cc-fixed-campaign ${active ? 'active' : ''}" data-cc-campaign="${c.scope}">
    <span class="cc-fixed-campaign-icon">${c.scope === 'NEOFF' ? 'N' : c.scope === 'TaskFlow' ? 'T' : 'N+T'}</span>
    <span class="cc-fixed-campaign-copy">
      <strong>${e(c.name)}</strong>
      <small>${e(c.subtitle)}</small>
      <em>${knownCampaignCount(c.scope)} detectadas en la base</em>
    </span>
    <span class="cc-fixed-campaign-arrow">›</span>
  </button>`;
}

function opportunityCard(o) {
  const selected = selectedOpportunity()?.id === o.id;
  return `<article class="cc-opportunity ${selected ? 'is-selected' : ''}" data-cc-select="${o.id}">
    <div class="cc-score cc-score--${o.fit_level || 'bajo'}">
      <strong>${Number(o.fit_score || 0)}%</strong>
      <small>${fitLabel(o.fit_level)}</small>
    </div>
    <div class="cc-opportunity-main">
      <strong class="cc-opportunity-title">${e(o.name)}</strong>
      <span class="cc-buyer">⌂ ${e(o.buyer_name || 'Comprador disponible al abrir el detalle')}</span>
      <div class="cc-meta-row">
        <span>ID ${e(o.external_code)}</span>
        <span>${e(o.procurement_type || 'Licitación pública')}</span>
        <span class="cc-open-dot">● ${e(o.status || 'Publicada')}</span>
      </div>
      <div class="cc-tags">${(o.matched_solutions || []).map(tag).join('')}${(o.matched_capabilities || []).slice(0, 4).map(tag).join('')}</div>
    </div>
    <div class="cc-opportunity-side">
      <small>Cierre</small>
      <strong>${o.close_at ? fmtDate(o.close_at.slice(0, 10)) : 'Sin fecha'}</strong>
      <small>Monto estimado</small>
      <strong>${e(amountLabel(o))}</strong>
    </div>
    <span class="cc-chevron">›</span>
  </article>`;
}

function rawSection(o, keys) {
  const raw = o?.raw || {};
  for (const key of keys) {
    const value = raw[key] ?? raw?.Fechas?.[key] ?? raw?.Comprador?.[key];
    if (value == null || value === '') continue;
    if (typeof value === 'object') return `<pre class="cc-raw">${e(JSON.stringify(value, null, 2))}</pre>`;
    return `<p>${e(String(value))}</p>`;
  }
  return '<p class="muted">Mercado Público no entrega información adicional para esta sección.</p>';
}

function detailBody(o) {
  if (chilecompraState.detailTab === 'encaje') {
    return `<section class="cc-detail-section">
      <h4>Encaje comercial</h4>
      <div class="cc-reasons">${(o.match_reasons || []).map((r) => `<div><span>✓</span><p>${e(r)}</p></div>`).join('') || '<p class="muted">Esta licitación apareció por búsqueda tradicional y no tiene encaje automático detectado.</p>'}</div>
      <h4>Soluciones relacionadas</h4>
      <div class="cc-tags">${(o.matched_solutions || []).map(tag).join('')}${(o.matched_capabilities || []).map(tag).join('')}</div>
    </section>`;
  }
  if (chilecompraState.detailTab === 'requisitos') {
    return `<section class="cc-detail-section"><h4>Requisitos</h4>${rawSection(o, ['RequisitosGenerales','AntecedentesTecnicos','Requisitos','Antecedentes'])}</section>`;
  }
  if (chilecompraState.detailTab === 'documentos') {
    return `<section class="cc-detail-section"><h4>Documentos</h4>${rawSection(o, ['Documentos','Adjuntos','Archivos','Items'])}</section>`;
  }
  return `<section class="cc-detail-section">
    <div class="cc-detail-facts">
      <div><small>Cierre</small><strong>${o.close_at ? fmtDate(o.close_at.slice(0, 10)) : 'Sin fecha'}</strong></div>
      <div><small>Monto estimado</small><strong>${e(amountLabel(o))}</strong></div>
      <div><small>Publicación</small><strong>${o.published_at ? fmtDate(o.published_at.slice(0, 10)) : 'No informada'}</strong></div>
    </div>
    <h4>Descripción</h4>
    <p class="cc-description">${e(o.description || 'Abre el detalle para consultar la ficha completa de Mercado Público.')}</p>
    <h4>Soluciones relacionadas</h4>
    <div class="cc-tags">${(o.matched_solutions || []).map(tag).join('')}${(o.matched_capabilities || []).map(tag).join('')}</div>
  </section>`;
}

function detailPanel(o) {
  if (!o) return '<aside class="cc-detail"><div class="cc-empty">Selecciona una licitación para revisar su ficha.</div></aside>';
  return `<aside class="cc-detail">
    <div class="cc-detail-head">
      <div class="cc-fit-pill cc-fit-pill--${o.fit_level || 'bajo'}"><strong>${Number(o.fit_score || 0)}%</strong><span>${fitLabel(o.fit_level)}</span></div>
      <button type="button" class="icon-btn" data-cc-save="${o.id}" aria-label="Guardar oportunidad">♡</button>
    </div>
    <h2>${e(o.name)}</h2>
    <p class="cc-detail-buyer">⌂ ${e(o.buyer_name || 'Comprador disponible al cargar detalle')}</p>
    <div class="cc-meta-row"><span>ID ${e(o.external_code)}</span><span>${e(o.procurement_type || 'Licitación pública')}</span><span class="cc-open-dot">● ${e(o.status || 'Publicada')}</span></div>
    <div class="cc-detail-tabs">
      ${[
        ['resumen','Resumen'],
        ['requisitos','Requisitos'],
        ['documentos','Documentos'],
        ['encaje','Encaje comercial']
      ].map(([id,label]) => `<button type="button" data-cc-detail-tab="${id}" class="${chilecompraState.detailTab === id ? 'active' : ''}">${label}</button>`).join('')}
    </div>
    ${detailBody(o)}
    <div class="cc-detail-actions">
      ${o.radar_state === 'crm'
        ? '<button type="button" class="primary-btn" disabled>✓ Ya está en CRM</button>'
        : `<button type="button" class="primary-btn" data-cc-crm="${o.id}">▣ Agregar al CRM</button>`}
      <button type="button" class="ghost-btn" data-cc-save="${o.id}">${o.radar_state === 'guardado' ? '✓ Guardada' : '♡ Guardar'}</button>
      <button type="button" class="ghost-btn" data-cc-discard="${o.id}">⊘ Descartar</button>
      <button type="button" class="link-btn cc-market-link" data-cc-market>Ver en ChileCompra ↗</button>
    </div>
  </aside>`;
}

function resultHeading(rows) {
  if (chilecompraState.searching) return 'Buscando licitaciones activas…';
  if (chilecompraState.tab === 'campanas') {
    const c = CAMPAIGNS.find((x) => x.scope === chilecompraState.activeCampaign);
    return `${rows.length} resultados para ${c?.name || 'campaña'}`;
  }
  if (chilecompraState.tab === 'buscar') {
    if (!chilecompraState.query) return 'Escribe una búsqueda para comenzar';
    return `${rows.length} resultados para “${e(chilecompraState.query)}”`;
  }
  return `${rows.length} oportunidades`;
}

function renderInner() {
  const stats = chilecompraDashboardStats();
  const rows = filteredRows();
  const selected = selectedOpportunity();
  const tabCounts = {
    guardadas: stats.saved,
    crm: stats.crm,
    descartadas: stats.discarded
  };

  return `
    <section class="cc-radar-head cc-radar-head--search">
      <div>
        <h2>Buscar en ChileCompra</h2>
        <p>Busca directamente entre las licitaciones activas de Mercado Público.</p>
      </div>
      <div class="cc-radar-actions">
        <span class="cc-updated"><i></i>${chilecompraState.lastSyncAt ? 'Base actualizada ' + new Date(chilecompraState.lastSyncAt).toLocaleString('es-CL', { dateStyle:'short', timeStyle:'short' }) : 'Base sin actualizar'}</span>
        <button type="button" class="ghost-btn" data-cc-sync ${chilecompraState.syncing ? 'disabled' : ''}>↻ ${chilecompraState.syncing ? 'Actualizando…' : 'Actualizar base'}</button>
      </div>
    </section>

    <form id="ccTraditionalSearch" class="cc-traditional-search">
      <div class="cc-traditional-search-box">
        <span aria-hidden="true">⌕</span>
        <input id="ccSearch" type="search" placeholder="Ej. ascensores, telemetría, mantenimiento, 1234-56-LP26…" value="${e(chilecompraState.query)}" autocomplete="off">
        <button type="submit" class="primary-btn" ${chilecompraState.searching ? 'disabled' : ''}>${chilecompraState.searching ? 'Buscando…' : 'Buscar'}</button>
      </div>
      <small>La búsqueda manual no depende del nivel de encaje ni de las campañas.</small>
    </form>

    <nav class="cc-tabs">
      <button type="button" data-cc-tab="buscar" class="${chilecompraState.tab === 'buscar' ? 'active' : ''}">Búsqueda</button>
      <button type="button" data-cc-tab="campanas" class="${chilecompraState.tab === 'campanas' ? 'active' : ''}">Campañas</button>
      <button type="button" data-cc-tab="guardadas" class="${chilecompraState.tab === 'guardadas' ? 'active' : ''}">Guardadas <span>(${tabCounts.guardadas})</span></button>
      <button type="button" data-cc-tab="crm" class="${chilecompraState.tab === 'crm' ? 'active' : ''}">En CRM <span>(${tabCounts.crm})</span></button>
      <button type="button" data-cc-tab="descartadas" class="${chilecompraState.tab === 'descartadas' ? 'active' : ''}">Descartadas <span>(${tabCounts.descartadas})</span></button>
    </nav>

    <div class="cc-layout">
      <aside class="cc-sidebar">
        <div class="cc-panel-title"><strong>Campañas predefinidas</strong></div>
        <p class="cc-sidebar-help">Son solo tres y siempre consultan Mercado Público al abrirlas.</p>
        <div class="cc-fixed-campaigns">${CAMPAIGNS.map(campaignCard).join('')}</div>

        <div class="cc-filter-block">
          <div class="cc-panel-title"><strong>Mostrar encaje</strong><button type="button" class="link-btn" data-cc-fit-all>Todos</button></div>
          <label><input type="checkbox" data-cc-fit="alto" ${chilecompraState.fit.has('alto') ? 'checked' : ''}> Alto</label>
          <label><input type="checkbox" data-cc-fit="parcial" ${chilecompraState.fit.has('parcial') ? 'checked' : ''}> Parcial</label>
          <label><input type="checkbox" data-cc-fit="bajo" ${chilecompraState.fit.has('bajo') ? 'checked' : ''}> Sin encaje</label>
        </div>
      </aside>

      <main class="cc-results">
        <div class="cc-results-toolbar">
          <strong class="cc-result-title">${resultHeading(rows)}</strong>
          <select id="ccSort" aria-label="Ordenar oportunidades">
            <option value="fit" ${chilecompraState.sort==='fit'?'selected':''}>Mayor encaje</option>
            <option value="close" ${chilecompraState.sort==='close'?'selected':''}>Cierre más próximo</option>
            <option value="recent" ${chilecompraState.sort==='recent'?'selected':''}>Más recientes</option>
          </select>
        </div>
        ${chilecompraState.sourceCount ? `<p class="cc-result-count">Consulta realizada sobre ${chilecompraState.sourceCount.toLocaleString('es-CL')} licitaciones activas.</p>` : ''}
        <div class="cc-opportunity-list">
          ${chilecompraState.searching
            ? '<div class="cc-empty">Consultando Mercado Público…</div>'
            : rows.length
              ? rows.map(opportunityCard).join('')
              : chilecompraState.tab === 'buscar' && !chilecompraState.query
                ? '<div class="cc-empty cc-empty--search"><strong>Busca directamente en ChileCompra</strong><span>Escribe una palabra, servicio o código de licitación y presiona Buscar.</span></div>'
                : chilecompraState.tab === 'campanas' && !chilecompraState.activeCampaign
                  ? '<div class="cc-empty cc-empty--search"><strong>Elige una campaña</strong><span>NEOFF, TaskFlow o TaskFlow + NEOFF.</span></div>'
                  : '<div class="cc-empty">No se encontraron resultados.</div>'}
        </div>
      </main>

      ${detailPanel(selected)}
    </div>`;
}

export function renderChileCompra() {
  return '<div id="chilecompraRoot" class="cc-root"></div>';
}

function rerender() {
  const root = document.getElementById('chilecompraRoot');
  if (!root) return;
  root.innerHTML = renderInner();
}

async function invokeRadar(body) {
  const { data, error } = await supabase.functions.invoke('chilecompra-radar', { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.message || data.error);
  return data;
}

async function runTraditionalSearch(query) {
  const clean = query.trim();
  if (clean.length < 2) return toast('Escribe al menos 2 caracteres para buscar.', 'error');
  chilecompraState.query = clean;
  chilecompraState.tab = 'buscar';
  chilecompraState.activeCampaign = '';
  chilecompraState.searching = true;
  chilecompraState.selectedId = '';
  rerender();
  try {
    const data = await invokeRadar({ action: 'search', query: clean });
    chilecompraState.results = data.results || [];
    chilecompraState.sourceCount = Number(data.sourceCount || 0);
    mergeRows(chilecompraState.results);
    chilecompraState.selectedId = chilecompraState.results[0]?.id || '';
  } finally {
    chilecompraState.searching = false;
    notify();
    rerender();
  }
}

async function runCampaign(scope) {
  const campaign = CAMPAIGNS.find((c) => c.scope === scope);
  if (!campaign) return;
  chilecompraState.tab = 'campanas';
  chilecompraState.activeCampaign = scope;
  chilecompraState.searching = true;
  chilecompraState.selectedId = '';
  rerender();
  try {
    const data = await invokeRadar({ action: 'campaign', scope });
    chilecompraState.results = data.results || [];
    chilecompraState.sourceCount = Number(data.sourceCount || 0);
    mergeRows(chilecompraState.results);
    chilecompraState.selectedId = chilecompraState.results[0]?.id || '';
  } finally {
    chilecompraState.searching = false;
    notify();
    rerender();
  }
}

function replaceEverywhere(updated) {
  const oi = chilecompraState.opportunities.findIndex((o) => o.id === updated.id);
  if (oi >= 0) chilecompraState.opportunities[oi] = updated;
  const ri = chilecompraState.results.findIndex((o) => o.id === updated.id);
  if (ri >= 0) chilecompraState.results[ri] = updated;
}

async function loadDetail(id) {
  const current = [...chilecompraState.results, ...chilecompraState.opportunities].find((o) => o.id === id);
  if (!current || current.detail_loaded) return;
  try {
    const data = await invokeRadar({ action: 'detail', code: current.external_code });
    if (data?.opportunity) {
      replaceEverywhere(data.opportunity);
      notify();
      rerender();
    }
  } catch (err) {
    console.error('No se pudo cargar detalle ChileCompra', err);
    toast('No se pudo cargar el detalle completo.', 'error');
  }
}

async function patchOpportunity(id, patch) {
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  const { data, error } = await supabase.from('chilecompra_opportunities').update(patch).eq('id', id).select('*').single();
  if (error) throw error;
  replaceEverywhere(data);
  notify();
  rerender();
}

async function convertToCrm(id) {
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  const { data, error } = await supabase.rpc('chilecompra_convert_opportunity', { p_opportunity_id: id });
  if (error) throw error;
  await Promise.all([hydrateCrm(), hydrateChileCompra()]);
  const updated = chilecompraState.opportunities.find((o) => o.id === id);
  if (updated) replaceEverywhere(updated);
  toast('Oportunidad agregada al CRM.');
  return data;
}

export function mountChileCompraView() {
  const root = document.getElementById('chilecompraRoot');
  if (!root) return;
  rerender();

  root.addEventListener('submit', async (ev) => {
    if (ev.target.id !== 'ccTraditionalSearch') return;
    ev.preventDefault();
    const query = document.getElementById('ccSearch')?.value || '';
    try {
      await runTraditionalSearch(query);
    } catch (err) {
      chilecompraState.searching = false;
      rerender();
      toast(err.message || 'No se pudo buscar en ChileCompra.', 'error');
    }
  });

  root.addEventListener('click', async (ev) => {
    const select = ev.target.closest('[data-cc-select]');
    if (select) {
      chilecompraState.selectedId = select.dataset.ccSelect;
      chilecompraState.detailTab = 'resumen';
      rerender();
      await loadDetail(chilecompraState.selectedId);
      return;
    }

    const campaign = ev.target.closest('[data-cc-campaign]');
    if (campaign) {
      try {
        await runCampaign(campaign.dataset.ccCampaign);
      } catch (err) {
        chilecompraState.searching = false;
        rerender();
        toast(err.message || 'No se pudo cargar la campaña.', 'error');
      }
      return;
    }

    const tab = ev.target.closest('[data-cc-tab]');
    if (tab) {
      chilecompraState.tab = tab.dataset.ccTab;
      if (chilecompraState.tab === 'buscar') chilecompraState.activeCampaign = '';
      chilecompraState.selectedId = filteredRows()[0]?.id || '';
      rerender();
      return;
    }

    const detailTab = ev.target.closest('[data-cc-detail-tab]');
    if (detailTab) {
      chilecompraState.detailTab = detailTab.dataset.ccDetailTab;
      rerender();
      return;
    }

    if (ev.target.closest('[data-cc-sync]')) {
      try {
        await syncChileCompra();
        rerender();
      } catch (err) {
        toast(err.message || 'No se pudo actualizar la base.', 'error');
      }
      return;
    }

    if (ev.target.closest('[data-cc-fit-all]')) {
      chilecompraState.fit = new Set(['alto','parcial','bajo']);
      rerender();
      return;
    }

    const save = ev.target.closest('[data-cc-save]');
    if (save) {
      const o = [...chilecompraState.results, ...chilecompraState.opportunities].find((x) => x.id === save.dataset.ccSave);
      if (o) await patchOpportunity(o.id, { radar_state: o.radar_state === 'guardado' ? 'nuevo' : 'guardado', updated_at: new Date().toISOString() });
      return;
    }

    const discard = ev.target.closest('[data-cc-discard]');
    if (discard) {
      await patchOpportunity(discard.dataset.ccDiscard, { radar_state: 'descartado', updated_at: new Date().toISOString() });
      return;
    }

    const crm = ev.target.closest('[data-cc-crm]');
    if (crm) {
      await convertToCrm(crm.dataset.ccCrm);
      rerender();
      return;
    }

    if (ev.target.closest('[data-cc-market]')) {
      openExternal('https://www.mercadopublico.cl/BuscarLicitacion');
    }
  });

  root.addEventListener('change', (ev) => {
    const fit = ev.target.closest('[data-cc-fit]');
    if (fit) {
      if (fit.checked) chilecompraState.fit.add(fit.dataset.ccFit);
      else chilecompraState.fit.delete(fit.dataset.ccFit);
      chilecompraState.selectedId = filteredRows()[0]?.id || '';
      rerender();
      return;
    }
    if (ev.target.id === 'ccSort') {
      chilecompraState.sort = ev.target.value;
      chilecompraState.selectedId = filteredRows()[0]?.id || '';
      rerender();
    }
  });

  if (!chilecompraState.hydrated && !chilecompraState.loading) {
    hydrateChileCompra().then(rerender).catch((err) => {
      console.error(err);
      toast('No se pudo cargar ChileCompra.', 'error');
    });
  }
}
