import { supabase } from './supabase.js';
import { isReadOnly, session } from './auth.js';
import { hydrate as hydrateCrm } from './store.js';
import { escapeHtml as e, fmtDate, openExternal, toast } from './utils.js';

export const chilecompraState = {
  opportunities: [],
  campaigns: [],
  matches: [],
  marketProfile: null,
  analytics: null,
  analyticsLoading: false,
  analyticsUniverse: 'campaigns',
  analyticsMetric: 'publications',
  analyticsGroupBy: 'industry',
  loading: false,
  syncing: false,
  searching: false,
  hydrated: false,
  tab: 'resumen',
  query: '',
  results: [],
  sourceCount: 0,
  selectedCampaignId: '',
  selectedId: '',
  detailTab: 'resumen',
  sort: 'recent',
  lastSyncAt: ''
};

const listeners = new Set();
export const onChileCompraChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const notify = () => listeners.forEach((fn) => fn(chilecompraState));

export function clearChileCompra() {
  Object.assign(chilecompraState, {
    opportunities: [], campaigns: [], matches: [], marketProfile: null, analytics: null,
    analyticsLoading: false, loading: false, syncing: false, searching: false,
    hydrated: false, tab: 'resumen', query: '', results: [], sourceCount: 0,
    selectedCampaignId: '', selectedId: '', detailTab: 'resumen', sort: 'recent', lastSyncAt: ''
  });
  notify();
}

function activeCampaigns() {
  return chilecompraState.campaigns.filter((c) => c.active);
}

function opportunityMap() {
  return new Map(chilecompraState.opportunities.map((o) => [o.id, o]));
}

function activeCampaignIds() {
  return new Set(activeCampaigns().map((c) => c.id));
}

function campaignMatchesForOpportunity(opportunityId) {
  const active = activeCampaignIds();
  return chilecompraState.matches.filter((m) => m.opportunity_id === opportunityId && active.has(m.campaign_id));
}

function campaignsForOpportunity(opportunityId) {
  const ids = new Set(campaignMatchesForOpportunity(opportunityId).map((m) => m.campaign_id));
  return chilecompraState.campaigns.filter((c) => ids.has(c.id));
}

export function chilecompraDashboardStats() {
  const campaigns = activeCampaigns();
  const activeIds = new Set(campaigns.map((c) => c.id));
  const byOpportunity = opportunityMap();
  const matches = chilecompraState.matches.filter((m) => activeIds.has(m.campaign_id));
  const newMatches = matches.filter((m) => !m.reviewed_at && byOpportunity.get(m.opportunity_id)?.radar_state === 'nuevo');
  const newOpportunityIds = new Set(newMatches.map((m) => m.opportunity_id));
  const matchedOpportunityIds = new Set(matches.map((m) => m.opportunity_id));
  const matchedOpportunities = [...matchedOpportunityIds].map((id) => byOpportunity.get(id)).filter(Boolean);
  const buyers = new Set(matchedOpportunities.map((o) => o.buyer_name).filter(Boolean));
  const amount = matchedOpportunities.reduce((sum, o) => sum + Number(o.amount || 0), 0);
  const newByCampaign = Object.fromEntries(
    campaigns.map((c) => [
      c.id,
      new Set(newMatches.filter((m) => m.campaign_id === c.id).map((m) => m.opportunity_id)).size
    ])
  );
  return {
    total: newOpportunityIds.size,
    activeCampaigns: campaigns.length,
    campaigns,
    newByCampaign,
    buyers: buyers.size,
    amount,
    saved: chilecompraState.opportunities.filter((o) => o.radar_state === 'guardado').length,
    crm: chilecompraState.opportunities.filter((o) => o.radar_state === 'crm').length,
    discarded: chilecompraState.opportunities.filter((o) => o.radar_state === 'descartado').length,
    lastSyncAt: chilecompraState.lastSyncAt
  };
}

const LOCAL_INDUSTRIES = [
  ['Tecnología / Software', ['software','sistema','plataforma','saas','licencia','digital','tecnologia','informatico','computacional']],
  ['Salud', ['hospital','salud','clinica','cesfam','medico','farmacia']],
  ['Telecomunicaciones', ['telecom','fibra','antena','radioenlace','lte','5g','conectividad','red de datos']],
  ['Seguridad / Defensa', ['seguridad','ejercito','armada','carabineros','pdi','defensa','armamento','municion']],
  ['Educación', ['universidad','educacion','colegio','liceo','escuela','junaeb']],
  ['Construcción / Infraestructura', ['construccion','obra','infraestructura','edificio','reparacion']],
  ['Energía / Utilities', ['energia','electrico','agua potable','sanitaria','generador','electrogeno']],
  ['Transporte / Logística', ['transporte','logistica','vehiculo','camion','metro']],
  ['Industria / Minería', ['mineria','industrial','planta','faena','proceso productivo']]
];

function normalized(value = '') {
  return String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es');
}

function localIndustry(o) {
  const text = normalized([o.name, o.description, o.buyer_name].filter(Boolean).join(' '));
  for (const [label, terms] of LOCAL_INDUSTRIES) {
    if (terms.some((term) => text.includes(normalized(term)))) return label;
  }
  return 'Otros';
}

export function chilecompraLocalBreakdown({ metric = 'publications' } = {}) {
  const activeIds = activeCampaignIds();
  const ids = new Set(chilecompraState.matches.filter((m) => activeIds.has(m.campaign_id)).map((m) => m.opportunity_id));
  const rows = chilecompraState.opportunities.filter((o) => ids.has(o.id));
  const groups = new Map();
  const buyerGroups = new Map();
  rows.forEach((o) => {
    const key = localIndustry(o);
    if (metric === 'buyers') {
      if (!buyerGroups.has(key)) buyerGroups.set(key, new Set());
      if (o.buyer_name) buyerGroups.get(key).add(o.buyer_name);
    } else {
      groups.set(key, (groups.get(key) || 0) + (metric === 'amount' ? Number(o.amount || 0) : 1));
    }
  });
  if (metric === 'buyers') buyerGroups.forEach((set, key) => groups.set(key, set.size));
  let categories = [...groups.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  if (categories.length > 7) {
    const rest = categories.slice(6).reduce((sum, x) => sum + x.value, 0);
    categories = [...categories.slice(0, 6), { label: 'Otros', value: rest }];
  }
  return {
    universe: 'campaigns', metric, configured: activeCampaigns().length > 0,
    publications: rows.length,
    buyers: new Set(rows.map((o) => o.buyer_name).filter(Boolean)).size,
    amount: rows.reduce((sum, o) => sum + Number(o.amount || 0), 0),
    categories
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
    const [campaigns, opportunities, matches, profile] = await Promise.all([
      supabase.from('chilecompra_campaigns').select('*').order('created_at', { ascending: true }),
      supabase.from('chilecompra_opportunities').select('*').order('updated_at', { ascending: false }).limit(1200),
      supabase.from('chilecompra_campaign_matches').select('*').order('updated_at', { ascending: false }).limit(5000),
      supabase.from('chilecompra_market_profiles').select('*').maybeSingle()
    ]);
    if (campaigns.error) throw campaigns.error;
    if (opportunities.error) throw opportunities.error;
    if (matches.error) throw matches.error;
    if (profile.error && profile.error.code !== 'PGRST116') throw profile.error;
    chilecompraState.campaigns = campaigns.data || [];
    chilecompraState.opportunities = opportunities.data || [];
    chilecompraState.matches = matches.data || [];
    chilecompraState.marketProfile = profile.data || null;
    chilecompraState.hydrated = true;
    chilecompraState.lastSyncAt = chilecompraState.matches.map((m) => m.updated_at).filter(Boolean).sort().at(-1) || '';
  } finally {
    chilecompraState.loading = false;
    notify();
  }
}

async function invokeRadar(body) {
  const { data, error } = await supabase.functions.invoke('chilecompra-radar', { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.message || data.error);
  return data || {};
}

export async function syncChileCompra() {
  if (chilecompraState.syncing) return;
  if (!activeCampaigns().length) return toast('Crea una campaña activa antes de actualizar el radar.', 'error');
  chilecompraState.syncing = true;
  notify();
  try {
    await invokeRadar({ action: 'sync' });
    await hydrateChileCompra();
    toast('Radar ChileCompra actualizado.');
  } finally {
    chilecompraState.syncing = false;
    notify();
  }
}

export async function loadChileCompraAnalytics({ universe, metric, groupBy } = {}) {
  chilecompraState.analyticsUniverse = universe || chilecompraState.analyticsUniverse;
  chilecompraState.analyticsMetric = metric || chilecompraState.analyticsMetric;
  chilecompraState.analyticsGroupBy = groupBy || chilecompraState.analyticsGroupBy;
  chilecompraState.analyticsLoading = true;
  notify();
  try {
    const data = await invokeRadar({
      action: 'analytics',
      universe: chilecompraState.analyticsUniverse,
      metric: chilecompraState.analyticsMetric,
      groupBy: chilecompraState.analyticsGroupBy
    });
    chilecompraState.analytics = data;
    return data;
  } finally {
    chilecompraState.analyticsLoading = false;
    notify();
  }
}

function parseTerms(value) {
  return [...new Set(String(value || '').split(/[\n,;]+/).map((x) => x.trim()).filter((x) => x.length >= 2))];
}

const CAMPAIGN_TERM_RECOMMENDATIONS = [
  {
    triggers: ['telemetria','monitoreo remoto','scada','sensor','iot','internet de las cosas'],
    terms: ['telemetría','monitoreo remoto','SCADA','sensores','adquisición de datos','IoT','monitoreo en línea','gateway']
  },
  {
    triggers: ['rfid','radiofrecuencia','trazabilidad','tag','etiqueta electronica'],
    terms: ['RFID','radiofrecuencia','trazabilidad','tags RFID','etiquetas electrónicas','control de activos','inventario','lectores RFID']
  },
  {
    triggers: ['software','saas','plataforma','sistema','digitalizacion','aplicacion'],
    terms: ['software','plataforma','SaaS','licencias de software','sistema de gestión','digitalización','integración de sistemas','solución tecnológica']
  },
  {
    triggers: ['telecom','telecomunicacion','fibra optica','conectividad','radioenlace','lte','5g'],
    terms: ['telecomunicaciones','fibra óptica','conectividad','radioenlace','LTE','5G','redes de datos','enlaces de comunicación']
  },
  {
    triggers: ['seguridad','control de acceso','cctv','videovigilancia','camara'],
    terms: ['seguridad electrónica','control de acceso','CCTV','videovigilancia','cámaras de seguridad','monitoreo','alarma','credenciales']
  },
  {
    triggers: ['mantenimiento','mantencion','servicio tecnico','preventivo','correctivo'],
    terms: ['mantenimiento preventivo','mantenimiento correctivo','servicio técnico','gestión de mantenimiento','soporte técnico','reparación','inspección técnica']
  },
  {
    triggers: ['ascensor','elevador','transporte vertical'],
    terms: ['ascensores','elevadores','transporte vertical','modernización de ascensores','repuestos de ascensores','mantención de ascensores','monitoreo de ascensores']
  },
  {
    triggers: ['hvac','climatizacion','aire acondicionado','ventilacion','calefaccion'],
    terms: ['HVAC','climatización','aire acondicionado','ventilación','calefacción','chiller','equipos de climatización','control de temperatura']
  },
  {
    triggers: ['energia','electrogeno','generador','ups','respaldo electrico'],
    terms: ['grupos electrógenos','generadores','UPS','respaldo eléctrico','energía','tableros eléctricos','monitoreo energético','mantenimiento eléctrico']
  },
  {
    triggers: ['salud','hospital','clinica','cesfam','medico'],
    terms: ['hospital','servicio de salud','CESFAM','clínica','equipamiento médico','software de salud','gestión clínica','monitoreo de pacientes']
  },
  {
    triggers: ['educacion','universidad','colegio','liceo','escuela'],
    terms: ['educación','universidad','colegio','liceo','plataforma educativa','equipamiento tecnológico','software educativo','conectividad escolar']
  },
  {
    triggers: ['mineria','faena','tunel','industrial','planta'],
    terms: ['minería','faena minera','túneles','operación industrial','monitoreo industrial','sensores industriales','comunicaciones mineras','automatización industrial']
  },
  {
    triggers: ['logistica','transporte','flota','bodega','almacen'],
    terms: ['logística','gestión de flota','transporte','bodega','inventario','trazabilidad','seguimiento de activos','control de despacho']
  },
  {
    triggers: ['construccion','obra','infraestructura','edificio'],
    terms: ['construcción','obras civiles','infraestructura','edificación','inspección de obras','mantenimiento de infraestructura','equipamiento de edificios']
  },
  {
    triggers: ['luminaria','luminarias','iluminacion','iluminación','alumbrado','venta de luminarias','suministro de luminarias'],
    terms: ['luminarias LED','venta de luminarias','suministro de luminarias','iluminación LED','alumbrado público','equipos de iluminación','lámparas LED','proyectores LED','luminarias viales','luminarias exteriores']
  },
  {
    triggers: ['instalacion de luminarias','instalación de luminarias','montaje de luminarias','instalacion electrica luminarias','instalación eléctrica luminarias','recambio de luminarias'],
    terms: ['instalación de luminarias','montaje de luminarias','recambio de luminarias','instalación eléctrica','alumbrado público','mantención de luminarias','reposición de luminarias','proyecto de iluminación','normalización eléctrica','luminarias LED']
  },
  {
    triggers: ['ds1','ds 1','decreto supremo 1','ds1 luminarias','ds 1 luminarias','decreto supremo 1 luminarias','contaminacion luminica','contaminación lumínica','luminosidad artificial'],
    terms: ['DS1 luminarias','Decreto Supremo N°1/2022 MMA','cumplimiento DS1','contaminación lumínica','alumbrado exterior','luminarias para alumbrado exterior','luminarias LED DS1','proyectores de alumbrado exterior','certificación de luminarias','ensayo de luminarias','control de luminosidad artificial','alumbrado público']
  }
];

function campaignTermSuggestions(name = '', termsText = '') {
  const typedTerms = parseTerms(termsText);
  const existing = new Set(typedTerms.map((x) => normalized(x)));
  const hay = normalized([name, termsText].filter(Boolean).join(' '));
  if (hay.trim().length < 2) return [];

  const scored = [];
  CAMPAIGN_TERM_RECOMMENDATIONS.forEach((group) => {
    const score = group.triggers.reduce((acc, trigger) => {
      const t = normalized(trigger);
      return acc + (hay.includes(t) ? Math.max(2, t.split(' ').length + 1) : 0);
    }, 0);
    if (!score) return;
    group.terms.forEach((term, index) => {
      if (!existing.has(normalized(term))) scored.push({ term, score: score * 100 - index });
    });
  });

  return [...new Map(scored.sort((a,b) => b.score-a.score).map((x) => [normalized(x.term), x.term])).values()].slice(0, 10);
}

function renderCampaignTermSuggestions() {
  const box = document.getElementById('ccCampaignSuggestions');
  if (!box) return;
  const name = document.getElementById('ccCampaignName')?.value || '';
  const terms = document.getElementById('ccCampaignTerms')?.value || '';
  const suggestions = campaignTermSuggestions(name, terms);

  box.innerHTML = suggestions.length
    ? `<div class="cc-suggestion-head"><strong>Recomendaciones</strong><span>Toca una para agregarla</span></div>
       <div class="cc-suggestion-chips">${suggestions.map((term) => `<button type="button" data-cc-term-suggestion="${e(term)}">+${e(term)}</button>`).join('')}</div>`
    : `<div class="cc-suggestion-hint">Escribe el nombre o una palabra clave y te sugeriremos búsquedas relacionadas.</div>`;
}

function addCampaignSuggestion(term) {
  const input = document.getElementById('ccCampaignTerms');
  if (!input) return;
  const current = parseTerms(input.value);
  if (!current.some((x) => normalized(x) === normalized(term))) current.push(term);
  input.value = current.join(', ');
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function createCampaign({ name, terms }) {
  if (isReadOnly()) throw new Error('Tu perfil es de solo lectura.');
  const organizationId = session.profile?.organization_id;
  if (!organizationId) throw new Error('No se pudo resolver tu organización.');
  const queryTerms = parseTerms(terms);
  if (!name.trim()) throw new Error('Escribe un nombre para la campaña.');
  if (!queryTerms.length) throw new Error('Agrega al menos una palabra o frase de búsqueda.');
  const { data, error } = await supabase.from('chilecompra_campaigns').insert({
    organization_id: organizationId,
    name: name.trim(),
    product_scope: [],
    query_terms: queryTerms,
    priority: 'media',
    active: true,
    system_seed: false
  }).select('*').single();
  if (error) throw error;
  chilecompraState.campaigns.push(data);
  notify();
  await runCampaign(data.id);
  return data;
}

async function runCampaign(campaignId) {
  const data = await invokeRadar({ action: 'campaign', campaignId });
  mergeRows(data.results || []);
  chilecompraState.sourceCount = Number(data.sourceCount || 0);
  await hydrateChileCompra();
  return data;
}

async function toggleCampaign(id, active) {
  if (isReadOnly()) throw new Error('Tu perfil es de solo lectura.');
  const { error } = await supabase.from('chilecompra_campaigns').update({ active, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
  const campaign = chilecompraState.campaigns.find((c) => c.id === id);
  if (campaign) campaign.active = active;
  notify();
  if (active) await runCampaign(id);
}

async function saveBusinessProfile(termsText) {
  if (isReadOnly()) throw new Error('Tu perfil es de solo lectura.');
  const organizationId = session.profile?.organization_id;
  if (!organizationId) throw new Error('No se pudo resolver tu organización.');
  const terms = parseTerms(termsText);
  const { data, error } = await supabase.from('chilecompra_market_profiles').upsert({
    organization_id: organizationId,
    name: 'Mi negocio',
    query_terms: terms,
    updated_by: session.user?.id || null,
    updated_at: new Date().toISOString()
  }, { onConflict: 'organization_id' }).select('*').single();
  if (error) throw error;
  chilecompraState.marketProfile = data;
  chilecompraState.analytics = null;
  notify();
  return data;
}

function matchedOpportunityIds(campaignId = '') {
  const activeIds = activeCampaignIds();
  return new Set(chilecompraState.matches
    .filter((m) => campaignId ? m.campaign_id === campaignId : activeIds.has(m.campaign_id))
    .map((m) => m.opportunity_id));
}

function rowSource() {
  if (chilecompraState.tab === 'coincidencias') {
    const ids = matchedOpportunityIds(chilecompraState.selectedCampaignId);
    return chilecompraState.opportunities.filter((o) => ids.has(o.id) && o.radar_state !== 'descartado');
  }
  if (chilecompraState.tab === 'guardadas') return chilecompraState.opportunities.filter((o) => o.radar_state === 'guardado');
  if (chilecompraState.tab === 'crm') return chilecompraState.opportunities.filter((o) => o.radar_state === 'crm');
  if (chilecompraState.tab === 'descartadas') return chilecompraState.opportunities.filter((o) => o.radar_state === 'descartado');
  return chilecompraState.results;
}

function filteredRows() {
  const rows = [...rowSource()];
  rows.sort((a, b) => chilecompraState.sort === 'close'
    ? String(a.close_at || '9999').localeCompare(String(b.close_at || '9999'))
    : String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  return rows;
}

function selectedOpportunity() {
  const all = [...chilecompraState.results, ...chilecompraState.opportunities];
  return all.find((o) => o.id === chilecompraState.selectedId) || filteredRows()[0] || null;
}

function amountLabel(o) {
  if (o.amount == null) return 'No informado';
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(o.amount || 0));
}

function compactAmount(value) {
  const n = Number(value || 0);
  if (!n) return '$0';
  if (n >= 1_000_000_000) return '$' + (n / 1_000_000_000).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + ' mil MM';
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toLocaleString('es-CL', { maximumFractionDigits: 0 }) + ' MM';
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
}

function tag(text) {
  return `<span class="cc-tag">${e(text)}</span>`;
}

function matchedTerms(o) {
  return [...new Set(campaignMatchesForOpportunity(o.id).flatMap((m) => m.matched_terms || []))];
}

function campaignTags(o) {
  return campaignsForOpportunity(o.id).map((c) => tag(c.name)).join('');
}

function opportunityCard(o) {
  const campaigns = campaignsForOpportunity(o.id);
  return `<article class="cc-opportunity ${selectedOpportunity()?.id === o.id ? 'is-selected' : ''}" data-cc-select="${o.id}">
    <div class="cc-match-count"><strong>${campaigns.length || '•'}</strong><small>${campaigns.length === 1 ? 'campaña' : campaigns.length ? 'campañas' : 'búsqueda'}</small></div>
    <div class="cc-opportunity-main">
      <strong class="cc-opportunity-title">${e(o.name)}</strong>
      <span class="cc-buyer">⌂ ${e(o.buyer_name || 'Comprador disponible al abrir el detalle')}</span>
      <div class="cc-meta-row"><span>ID ${e(o.external_code)}</span><span>${e(o.procurement_type || 'Licitación pública')}</span><span class="cc-open-dot">● ${e(o.status || 'Publicada')}</span></div>
      <div class="cc-tags">${campaignTags(o)}${matchedTerms(o).slice(0, 3).map(tag).join('')}</div>
    </div>
    <div class="cc-opportunity-side"><small>Cierre</small><strong>${o.close_at ? fmtDate(o.close_at.slice(0, 10)) : 'Sin fecha'}</strong><small>Monto estimado</small><strong>${e(amountLabel(o))}</strong></div>
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
  if (chilecompraState.detailTab === 'coincidencias') {
    const campaigns = campaignsForOpportunity(o.id);
    const terms = matchedTerms(o);
    return `<section class="cc-detail-section"><h4>Campañas que encontraron esta publicación</h4><div class="cc-tags">${campaigns.length ? campaigns.map((c) => tag(c.name)).join('') : '<span class="muted">Resultado de búsqueda manual.</span>'}</div><h4>Términos coincidentes</h4><div class="cc-tags">${terms.length ? terms.map(tag).join('') : '<span class="muted">Sin términos asociados.</span>'}</div></section>`;
  }
  if (chilecompraState.detailTab === 'requisitos') return `<section class="cc-detail-section"><h4>Requisitos</h4>${rawSection(o, ['RequisitosGenerales','AntecedentesTecnicos','Requisitos','Antecedentes'])}</section>`;
  if (chilecompraState.detailTab === 'documentos') return `<section class="cc-detail-section"><h4>Documentos</h4>${rawSection(o, ['Documentos','Adjuntos','Archivos','Items'])}</section>`;
  return `<section class="cc-detail-section"><div class="cc-detail-facts"><div><small>Cierre</small><strong>${o.close_at ? fmtDate(o.close_at.slice(0, 10)) : 'Sin fecha'}</strong></div><div><small>Monto estimado</small><strong>${e(amountLabel(o))}</strong></div><div><small>Publicación</small><strong>${o.published_at ? fmtDate(o.published_at.slice(0, 10)) : 'No informada'}</strong></div></div><h4>Descripción</h4><p class="cc-description">${e(o.description || 'Abre el detalle para consultar la ficha completa de Mercado Público.')}</p><h4>Campañas relacionadas</h4><div class="cc-tags">${campaignTags(o) || '<span class="muted">Búsqueda manual.</span>'}</div></section>`;
}

function detailPanel(o) {
  if (!o) return '<aside class="cc-detail"><div class="cc-empty">Selecciona una licitación para revisar su ficha.</div></aside>';
  const campaigns = campaignsForOpportunity(o.id);
  return `<aside class="cc-detail">
    <div class="cc-detail-head"><div class="cc-detail-campaign-summary"><strong>${campaigns.length}</strong><span>${campaigns.length === 1 ? 'campaña coincide' : 'campañas coinciden'}</span></div><button type="button" class="icon-btn" data-cc-save="${o.id}" aria-label="Guardar oportunidad">♡</button></div>
    <h2>${e(o.name)}</h2><p class="cc-detail-buyer">⌂ ${e(o.buyer_name || 'Comprador disponible al cargar detalle')}</p>
    <div class="cc-meta-row"><span>ID ${e(o.external_code)}</span><span>${e(o.procurement_type || 'Licitación pública')}</span><span class="cc-open-dot">● ${e(o.status || 'Publicada')}</span></div>
    <div class="cc-detail-tabs">${[['resumen','Resumen'],['requisitos','Requisitos'],['documentos','Documentos'],['coincidencias','Coincidencias']].map(([id,label]) => `<button type="button" data-cc-detail-tab="${id}" class="${chilecompraState.detailTab === id ? 'active' : ''}">${label}</button>`).join('')}</div>
    ${detailBody(o)}
    <div class="cc-detail-actions">${o.radar_state === 'crm' ? '<button type="button" class="primary-btn" disabled>✓ Ya está en CRM</button>' : `<button type="button" class="primary-btn" data-cc-crm="${o.id}">▣ Agregar al CRM</button>`}<button type="button" class="ghost-btn" data-cc-save="${o.id}">${o.radar_state === 'guardado' ? '✓ Guardada' : '♡ Guardar'}</button><button type="button" class="ghost-btn" data-cc-discard="${o.id}">⊘ Descartar</button><button type="button" class="link-btn cc-market-link" data-cc-market>Ver en ChileCompra ↗</button></div>
  </aside>`;
}

function resultHeading(rows) {
  if (chilecompraState.searching) return 'Buscando licitaciones activas…';
  if (chilecompraState.tab === 'buscar') return chilecompraState.query ? `${rows.length} resultados para “${e(chilecompraState.query)}”` : 'Escribe una búsqueda para comenzar';
  if (chilecompraState.tab === 'coincidencias') {
    const campaign = chilecompraState.campaigns.find((c) => c.id === chilecompraState.selectedCampaignId);
    return campaign ? `${rows.length} coincidencias · ${e(campaign.name)}` : `${rows.length} coincidencias`;
  }
  return `${rows.length} oportunidades`;
}

function marketBars(data) {
  const categories = (data?.categories || []).filter((x) => Number(x.value || 0) > 0);
  const total = categories.reduce((sum, x) => sum + Number(x.value || 0), 0);
  if (!categories.length || total <= 0) {
    return `<div class="cc-market-empty"><strong>Sin datos para este universo</strong><span>${data?.configured === false ? 'Configura las palabras clave para comenzar el análisis.' : 'Todavía no hay información suficiente.'}</span></div>`;
  }
  const top = categories.slice(0, 8);
  const metric = data?.metric || chilecompraState.analyticsMetric || 'publications';
  const unit = metric === 'amount' ? 'monto observado' : metric === 'buyers' ? 'compradores' : 'publicaciones';
  const totalLabel = metric === 'amount' ? compactAmount(total) : total.toLocaleString('es-CL');
  return `<div class="cc-market-bars">
    <div class="cc-market-bars-summary"><strong>${e(totalLabel)}</strong><span>${e(unit)}</span></div>
    <div class="cc-market-bars-list">${top.map((x) => {
      const value = Number(x.value || 0);
      const pct = total ? (value / total) * 100 : 0;
      const shown = metric === 'amount' ? compactAmount(value) : value.toLocaleString('es-CL');
      return `<div class="cc-market-bar-row">
        <div class="cc-market-bar-label"><span>${e(x.label)}</span><strong>${e(shown)} · ${pct.toFixed(0)}%</strong></div>
        <div class="cc-market-bar-track"><i style="width:${Math.max(2,pct).toFixed(1)}%"></i></div>
      </div>`;
    }).join('')}</div>
  </div>`;
}

function analyticsControls() {
  return `<div class="cc-analytics-controls">
    <label>Universo<select id="ccAnalyticsUniverse"><option value="campaigns" ${chilecompraState.analyticsUniverse === 'campaigns' ? 'selected' : ''}>Mis campañas</option><option value="business" ${chilecompraState.analyticsUniverse === 'business' ? 'selected' : ''}>Mi negocio</option><option value="general" ${chilecompraState.analyticsUniverse === 'general' ? 'selected' : ''}>Mercado general Chile</option></select></label>
    <label>Métrica<select id="ccAnalyticsMetric"><option value="publications" ${chilecompraState.analyticsMetric === 'publications' ? 'selected' : ''}>Publicaciones</option><option value="amount" ${chilecompraState.analyticsMetric === 'amount' ? 'selected' : ''}>Monto publicado</option><option value="buyers" ${chilecompraState.analyticsMetric === 'buyers' ? 'selected' : ''}>Compradores</option></select></label>
    <label>Agrupar por<select id="ccAnalyticsGroupBy"><option value="industry" ${chilecompraState.analyticsGroupBy === 'industry' ? 'selected' : ''}>Rubro</option><option value="orgType" ${chilecompraState.analyticsGroupBy === 'orgType' ? 'selected' : ''}>Tipo de organización</option><option value="procurementType" ${chilecompraState.analyticsGroupBy === 'procurementType' ? 'selected' : ''}>Tipo de publicación</option></select></label>
    ${chilecompraState.analyticsUniverse === 'business' ? '<button type="button" class="ghost-btn cc-config-business" data-cc-business-open>Configurar mi negocio</button>' : ''}
  </div>`;
}

function campaignRow(c, stats, { controls = true } = {}) {
  const count = stats.newByCampaign?.[c.id] || 0;
  return `<article class="cc-user-campaign" data-cc-campaign-open="${c.id}"><div class="cc-user-campaign-icon">⌖</div><div class="cc-user-campaign-copy"><strong>${e(c.name)}</strong><span>${e((c.query_terms || []).slice(0, 4).join(', ') || 'Sin términos configurados')}</span></div><b>${count}</b>${controls ? `<label class="cc-switch" title="${c.active ? 'Desactivar' : 'Activar'} campaña"><input type="checkbox" data-cc-campaign-toggle="${c.id}" ${c.active ? 'checked' : ''}><span></span></label>` : ''}<span class="cc-chevron">›</span></article>`;
}

function dashboardNav(stats) {
  const primary = [
    ['resumen','Resumen',''],
    ['coincidencias','Coincidencias',stats.total],
    ['campanas','Seguimientos',stats.activeCampaigns],
    ['buscar','Buscar','']
  ];
  const secondary = [
    ['mercado','Mercado'],
    ['compradores','Compradores'],
    ['guardadas','Guardadas'],
    ['crm','En CRM']
  ];
  const secondaryActive = secondary.some(([id]) => chilecompraState.tab === id);
  return `<div class="cc-dashboard-nav">
    <nav class="cc-tabs cc-dashboard-tabs">
      ${primary.map(([id,label,count]) => `<button type="button" data-cc-tab="${id}" class="${chilecompraState.tab === id ? 'active' : ''}">${label}${count !== '' ? ` <span>(${count})</span>` : ''}</button>`).join('')}
    </nav>
    <details class="cc-more-menu" ${secondaryActive ? 'open' : ''}>
      <summary class="${secondaryActive ? 'active' : ''}">Más</summary>
      <div>
        ${secondary.map(([id,label]) => `<button type="button" data-cc-tab="${id}" class="${chilecompraState.tab === id ? 'active' : ''}">${label}</button>`).join('')}
      </div>
    </details>
  </div>`;
}

function sharedDialogs() {
  return `<dialog id="ccCampaignDialog" class="modal cc-campaign-dialog"><form id="ccCampaignForm" class="modal-card"><div class="modal-head"><div><h2>Crear seguimiento</h2><p>Dinos qué vendes o qué oportunidad quieres detectar. El CRM buscará coincidencias por ti.</p></div><button type="button" class="icon-btn" data-cc-dialog-close="ccCampaignDialog">×</button></div><div class="form-grid"><label class="span-2">Nombre del seguimiento<input id="ccCampaignName" required placeholder="Ej. Telemetría industrial"></label><label class="span-2">Palabras o frases a seguir<textarea id="ccCampaignTerms" rows="5" required placeholder="Escribe palabras o frases de búsqueda"></textarea></label></div><div id="ccCampaignSuggestions" class="cc-campaign-suggestions"><div class="cc-suggestion-hint">Escribe el nombre o una palabra clave y te sugeriremos búsquedas relacionadas.</div></div><p class="muted">Sepáralas por coma o por línea. Puedes usar las recomendaciones o escribir tus propios términos.</p><div class="modal-actions"><button type="button" class="ghost-btn" data-cc-dialog-close="ccCampaignDialog">Cancelar</button><button type="submit" class="primary-btn">Crear y buscar</button></div></form></dialog>
  <dialog id="ccBusinessDialog" class="modal cc-campaign-dialog"><form id="ccBusinessForm" class="modal-card"><div class="modal-head"><div><h2>Mi negocio</h2><p>Define el universo estratégico que quieres estudiar, independiente de tus campañas.</p></div><button type="button" class="icon-btn" data-cc-dialog-close="ccBusinessDialog">×</button></div><div class="form-grid"><label class="span-2">Palabras o frases de tu negocio<textarea id="ccBusinessTerms" rows="6" placeholder="software operacional, IoT, trazabilidad, telemetría...">${e((chilecompraState.marketProfile?.query_terms || []).join(', '))}</textarea></label></div><div class="modal-actions"><button type="button" class="ghost-btn" data-cc-dialog-close="ccBusinessDialog">Cancelar</button><button type="submit" class="primary-btn">Guardar perfil</button></div></form></dialog>`;
}

function renderSummaryDashboard(stats) {
  const local = chilecompraLocalBreakdown({ metric: 'publications' });
  const hasMatches = stats.total > 0;

  if (!stats.activeCampaigns) {
    return `<section class="cc-dashboard">
      <section class="cc-dashboard-card cc-getting-started">
        <span class="cc-eyebrow">Empieza aquí</span>
        <h3>Encuentra oportunidades en 3 pasos</h3>
        <div class="cc-start-steps">
          <div><b>1</b><span><strong>Crea un seguimiento</strong><small>Escribe qué producto o servicio quieres detectar.</small></span></div>
          <div><b>2</b><span><strong>El radar busca por ti</strong><small>Revisamos licitaciones activas y guardamos las coincidencias.</small></span></div>
          <div><b>3</b><span><strong>Revisa y pasa al CRM</strong><small>Abre una coincidencia, guárdala o conviértela en oportunidad.</small></span></div>
        </div>
        <button type="button" class="primary-btn cc-primary-start" data-cc-campaign-new>Crear mi primer seguimiento</button>
      </section>
    </section>`;
  }

  return `<section class="cc-dashboard">
    ${hasMatches
      ? `<div class="cc-kpi-grid"><button type="button" data-cc-tab="coincidencias"><strong>${stats.total}</strong><span>Coincidencias nuevas</span></button><button type="button" data-cc-tab="campanas"><strong>${stats.activeCampaigns}</strong><span>Seguimientos activos</span></button><div><strong>${stats.buyers}</strong><span>Compradores detectados</span></div><div><strong>${compactAmount(stats.amount)}</strong><span>Monto observado</span></div></div>`
      : `<section class="cc-dashboard-card cc-zero-state"><div><span class="cc-eyebrow">Radar al día</span><h3>No hay coincidencias nuevas</h3><p>Tus ${stats.activeCampaigns} seguimiento${stats.activeCampaigns === 1 ? '' : 's'} están activos. Puedes buscar novedades ahora o revisar sus términos si esperabas más resultados.</p></div><div class="cc-zero-actions"><button type="button" class="primary-btn" data-cc-tab="campanas">Revisar seguimientos</button><button type="button" class="ghost-btn" data-cc-tab="buscar">Hacer búsqueda puntual</button></div></section>`}

    <section class="cc-dashboard-card">
      <div class="cc-section-head"><div><h3>Seguimientos activos</h3><p>Estas búsquedas funcionan de forma automática. Toca una para ver sus coincidencias.</p></div></div>
      <div class="cc-user-campaign-list">${stats.campaigns.map((campaign) => campaignRow(campaign, stats, { controls: true })).join('')}</div>
    </section>

    ${hasMatches ? `<section class="cc-dashboard-card"><div class="cc-section-head"><div><h3>Qué se está comprando</h3><p>Top de rubros dentro de tus coincidencias.</p></div></div>${marketBars(local)}</section>` : ''}
  </section>`;
}

function renderCampaignsDashboard(stats) {
  return `<section class="cc-dashboard"><section class="cc-dashboard-card"><div class="cc-section-head"><div><h3>Seguimientos</h3><p>Cada seguimiento es una búsqueda automática. Puedes activarlo, pausarlo o abrir sus coincidencias.</p></div><button type="button" class="primary-btn" data-cc-campaign-new>+ Crear seguimiento</button></div><div class="cc-user-campaign-list">${chilecompraState.campaigns.length ? chilecompraState.campaigns.map((c) => campaignRow(c, stats, { controls: true })).join('') : '<div class="cc-empty"><strong>Sin seguimientos</strong><span>Crea la primera búsqueda automática para empezar.</span></div>'}</div></section></section>`;
}

function renderMarketDashboard() {
  const data = chilecompraState.analyticsUniverse === 'campaigns' && !chilecompraState.analytics ? chilecompraLocalBreakdown({ metric: chilecompraState.analyticsMetric }) : chilecompraState.analytics;
  return `<section class="cc-dashboard"><section class="cc-dashboard-card"><div class="cc-section-head"><div><h3>Análisis de mercado</h3><p>Compara tus campañas, tu negocio o el mercado público general.</p></div></div>${analyticsControls()}${chilecompraState.analyticsLoading ? '<div class="cc-empty">Analizando licitaciones activas…</div>' : marketBars(data)}<div class="cc-market-kpis"><div><strong>${Number(data?.publications || 0).toLocaleString('es-CL')}</strong><span>Publicaciones</span></div><div><strong>${Number(data?.buyers || 0).toLocaleString('es-CL')}</strong><span>Compradores</span></div><div><strong>${compactAmount(data?.amount || 0)}</strong><span>Monto observado</span></div></div></section></section>`;
}

function buyerRows() {
  const ids = matchedOpportunityIds();
  const map = new Map();
  chilecompraState.opportunities.filter((o) => ids.has(o.id) && o.buyer_name).forEach((o) => {
    const row = map.get(o.buyer_name) || { name: o.buyer_name, publications: 0, amount: 0, industries: new Set(), last: '' };
    row.publications += 1;
    row.amount += Number(o.amount || 0);
    row.industries.add(localIndustry(o));
    row.last = [row.last, o.published_at || o.updated_at || ''].sort().at(-1) || '';
    map.set(o.buyer_name, row);
  });
  return [...map.values()].sort((a, b) => b.publications - a.publications || b.amount - a.amount);
}

function renderBuyersDashboard() {
  const rows = buyerRows();
  return `<section class="cc-dashboard"><section class="cc-dashboard-card"><div class="cc-section-head"><div><h3>Compradores detectados</h3><p>Organismos que aparecen dentro de tus campañas activas.</p></div></div><div class="cc-buyers-list">${rows.length ? rows.slice(0, 30).map((r) => `<article><div><strong>${e(r.name)}</strong><span>${e([...r.industries].slice(0, 3).join(' · '))}</span></div><b>${r.publications}</b><small>${compactAmount(r.amount)}</small></article>`).join('') : '<div class="cc-empty">Todavía no hay compradores detectados por tus campañas.</div>'}</div></section></section>`;
}

function renderOpportunityWorkspace(stats) {
  const rows = filteredRows();
  const selected = selectedOpportunity();
  const isSearch = chilecompraState.tab === 'buscar';
  return `<section class="cc-workspace">
    ${isSearch ? `<form id="ccTraditionalSearch" class="cc-traditional-search"><div class="cc-traditional-search-box"><span aria-hidden="true">⌕</span><input id="ccSearch" type="search" placeholder="Busca palabra, servicio o código de licitación…" value="${e(chilecompraState.query)}" autocomplete="off"><button type="submit" class="primary-btn" ${chilecompraState.searching ? 'disabled' : ''}>${chilecompraState.searching ? 'Buscando…' : 'Buscar'}</button></div><small>La búsqueda manual es puntual. Solo se convierte en seguimiento cuando tú creas una campaña.</small></form>` : ''}
    ${chilecompraState.tab === 'coincidencias' && stats.campaigns.length ? `<div class="cc-campaign-filter"><button type="button" data-cc-campaign-filter="" class="${!chilecompraState.selectedCampaignId ? 'active' : ''}">Todas</button>${stats.campaigns.map((c) => `<button type="button" data-cc-campaign-filter="${c.id}" class="${chilecompraState.selectedCampaignId === c.id ? 'active' : ''}">${e(c.name)} <b>${stats.newByCampaign[c.id] || 0}</b></button>`).join('')}</div>` : ''}
    <div class="cc-results-toolbar"><strong class="cc-result-title">${resultHeading(rows)}</strong><select id="ccSort" aria-label="Ordenar oportunidades"><option value="recent" ${chilecompraState.sort === 'recent' ? 'selected' : ''}>Más recientes</option><option value="close" ${chilecompraState.sort === 'close' ? 'selected' : ''}>Cierre más próximo</option></select></div>
    ${chilecompraState.sourceCount ? `<p class="cc-result-count">Consulta sobre ${chilecompraState.sourceCount.toLocaleString('es-CL')} licitaciones activas.</p>` : ''}
    <div class="cc-opportunity-list">${chilecompraState.searching ? '<div class="cc-empty">Consultando Mercado Público…</div>' : rows.length ? rows.map(opportunityCard).join('') : isSearch && !chilecompraState.query ? '<div class="cc-empty cc-empty--search"><strong>Busca directamente en ChileCompra</strong><span>Escribe una palabra, servicio o código de licitación.</span></div>' : '<div class="cc-empty">No hay resultados para esta vista.</div>'}</div>
    <dialog id="ccOpportunityDialog" class="modal cc-opportunity-dialog"><div class="modal-card wide cc-opportunity-modal-card"><div class="modal-head cc-opportunity-modal-head"><div><h2>Detalle de licitación</h2><p>${selected ? `ID ${e(selected.external_code)}` : 'ChileCompra'}</p></div><button type="button" class="icon-btn" data-cc-detail-close aria-label="Cerrar">×</button></div><div class="cc-opportunity-modal-body">${detailPanel(selected)}</div></div></dialog>
  </section>`;
}

function renderInner() {
  const stats = chilecompraDashboardStats();
  const updated = chilecompraState.lastSyncAt
    ? 'Última revisión ' + new Date(chilecompraState.lastSyncAt).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })
    : stats.activeCampaigns ? 'Listo para buscar novedades' : 'Crea un seguimiento para comenzar';

  return `<section class="cc-radar-head">
    <div>
      <h2>ChileCompra</h2>
      <p>Encuentra licitaciones que coinciden con lo que vendes.</p>
    </div>
    <div class="cc-radar-actions">
      <span class="cc-updated"><i></i>${updated}</span>
      ${stats.activeCampaigns ? `<button type="button" class="ghost-btn" data-cc-sync ${chilecompraState.syncing ? 'disabled' : ''}>↻ ${chilecompraState.syncing ? 'Buscando…' : 'Buscar novedades'}</button><button type="button" class="primary-btn" data-cc-campaign-new>+ Crear seguimiento</button>` : ''}
    </div>
  </section>
  ${dashboardNav(stats)}
  ${chilecompraState.tab === 'resumen' ? renderSummaryDashboard(stats) : chilecompraState.tab === 'campanas' ? renderCampaignsDashboard(stats) : chilecompraState.tab === 'mercado' ? renderMarketDashboard() : chilecompraState.tab === 'compradores' ? renderBuyersDashboard() : renderOpportunityWorkspace(stats)}
  ${sharedDialogs()}`;
}

export function renderChileCompra() {
  return '<div id="chilecompraRoot" class="cc-root"></div>';
}

function rerender() {
  const root = document.getElementById('chilecompraRoot');
  if (root) root.innerHTML = renderInner();
}

function openDetailDialog() {
  const dialog = document.getElementById('ccOpportunityDialog');
  if (dialog && !dialog.open) dialog.showModal();
}

async function runTraditionalSearch(query) {
  const clean = query.trim();
  if (clean.length < 2) return toast('Escribe al menos 2 caracteres para buscar.', 'error');
  chilecompraState.query = clean;
  chilecompraState.tab = 'buscar';
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

function replaceEverywhere(updated) {
  const oi = chilecompraState.opportunities.findIndex((o) => o.id === updated.id);
  if (oi >= 0) chilecompraState.opportunities[oi] = updated;
  const ri = chilecompraState.results.findIndex((o) => o.id === updated.id);
  if (ri >= 0) chilecompraState.results[ri] = updated;
}

async function markReviewed(id) {
  const now = new Date().toISOString();
  campaignMatchesForOpportunity(id).forEach((m) => { m.reviewed_at = now; });
  notify();
  try { await invokeRadar({ action: 'review', opportunityId: id }); } catch (err) { console.error('No se pudo marcar coincidencia revisada', err); }
}

async function loadDetail(id, { reopen = false } = {}) {
  const current = [...chilecompraState.results, ...chilecompraState.opportunities].find((o) => o.id === id);
  if (!current) return;
  await markReviewed(id);
  if (current.detail_loaded) return;
  try {
    const data = await invokeRadar({ action: 'detail', code: current.external_code });
    if (data?.opportunity) {
      replaceEverywhere(data.opportunity);
      notify();
      rerender();
      if (reopen) openDetailDialog();
    }
  } catch (err) {
    console.error('No se pudo cargar detalle ChileCompra', err);
    toast('No se pudo cargar el detalle completo.', 'error');
  }
}

async function patchOpportunity(id, patch) {
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  const reopen = Boolean(document.getElementById('ccOpportunityDialog')?.open);
  const { data, error } = await supabase.from('chilecompra_opportunities').update(patch).eq('id', id).select('*').single();
  if (error) throw error;
  replaceEverywhere(data);
  notify();
  rerender();
  if (reopen) openDetailDialog();
}

async function convertToCrm(id) {
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  const { data, error } = await supabase.rpc('chilecompra_convert_opportunity', { p_opportunity_id: id });
  if (error) throw error;
  await Promise.all([hydrateCrm(), hydrateChileCompra()]);
  toast('Oportunidad agregada al CRM.');
  return data;
}

async function refreshAnalyticsFromControls() {
  rerender();
  try {
    await loadChileCompraAnalytics({
      universe: chilecompraState.analyticsUniverse,
      metric: chilecompraState.analyticsMetric,
      groupBy: chilecompraState.analyticsGroupBy
    });
  } catch (err) {
    toast(err.message || 'No se pudo analizar el mercado.', 'error');
  }
  rerender();
}

export function mountChileCompraView() {
  const root = document.getElementById('chilecompraRoot');
  if (!root) return;
  rerender();

  root.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      if (ev.target.id === 'ccTraditionalSearch') return await runTraditionalSearch(document.getElementById('ccSearch')?.value || '');
      if (ev.target.id === 'ccCampaignForm') {
        const name = document.getElementById('ccCampaignName')?.value || '';
        const terms = document.getElementById('ccCampaignTerms')?.value || '';
        const button = ev.target.querySelector('button[type="submit"]');
        if (button) { button.disabled = true; button.textContent = 'Creando…'; }
        await createCampaign({ name, terms });
        document.getElementById('ccCampaignDialog')?.close();
        chilecompraState.tab = 'resumen';
        toast('Seguimiento creado y radar actualizado.');
        rerender();
        return;
      }
      if (ev.target.id === 'ccBusinessForm') {
        await saveBusinessProfile(document.getElementById('ccBusinessTerms')?.value || '');
        document.getElementById('ccBusinessDialog')?.close();
        toast('Perfil de negocio guardado.');
        await refreshAnalyticsFromControls();
      }
    } catch (err) {
      toast(err.message || 'No se pudo completar la operación.', 'error');
      rerender();
    }
  });

  root.addEventListener('click', async (ev) => {
    const close = ev.target.closest('[data-cc-dialog-close]');
    if (close) { document.getElementById(close.dataset.ccDialogClose)?.close(); return; }
    if (ev.target.closest('[data-cc-campaign-new]')) {
      document.getElementById('ccCampaignDialog')?.showModal();
      requestAnimationFrame(renderCampaignTermSuggestions);
      return;
    }
    const suggestion = ev.target.closest('[data-cc-term-suggestion]');
    if (suggestion) {
      addCampaignSuggestion(suggestion.dataset.ccTermSuggestion || '');
      return;
    }
    if (ev.target.closest('[data-cc-business-open]')) { document.getElementById('ccBusinessDialog')?.showModal(); return; }
    if (ev.target.closest('.cc-switch')) return;

    const campaignOpen = ev.target.closest('[data-cc-campaign-open]');
    if (campaignOpen) {
      chilecompraState.selectedCampaignId = campaignOpen.dataset.ccCampaignOpen;
      chilecompraState.tab = 'coincidencias';
      chilecompraState.selectedId = '';
      rerender();
      return;
    }
    const campaignFilter = ev.target.closest('[data-cc-campaign-filter]');
    if (campaignFilter) {
      chilecompraState.selectedCampaignId = campaignFilter.dataset.ccCampaignFilter || '';
      chilecompraState.selectedId = '';
      rerender();
      return;
    }
    const select = ev.target.closest('[data-cc-select]');
    if (select) {
      chilecompraState.selectedId = select.dataset.ccSelect;
      chilecompraState.detailTab = 'resumen';
      rerender();
      openDetailDialog();
      await loadDetail(chilecompraState.selectedId, { reopen: true });
      return;
    }
    if (ev.target.closest('[data-cc-detail-close]')) { document.getElementById('ccOpportunityDialog')?.close(); return; }
    const tab = ev.target.closest('[data-cc-tab]');
    if (tab) {
      chilecompraState.tab = tab.dataset.ccTab;
      if (chilecompraState.tab !== 'coincidencias') chilecompraState.selectedCampaignId = '';
      chilecompraState.selectedId = '';
      rerender();
      if (chilecompraState.tab === 'mercado' && chilecompraState.analyticsUniverse !== 'campaigns' && !chilecompraState.analytics) await refreshAnalyticsFromControls();
      return;
    }
    const detailTab = ev.target.closest('[data-cc-detail-tab]');
    if (detailTab) {
      const reopen = Boolean(document.getElementById('ccOpportunityDialog')?.open);
      chilecompraState.detailTab = detailTab.dataset.ccDetailTab;
      rerender();
      if (reopen) openDetailDialog();
      return;
    }
    if (ev.target.closest('[data-cc-sync]')) {
      try { await syncChileCompra(); rerender(); } catch (err) { toast(err.message || 'No se pudo actualizar el radar.', 'error'); }
      return;
    }
    const save = ev.target.closest('[data-cc-save]');
    if (save) {
      const o = [...chilecompraState.results, ...chilecompraState.opportunities].find((x) => x.id === save.dataset.ccSave);
      if (o) await patchOpportunity(o.id, { radar_state: o.radar_state === 'guardado' ? 'nuevo' : 'guardado', updated_at: new Date().toISOString() });
      return;
    }
    const discard = ev.target.closest('[data-cc-discard]');
    if (discard) { await patchOpportunity(discard.dataset.ccDiscard, { radar_state: 'descartado', updated_at: new Date().toISOString() }); return; }
    const crm = ev.target.closest('[data-cc-crm]');
    if (crm) { await convertToCrm(crm.dataset.ccCrm); rerender(); return; }
    if (ev.target.closest('[data-cc-market]')) openExternal('https://www.mercadopublico.cl/BuscarLicitacion');
  });

  root.addEventListener('input', (ev) => {
    if (ev.target?.id === 'ccCampaignName' || ev.target?.id === 'ccCampaignTerms') {
      renderCampaignTermSuggestions();
    }
  });

  root.addEventListener('change', async (ev) => {
    try {
      const toggle = ev.target.closest('[data-cc-campaign-toggle]');
      if (toggle) { await toggleCampaign(toggle.dataset.ccCampaignToggle, toggle.checked); rerender(); return; }
      if (ev.target.id === 'ccSort') { chilecompraState.sort = ev.target.value; chilecompraState.selectedId = ''; rerender(); return; }
      if (ev.target.id === 'ccAnalyticsUniverse') { chilecompraState.analyticsUniverse = ev.target.value; chilecompraState.analytics = null; return await refreshAnalyticsFromControls(); }
      if (ev.target.id === 'ccAnalyticsMetric') { chilecompraState.analyticsMetric = ev.target.value; chilecompraState.analytics = null; return await refreshAnalyticsFromControls(); }
      if (ev.target.id === 'ccAnalyticsGroupBy') { chilecompraState.analyticsGroupBy = ev.target.value; chilecompraState.analytics = null; return await refreshAnalyticsFromControls(); }
    } catch (err) {
      toast(err.message || 'No se pudo actualizar ChileCompra.', 'error');
      await hydrateChileCompra().catch(() => {});
      rerender();
    }
  });

  if (!chilecompraState.hydrated && !chilecompraState.loading) {
    hydrateChileCompra().then(rerender).catch((err) => { console.error(err); toast('No se pudo cargar ChileCompra.', 'error'); });
  }
}