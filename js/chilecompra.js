import { supabase } from './supabase.js';
import { session, isReadOnly } from './auth.js';
import { hydrate as hydrateCrm } from './store.js';
import { escapeHtml as e, fmtDate, openExternal, toast } from './utils.js';

export const chilecompraState = {
  campaigns: [],
  opportunities: [],
  matches: [],
  loading: false,
  syncing: false,
  hydrated: false,
  tab: 'para-ti',
  query: '',
  fit: new Set(['alto', 'parcial']),
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
  chilecompraState.matches = [];
  chilecompraState.loading = false;
  chilecompraState.syncing = false;
  chilecompraState.hydrated = false;
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

export async function hydrateChileCompra() {
  if (session.status !== 'signed-in') return;
  chilecompraState.loading = true;
  notify();
  try {
    const [campaigns, opportunities, matches] = await Promise.all([
      supabase.from('chilecompra_campaigns').select('*').order('created_at', { ascending: true }),
      supabase.from('chilecompra_opportunities').select('*').order('fit_score', { ascending: false }).limit(600),
      supabase.from('chilecompra_campaign_matches').select('*')
    ]);
    if (campaigns.error) throw campaigns.error;
    if (opportunities.error) throw opportunities.error;
    if (matches.error) throw matches.error;

    chilecompraState.campaigns = campaigns.data || [];
    chilecompraState.opportunities = opportunities.data || [];
    chilecompraState.matches = matches.data || [];
    chilecompraState.hydrated = true;
    chilecompraState.lastSyncAt = chilecompraState.opportunities
      .map((o) => o.updated_at)
      .filter(Boolean)
      .sort()
      .at(-1) || '';
    if (!chilecompraState.selectedId) {
      chilecompraState.selectedId = filteredOpportunities()[0]?.id || '';
    }
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
    toast('Radar ChileCompra actualizado.');
  } finally {
    chilecompraState.syncing = false;
    notify();
  }
}

function tabStateMatch(o) {
  if (chilecompraState.tab === 'guardadas') return o.radar_state === 'guardado';
  if (chilecompraState.tab === 'crm') return o.radar_state === 'crm';
  if (chilecompraState.tab === 'descartadas') return o.radar_state === 'descartado';
  if (chilecompraState.tab === 'campanas') return o.radar_state !== 'descartado';
  return o.radar_state === 'nuevo';
}

function campaignMatchIds() {
  if (chilecompraState.tab !== 'campanas') return null;
  const activeIds = new Set(chilecompraState.campaigns.filter((c) => c.active).map((c) => c.id));
  return new Set(chilecompraState.matches.filter((m) => activeIds.has(m.campaign_id)).map((m) => m.opportunity_id));
}

function filteredOpportunities() {
  const q = chilecompraState.query.trim().toLocaleLowerCase('es');
  const campaignIds = campaignMatchIds();
  const rows = chilecompraState.opportunities.filter((o) => {
    if (!tabStateMatch(o)) return false;
    if (!chilecompraState.fit.has(o.fit_level) && chilecompraState.tab !== 'crm') return false;
    if (campaignIds && !campaignIds.has(o.id)) return false;
    if (!q) return true;
    return [o.name, o.description, o.buyer_name, o.external_code, ...(o.matched_capabilities || []), ...(o.matched_solutions || [])]
      .join(' ')
      .toLocaleLowerCase('es')
      .includes(q);
  });

  rows.sort((a, b) => {
    if (chilecompraState.sort === 'close') return String(a.close_at || '9999').localeCompare(String(b.close_at || '9999'));
    if (chilecompraState.sort === 'recent') return String(b.first_seen_at || '').localeCompare(String(a.first_seen_at || ''));
    return (b.fit_score || 0) - (a.fit_score || 0);
  });
  return rows;
}

function selectedOpportunity() {
  return chilecompraState.opportunities.find((o) => o.id === chilecompraState.selectedId) || filteredOpportunities()[0] || null;
}

function fitLabel(level) {
  return level === 'alto' ? 'Encaje alto' : level === 'parcial' ? 'Encaje parcial' : 'Encaje bajo';
}

function amountLabel(o) {
  if (o.amount == null) return 'No informado';
  const currency = o.currency || 'CLP';
  try {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: currency === 'CLP' ? 'CLP' : 'CLP', maximumFractionDigits: 0 }).format(Number(o.amount));
  } catch {
    return String(o.amount);
  }
}

function tag(text) {
  return `<span class="cc-tag">${e(text)}</span>`;
}

function campaignCard(c) {
  return `<div class="cc-campaign-row">
    <span class="cc-campaign-mark ${c.priority}"></span>
    <div class="cc-campaign-copy">
      <strong>${e(c.name)}</strong>
      <small>${e((c.product_scope || []).join(' + ') || 'Radar')} · ${c.priority === 'alta' ? 'Alta prioridad' : c.priority === 'media' ? 'Media prioridad' : 'Baja prioridad'}</small>
    </div>
    <label class="cc-switch" title="${c.active ? 'Desactivar campaña' : 'Activar campaña'}">
      <input type="checkbox" data-cc-campaign-toggle="${c.id}" ${c.active ? 'checked' : ''}>
      <span></span>
    </label>
  </div>`;
}

function opportunityCard(o) {
  const selected = selectedOpportunity()?.id === o.id;
  return `<article class="cc-opportunity ${selected ? 'is-selected' : ''}" data-cc-select="${o.id}">
    <div class="cc-score cc-score--${o.fit_level}">
      <strong>${o.fit_score}%</strong>
      <small>${fitLabel(o.fit_level)}</small>
    </div>
    <div class="cc-opportunity-main">
      <strong class="cc-opportunity-title">${e(o.name)}</strong>
      <span class="cc-buyer">⌂ ${e(o.buyer_name || 'Organismo comprador por cargar')}</span>
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
  return '<p class="muted">La API no entrega información adicional para esta sección.</p>';
}

function detailBody(o) {
  if (chilecompraState.detailTab === 'encaje') {
    return `<section class="cc-detail-section">
      <h4>¿Por qué te interesa?</h4>
      <div class="cc-reasons">${(o.match_reasons || []).map((r) => `<div><span>✓</span><p>${e(r)}</p></div>`).join('') || '<p class="muted">Sin razones calculadas todavía.</p>'}</div>
      <h4>Aplican tus soluciones</h4>
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
    <p class="cc-description">${e(o.description || 'Carga el detalle para obtener la descripción completa de Mercado Público.')}</p>
    <h4>¿Por qué te interesa?</h4>
    <div class="cc-reasons">${(o.match_reasons || []).slice(0, 5).map((r) => `<div><span>✓</span><p>${e(r)}</p></div>`).join('') || '<p class="muted">Analizando encaje comercial.</p>'}</div>
    <h4>Aplican tus soluciones</h4>
    <div class="cc-tags">${(o.matched_solutions || []).map(tag).join('')}${(o.matched_capabilities || []).map(tag).join('')}</div>
  </section>`;
}

function detailPanel(o) {
  if (!o) return '<aside class="cc-detail"><div class="cc-empty">Selecciona una oportunidad para revisar su encaje.</div></aside>';
  return `<aside class="cc-detail">
    <div class="cc-detail-head">
      <div class="cc-fit-pill cc-fit-pill--${o.fit_level}"><strong>${o.fit_score}%</strong><span>${fitLabel(o.fit_level)}</span></div>
      <button type="button" class="icon-btn" data-cc-save="${o.id}" aria-label="Guardar oportunidad">♡</button>
    </div>
    <h2>${e(o.name)}</h2>
    <p class="cc-detail-buyer">⌂ ${e(o.buyer_name || 'Organismo comprador por cargar')}</p>
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
      <button type="button" class="link-btn cc-market-link" data-cc-market="${o.id}">Ver en ChileCompra ↗</button>
    </div>
  </aside>`;
}

function renderInner() {
  const stats = chilecompraDashboardStats();
  const rows = filteredOpportunities();
  const selected = selectedOpportunity();
  const tabCounts = {
    'para-ti': stats.total,
    campanas: chilecompraState.matches.length,
    guardadas: stats.saved,
    crm: stats.crm,
    descartadas: stats.discarded
  };

  return `
    <section class="cc-radar-head">
      <div>
        <h2>Radar ChileCompra</h2>
        <p>Dime qué vendes y te diré quién compra.</p>
      </div>
      <div class="cc-radar-actions">
        <span class="cc-updated"><i></i>${chilecompraState.lastSyncAt ? 'Actualizado ' + new Date(chilecompraState.lastSyncAt).toLocaleString('es-CL', { dateStyle:'short', timeStyle:'short' }) : 'Aún sin sincronizar'}</span>
        <button type="button" class="ghost-btn" data-cc-sync ${chilecompraState.syncing ? 'disabled' : ''}>↻ ${chilecompraState.syncing ? 'Actualizando…' : 'Actualizar ahora'}</button>
        <button type="button" class="primary-btn" data-cc-new-campaign>+ Nueva campaña</button>
      </div>
    </section>

    <nav class="cc-tabs">
      ${[
        ['para-ti','Para ti'],
        ['campanas','Campañas'],
        ['guardadas','Guardadas'],
        ['crm','En CRM'],
        ['descartadas','Descartadas']
      ].map(([id,label]) => `<button type="button" data-cc-tab="${id}" class="${chilecompraState.tab === id ? 'active' : ''}">${label} <span>(${tabCounts[id] || 0})</span></button>`).join('')}
    </nav>

    <div class="cc-layout">
      <aside class="cc-sidebar">
        <div class="cc-panel-title"><strong>Campañas activas</strong><button type="button" class="link-btn" data-cc-tab="campanas">Ver todas</button></div>
        <div class="cc-campaign-list">${chilecompraState.campaigns.map(campaignCard).join('')}</div>
        <button type="button" class="ghost-btn cc-new-campaign-side" data-cc-new-campaign>+ Nueva campaña</button>

        <div class="cc-filter-block">
          <div class="cc-panel-title"><strong>Filtros rápidos</strong><button type="button" class="link-btn" data-cc-clear>Limpiar</button></div>
          <span class="cc-filter-label">Nivel de encaje</span>
          <label><input type="checkbox" data-cc-fit="alto" ${chilecompraState.fit.has('alto') ? 'checked' : ''}> Alto <b>(${chilecompraState.opportunities.filter(o=>o.fit_level==='alto' && o.radar_state==='nuevo').length})</b></label>
          <label><input type="checkbox" data-cc-fit="parcial" ${chilecompraState.fit.has('parcial') ? 'checked' : ''}> Parcial <b>(${chilecompraState.opportunities.filter(o=>o.fit_level==='parcial' && o.radar_state==='nuevo').length})</b></label>
          <label><input type="checkbox" data-cc-fit="bajo" ${chilecompraState.fit.has('bajo') ? 'checked' : ''}> Bajo <b>(${chilecompraState.opportunities.filter(o=>o.fit_level==='bajo' && o.radar_state==='nuevo').length})</b></label>
        </div>
      </aside>

      <main class="cc-results">
        <div class="cc-results-toolbar">
          <div class="cc-search-wrap">⌕<input id="ccSearch" type="search" placeholder="Buscar oportunidades…" value="${e(chilecompraState.query)}"></div>
          <select id="ccSort" aria-label="Ordenar oportunidades">
            <option value="fit" ${chilecompraState.sort==='fit'?'selected':''}>Mayor encaje</option>
            <option value="close" ${chilecompraState.sort==='close'?'selected':''}>Cierre más próximo</option>
            <option value="recent" ${chilecompraState.sort==='recent'?'selected':''}>Más recientes</option>
          </select>
        </div>
        <p class="cc-result-count">${rows.length} oportunidades encontradas</p>
        <div class="cc-opportunity-list">${rows.length ? rows.map(opportunityCard).join('') : '<div class="cc-empty">No hay oportunidades para estos filtros.</div>'}</div>
      </main>

      ${detailPanel(selected)}
    </div>

    <dialog id="ccCampaignDialog" class="modal cc-campaign-dialog">
      <form id="ccCampaignForm" class="modal-card narrow">
        <div class="modal-head"><div><h2>Nueva campaña</h2><p>Describe lo que quieres vender; el radar amplía la búsqueda con tus capacidades.</p></div><button type="button" class="icon-btn" data-cc-campaign-close>×</button></div>
        <div class="form-grid">
          <label class="span-2">Nombre<input id="ccCampaignName" required placeholder="Ej. Monitoreo de grupos electrógenos"></label>
          <label>Producto<select id="ccCampaignProduct"><option>TaskFlow + NEOFF</option><option>TaskFlow</option><option>NEOFF</option></select></label>
          <label>Prioridad<select id="ccCampaignPriority"><option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option></select></label>
          <label class="span-2">¿Qué quieres encontrar?<textarea id="ccCampaignTerms" rows="4" required placeholder="Ej. monitoreo remoto, combustible, alarmas, generadores"></textarea></label>
        </div>
        <div class="modal-actions"><button type="button" class="ghost-btn" data-cc-campaign-close>Cancelar</button><button type="submit" class="primary-btn">Crear campaña</button></div>
      </form>
    </dialog>`;
}

export function renderChileCompra() {
  return '<div id="chilecompraRoot" class="cc-root"></div>';
}

function rerender() {
  const root = document.getElementById('chilecompraRoot');
  if (!root) return;
  root.innerHTML = renderInner();
}

async function loadDetail(id) {
  const current = chilecompraState.opportunities.find((o) => o.id === id);
  if (!current || current.detail_loaded) return;
  try {
    const { data, error } = await supabase.functions.invoke('chilecompra-radar', {
      body: { action: 'detail', code: current.external_code }
    });
    if (error) throw error;
    if (data?.opportunity) {
      const idx = chilecompraState.opportunities.findIndex((o) => o.id === id);
      if (idx >= 0) chilecompraState.opportunities[idx] = data.opportunity;
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
  const idx = chilecompraState.opportunities.findIndex((o) => o.id === id);
  if (idx >= 0) chilecompraState.opportunities[idx] = data;
  notify();
  rerender();
}

async function convertToCrm(id) {
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  const { data, error } = await supabase.rpc('chilecompra_convert_opportunity', { p_opportunity_id: id });
  if (error) throw error;
  await Promise.all([hydrateCrm(), hydrateChileCompra()]);
  toast('Oportunidad agregada al CRM.');
  return data;
}

async function createCampaign() {
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  const name = document.getElementById('ccCampaignName')?.value.trim();
  const termsRaw = document.getElementById('ccCampaignTerms')?.value.trim();
  const product = document.getElementById('ccCampaignProduct')?.value || 'TaskFlow + NEOFF';
  const priority = document.getElementById('ccCampaignPriority')?.value || 'media';
  if (!name || !termsRaw) return toast('Nombre y búsqueda son obligatorios.', 'error');
  const terms = termsRaw.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
  const productScope = product.split(' + ');
  const { error } = await supabase.from('chilecompra_campaigns').insert({
    organization_id: session.profile?.organization_id,
    name,
    product_scope: productScope,
    query_terms: terms,
    priority,
    active: true,
    created_by: session.user?.id
  });
  if (error) throw error;
  await hydrateChileCompra();
  document.getElementById('ccCampaignDialog')?.close();
  rerender();
  toast('Campaña creada y añadida al radar.');
}

export function mountChileCompraView() {
  const root = document.getElementById('chilecompraRoot');
  if (!root) return;
  rerender();

  root.addEventListener('click', async (ev) => {
    const select = ev.target.closest('[data-cc-select]');
    if (select) {
      chilecompraState.selectedId = select.dataset.ccSelect;
      chilecompraState.detailTab = 'resumen';
      rerender();
      await loadDetail(chilecompraState.selectedId);
      return;
    }
    const tab = ev.target.closest('[data-cc-tab]');
    if (tab) {
      chilecompraState.tab = tab.dataset.ccTab;
      const first = filteredOpportunities()[0];
      chilecompraState.selectedId = first?.id || '';
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
      await syncChileCompra();
      rerender();
      return;
    }
    if (ev.target.closest('[data-cc-new-campaign]')) {
      document.getElementById('ccCampaignDialog')?.showModal();
      return;
    }
    if (ev.target.closest('[data-cc-campaign-close]')) {
      document.getElementById('ccCampaignDialog')?.close();
      return;
    }
    const save = ev.target.closest('[data-cc-save]');
    if (save) {
      const o = chilecompraState.opportunities.find((x) => x.id === save.dataset.ccSave);
      await patchOpportunity(o.id, { radar_state: o.radar_state === 'guardado' ? 'nuevo' : 'guardado', updated_at: new Date().toISOString() });
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
    const market = ev.target.closest('[data-cc-market]');
    if (market) {
      openExternal('https://www.mercadopublico.cl/BuscarLicitacion');
      return;
    }
    if (ev.target.closest('[data-cc-clear]')) {
      chilecompraState.fit = new Set(['alto','parcial']);
      chilecompraState.query = '';
      rerender();
    }
  });

  root.addEventListener('change', async (ev) => {
    const toggle = ev.target.closest('[data-cc-campaign-toggle]');
    if (toggle) {
      const { error } = await supabase.from('chilecompra_campaigns').update({ active: toggle.checked, updated_at: new Date().toISOString() }).eq('id', toggle.dataset.ccCampaignToggle);
      if (error) return toast(error.message, 'error');
      await hydrateChileCompra();
      rerender();
      return;
    }
    const fit = ev.target.closest('[data-cc-fit]');
    if (fit) {
      if (fit.checked) chilecompraState.fit.add(fit.dataset.ccFit);
      else chilecompraState.fit.delete(fit.dataset.ccFit);
      chilecompraState.selectedId = filteredOpportunities()[0]?.id || '';
      rerender();
      return;
    }
    if (ev.target.id === 'ccSort') {
      chilecompraState.sort = ev.target.value;
      rerender();
    }
  });

  root.addEventListener('input', (ev) => {
    if (ev.target.id !== 'ccSearch') return;
    chilecompraState.query = ev.target.value;
    const cursor = ev.target.selectionStart;
    rerender();
    const next = document.getElementById('ccSearch');
    if (next) {
      next.focus();
      try { next.setSelectionRange(cursor, cursor); } catch {}
    }
  });

  root.addEventListener('submit', async (ev) => {
    if (ev.target.id !== 'ccCampaignForm') return;
    ev.preventDefault();
    try { await createCampaign(); } catch (err) { toast(err.message || 'No se pudo crear la campaña.', 'error'); }
  });

  if (!chilecompraState.hydrated && !chilecompraState.loading) {
    hydrateChileCompra().then(rerender).catch((err) => {
      console.error(err);
      toast('No se pudo cargar el Radar ChileCompra.', 'error');
    });
  }
}
