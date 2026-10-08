import { supabase } from './supabase.js';
import { isReadOnly, session } from './auth.js';
import { hydrate as hydrateCrm } from './store.js';
import { escapeHtml as e, fmtDate, openExternal, toast } from './utils.js';

export const chilecompraState = {
  opportunities: [],
  campaigns: [],
  matches: [],
  userStates: [],
  marketProfile: null,
  analytics: null,
  analyticsLoading: false,
  marketPulse: null,
  marketPulseLoading: false,
  analyticsUniverse: 'general',
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
  detailLoading: false,
  detailError: '',
  detailReturnY: 0,
  cmData: null,
  cmLoading: false,
  cmError: '',
  cmDays: 3,
  cmQuery: '',
  cmCampaignId: '',
  cmView: 'pulso',
  cmSelectedCode: '',
  cmDetail: null,
  cmDetailLoading: false,
  sort: 'recent',
  lastSyncAt: ''
};

const listeners = new Set();
export const onChileCompraChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const notify = () => listeners.forEach((fn) => fn(chilecompraState));

export function clearChileCompra() {
  Object.assign(chilecompraState, {
    opportunities: [], campaigns: [], matches: [], userStates: [], marketProfile: null, analytics: null,
    analyticsLoading: false, marketPulse: null, marketPulseLoading: false, loading: false, syncing: false, searching: false,
    hydrated: false, tab: 'resumen', query: '', results: [], sourceCount: 0,
    selectedCampaignId: '', selectedId: '', detailTab: 'resumen', detailLoading: false, detailError: '', detailReturnY: 0,
    cmData: null, cmLoading: false, cmError: '', cmDays: 3, cmQuery: '', cmCampaignId: '', cmView: 'pulso',
    cmSelectedCode: '', cmDetail: null, cmDetailLoading: false,
    sort: 'recent', lastSyncAt: ''
  });
  notify();
}

function activeCampaigns() {
  return chilecompraState.campaigns.filter((c) => c.active);
}

function opportunityMap() {
  return new Map(chilecompraState.opportunities.map((o) => [o.id, o]));
}

function userStateMap() {
  return new Map(chilecompraState.userStates.map((row) => [row.opportunity_id, row]));
}

function withUserState(opportunity) {
  if (!opportunity) return opportunity;
  const personal = userStateMap().get(opportunity.id);
  return {
    ...opportunity,
    radar_state: personal?.radar_state || 'nuevo',
    lead_id: personal?.lead_id || null
  };
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
  ['Salud', ['prestaciones medicas','prestacion medica','imagenologia','ambulatoria','hospital','salud','clinica','cesfam','medica','medico','farmacia','laboratorio clinico','dental','insumo medico']],
  ['Tecnología / Software', ['software','plataforma','saas','licencia de software','tecnologia de informacion','tecnologia','informatico','computacional','hosting','cloud','nube','base de datos','ciberseguridad','realidad virtual','simulacion','desarrollo web','aplicacion movil','aplicacion web']],
  ['Telecomunicaciones', ['telecom','fibra optica','fibra','antena','radioenlace','lte','5g','conectividad','red de datos','telefonia','internet']],
  ['Seguridad / Defensa', ['seguridad','ejercito','armada','carabineros','pdi','defensa','vigilancia','cctv','control de acceso']],
  ['Educación', ['universidad','educacion','colegio','liceo','escuela','junaeb','capacitacion','curso','docencia']],
  ['Construcción / Infraestructura', ['construccion','obra civil','infraestructura','edificio','pavimento','techumbre','urbanizacion','habilitacion de espacios']],
  ['Energía / Utilities', ['energia','electrico','electricidad','agua potable','sanitaria','generador','electrogeno','panel solar','iluminacion','luminaria']],
  ['Transporte / Logística', ['transporte','logistica','flete','distribucion','vehiculo','camion','metro','traslado','bodega','almacenamiento']],
  ['Industria / Minería', ['mineria','industrial','planta industrial','faena','proceso productivo','maquinaria industrial','motor industrial','bomba industrial']],
  ['Alimentación / Catering', ['alimento','alimentacion','catering','casino','colacion','racion','bebida','comestible']],
  ['Aseo / Facility', ['aseo','limpieza','facility','jardineria','sanitizacion','desinfeccion','residuo','mantencion integral','mantenimiento integral']],
  ['Oficina / Insumos', ['articulo de oficina','insumo de oficina','papeleria','tinta','toner','impresora','fotocopiadora','utiles de oficina']],
  ['Equipamiento / Mobiliario', ['mobiliario','mueble','silla','escritorio','estanteria','equipamiento mobiliario']],
  ['Consultoría / Servicios profesionales', ['consultoria','asesoria','estudio','auditoria','servicio profesional','ingenieria','levantamiento','consultor']],
  ['Medioambiente', ['medioambiente','ambiental','reciclaje','monitoreo ambiental','areas verdes','gestion de residuos']],
  ['Maquinaria / Vehículos', ['maquinaria','excavadora','grua','camioneta','automovil','repuesto','neumatico']],
  ['Textil / EPP', ['uniforme','vestuario','ropa de trabajo','calzado','epp','elemento de proteccion personal']],
  ['Comunicaciones / Eventos', ['publicidad','difusion','impresion grafica','grafica','evento','produccion audiovisual','comunicaciones']],
  ['Finanzas / Seguros', ['seguro','poliza','bancaria','bancario','conciliacion bancaria','servicio financiero','financiero','leasing']],
  ['Legal / Personas', ['juridico','juridica','abogado','legal','recursos humanos','seleccion de personal','reclutamiento','evaluacion psicologica']],
  ['Arriendo / Servicios operacionales', ['arriendo','arrendamiento','mantencion','mantenimiento','reparacion','soporte tecnico','servicio tecnico']],
  ['Cultura / Deporte / Turismo', ['cultura','cultural','deporte','deportivo','turismo','hotel','alojamiento','recreacion']],
  ['Ciencias / Laboratorio', ['reactivo','laboratorio','microscopio','instrumental cientifico','equipo cientifico','analisis quimico']],
  ['Agricultura / Veterinaria', ['agricola','agricultura','veterinaria','veterinario','animal','riego','semilla','fertilizante']]
];

function normalized(value = '') {
  return String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es');
}

function localTermMatch(text, term) {
  const needle = normalized(term).trim();
  if (!needle) return false;
  if (/^[a-z0-9]{1,4}$/.test(needle)) {
    return new RegExp(`(^|[^a-z0-9])${needle.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(text);
  }
  return text.includes(needle);
}

function localIndustry(o) {
  const name = normalized(o.name);
  const description = normalized(o.description);
  const buyer = normalized(o.buyer_name);
  let bestLabel = 'Sin clasificar';
  let bestScore = 0;
  for (const [label, terms] of LOCAL_INDUSTRIES) {
    let score = 0;
    terms.forEach((term) => {
      const normalizedTerm = normalized(term);
      const specificity = normalizedTerm.includes(' ') ? 1.1 : normalizedTerm.length >= 9 ? .55 : 0;
      if (localTermMatch(name, term)) score += 3 + specificity;
      if (localTermMatch(description, term)) score += 1.4 + specificity;
      if (localTermMatch(buyer, term)) score += .65 + specificity;
    });
    if (score > bestScore) {
      bestScore = score;
      bestLabel = label;
    }
  }
  return bestScore >= 2.2 ? bestLabel : 'Sin clasificar';
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
  const categories = [...groups.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => {
      if (a.label === 'Sin clasificar') return 1;
      if (b.label === 'Sin clasificar') return -1;
      return b.value - a.value;
    });
  const categoryExamples = {};
  categories.forEach(({ label }) => {
    categoryExamples[label] = rows
      .filter((o) => localIndustry(o) === label)
      .slice(0, 6)
      .map((o) => ({
        code: o.external_code || '',
        name: o.name || 'Sin nombre',
        buyer: o.buyer_name || '',
        amount: Number(o.amount || 0),
        closeAt: o.close_at || ''
      }));
  });
  return {
    universe: 'campaigns', metric, configured: activeCampaigns().length > 0,
    publications: rows.length,
    buyers: new Set(rows.map((o) => o.buyer_name).filter(Boolean)).size,
    amount: rows.reduce((sum, o) => sum + Number(o.amount || 0), 0),
    categories,
    categoryExamples
  };
}

function mergeRows(rows = []) {
  const byCode = new Map(chilecompraState.opportunities.map((o) => [o.external_code, o]));
  rows.forEach((row) => byCode.set(row.external_code, withUserState(row)));
  chilecompraState.opportunities = [...byCode.values()].map(withUserState);
}

export async function hydrateChileCompra() {
  if (chilecompraState.loading) return;
  chilecompraState.loading = true;
  notify();
  try {
    const [campaigns, opportunities, matches, userStates, profile] = await Promise.all([
      supabase.from('chilecompra_campaigns').select('*').order('created_at', { ascending: true }),
      supabase.from('chilecompra_opportunities').select('*').order('updated_at', { ascending: false }).limit(1200),
      supabase.from('chilecompra_campaign_matches').select('*').order('updated_at', { ascending: false }).limit(5000),
      supabase.from('chilecompra_user_states').select('*').order('updated_at', { ascending: false }),
      supabase.from('chilecompra_market_profiles').select('*').maybeSingle()
    ]);
    if (campaigns.error) throw campaigns.error;
    if (opportunities.error) throw opportunities.error;
    if (matches.error) throw matches.error;
    if (userStates.error) throw userStates.error;
    if (profile.error && profile.error.code !== 'PGRST116') throw profile.error;
    chilecompraState.campaigns = campaigns.data || [];
    chilecompraState.matches = matches.data || [];
    chilecompraState.userStates = userStates.data || [];
    chilecompraState.opportunities = (opportunities.data || []).map(withUserState);
    chilecompraState.results = chilecompraState.results.map(withUserState);
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


const CM_DIRECTORY_REVIEWED_AT = '2026-10-05';
const CM_CURRENT_AGREEMENTS = [
  { code:'2239-6-LR25', name:'Adquisición de vehículos y maquinaria', expires:'2029-03-13' },
  { code:'2239-1-LR26', name:'Administración y entrega de beneficios', expires:'2029-05-19' },
  { code:'2239-16-LR23', name:'Agencias de viajes corporativos y asistencia', expires:'2026-11-23' },
  { code:'2239-9-LR24', name:'Alimentos', expires:'2028-02-20' },
  { code:'2239-5-LR25', name:'Arriendo y compra de computadores y accesorios', expires:'2028-10-28' },
  { code:'2239-8-LR25', name:'Artículos de aseo e higiene', expires:'2027-11-30' },
  { code:'2239-16-LR24', name:'Artículos de escritorio y papelería', expires:'2028-05-16' },
  { code:'2239-19-LR23', name:'Desarrollo y mantención de software', expires:'2027-01-12' },
  { code:'2239-8-LR24', name:'Emergencias, contingencias y prevención', expires:'2026-10-18' },
  { code:'2239-15-LR25', name:'Endoprótesis, ortopedia y trauma', expires:'2029-02-25' },
  { code:'2239-1-LR25', name:'Gas licuado de petróleo', expires:'2028-06-03' },
  { code:'2239-21-LR23', name:'Insumos y dispositivos médicos', expires:'2027-06-14' },
  { code:'2239-11-LR24', name:'Licencia Ofimática', expires:'2027-12-06' },
  { code:'2239-4-LR25', name:'Mobiliario general', expires:'2028-09-02' },
  { code:'2239-9-LR23', name:'Productos de ferretería y servicios', expires:'2027-03-20' },
  { code:'2239-12-LR23', name:'Seguro colectivo de vida con adicional de salud', expires:'2026-10-25' },
  { code:'2239-13-LR25', name:'Suministro de combustibles', expires:'2027-07-02' },
  { code:'2239-12-LR25', name:'Transporte privado de pasajeros y arriendo de vehículos', expires:'2028-01-02' }
]

function agreementStatus(row) {
  const end = row?.expires ? new Date(row.expires + 'T23:59:59') : null;
  if (!end || Number.isNaN(end.getTime())) return { label:'Vigencia no informada', tone:'neutral' };
  const days = Math.ceil((end.getTime() - Date.now()) / 86400000);
  if (days < 0) return { label:'Vencido', tone:'danger' };
  if (days <= 30) return { label:'Vence en ' + days + ' día' + (days === 1 ? '' : 's'), tone:'warning' };
  if (days <= 120) return { label:'Vence en ' + days + ' días', tone:'attention' };
  return { label:'Vigente', tone:'success' };
}

function cmMoney(value, currency = 'CLP') {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '—';
  if (currency === 'CLP') return '$' + Math.round(n).toLocaleString('es-CL');
  return currency + ' ' + n.toLocaleString('es-CL', { maximumFractionDigits: 2 });
}

function cmOrderItems(code) {
  return (chilecompraState.cmData?.items || []).filter((item) => item.order_code === code);
}

async function loadConvenioMarco({ forceSync = false } = {}) {
  if (chilecompraState.cmLoading) return chilecompraState.cmData;
  chilecompraState.cmLoading = true;
  chilecompraState.cmError = '';
  notify();
  rerender();
  try {
    const data = await invokeRadar({
      action: 'cm-dashboard',
      days: chilecompraState.cmDays,
      query: chilecompraState.cmQuery,
      campaignId: chilecompraState.cmCampaignId,
      forceSync
    });
    chilecompraState.cmData = data;
    return data;
  } catch (err) {
    chilecompraState.cmError = err?.message || 'No se pudo cargar Convenio Marco.';
    console.error('Convenio Marco', err);
    throw err;
  } finally {
    chilecompraState.cmLoading = false;
    notify();
    rerender();
  }
}

async function loadCmOrderDetail(code) {
  if (!code) return null;
  chilecompraState.cmSelectedCode = code;
  chilecompraState.cmDetailLoading = true;
  chilecompraState.cmError = '';
  rerender();
  try {
    const data = await invokeRadar({ action: 'cm-detail', code });
    chilecompraState.cmDetail = data;
    return data;
  } catch (err) {
    chilecompraState.cmError = err?.message || 'No se pudo cargar la orden de Convenio Marco.';
    throw err;
  } finally {
    chilecompraState.cmDetailLoading = false;
    rerender();
  }
}

async function patchCmCommercialState(code, radarState) {
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  const organizationId = session.profile?.organization_id;
  if (!organizationId) throw new Error('No se pudo resolver tu organización.');
  const payload = {
    organization_id: organizationId,
    profile_id: session.user?.id,
    order_code: code,
    radar_state: radarState,
    updated_by: session.user?.id || null,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await supabase
    .from('chilecompra_cm_states')
    .upsert(payload, { onConflict: 'organization_id,profile_id,order_code' })
    .select('*')
    .single();
  if (error) throw error;

  if (chilecompraState.cmData?.orders) {
    chilecompraState.cmData.orders = chilecompraState.cmData.orders.map((order) =>
      order.code === code ? { ...order, commercial_state: data } : order
    );
  }
  if (chilecompraState.cmDetail?.order?.code === code) {
    chilecompraState.cmDetail.order = { ...chilecompraState.cmDetail.order, commercial_state: data };
  }
  notify();
  rerender();
  return data;
}

async function convertCmToCrm(code) {
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  const { data, error } = await supabase.rpc('chilecompra_convert_cm_order', { p_order_code: code });
  if (error) throw error;
  await hydrateCrm();
  await loadConvenioMarco();
  if (chilecompraState.cmSelectedCode === code) {
    await loadCmOrderDetail(code);
  }
  toast('Orden de Convenio Marco agregada al CRM.');
  return data;
}

export async function syncChileCompra() {
  if (chilecompraState.syncing) return;
  if (!activeCampaigns().length) return toast('Crea un seguimiento activo antes de buscar novedades.', 'error');
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

async function ensureMarketPulse({ force = false } = {}) {
  if (chilecompraState.marketPulseLoading) return chilecompraState.marketPulse;
  if (chilecompraState.marketPulse && !force) return chilecompraState.marketPulse;
  chilecompraState.marketPulseLoading = true;
  notify();
  try {
    chilecompraState.marketPulse = await invokeRadar({
      action: 'analytics',
      universe: 'general',
      metric: 'publications',
      groupBy: 'industry'
    });
    return chilecompraState.marketPulse;
  } catch (err) {
    console.error('No se pudo cargar el pulso de Mercado Público', err);
    return null;
  } finally {
    chilecompraState.marketPulseLoading = false;
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
  if (!name.trim()) throw new Error('Escribe un nombre para el seguimiento.');
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
    profile_id: session.user?.id,
    name: 'Mi negocio',
    query_terms: terms,
    updated_by: session.user?.id || null,
    updated_at: new Date().toISOString()
  }, { onConflict: 'organization_id,profile_id' }).select('*').single();
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
  return `<article class="cc-opportunity ${chilecompraState.selectedId === o.id ? 'is-selected' : ''}" data-cc-select="${o.id}">
    <div class="cc-match-count"><strong>${campaigns.length || '•'}</strong><small>${campaigns.length === 1 ? 'seguimiento' : campaigns.length ? 'seguimientos' : 'búsqueda'}</small></div>
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

function rawValue(o, path = []) {
  let value = o?.raw || {};
  for (const key of path) {
    if (value == null || typeof value !== 'object') return null;
    value = value[key];
  }
  return value;
}

function detailDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' });
}

function detailText(value, fallback = 'No informado') {
  if (value == null || value === '') return fallback;
  return String(value);
}

function detailFlag(value) {
  if (value === 1 || value === '1' || value === true) return 'Sí';
  if (value === 0 || value === '0' || value === false) return 'No';
  return detailText(value);
}

function detailList(title, rows = []) {
  const useful = rows.filter((row) => row?.[1] != null && row[1] !== '');
  if (!useful.length) return '';
  return `<section class="cc-detail-block">
    <h4>${e(title)}</h4>
    <div class="cc-detail-kv">
      ${useful.map(([label,value]) => `<div><small>${e(label)}</small><strong>${e(detailText(value))}</strong></div>`).join('')}
    </div>
  </section>`;
}

function detailBuyerBlock(o) {
  const buyer = rawValue(o, ['Comprador']) || {};
  return detailList('Organismo comprador', [
    ['Organismo', o.buyer_name || buyer.NombreOrganismo],
    ['Unidad', buyer.NombreUnidad],
    ['RUT unidad', buyer.RutUnidad],
    ['Región', buyer.RegionUnidad],
    ['Comuna', buyer.ComunaUnidad],
    ['Dirección', buyer.DireccionUnidad],
    ['Contacto', buyer.NombreUsuario],
    ['Cargo', buyer.CargoUsuario]
  ]);
}

function detailDatesBlock(o) {
  const dates = rawValue(o, ['Fechas']) || {};
  return detailList('Fechas clave', [
    ['Publicación', detailDate(o.published_at || dates.FechaPublicacion)],
    ['Inicio', detailDate(dates.FechaInicio)],
    ['Cierre', detailDate(o.close_at || dates.FechaCierre)],
    ['Publicación de respuestas', detailDate(dates.FechaPubRespuestas)],
    ['Apertura técnica', detailDate(dates.FechaActoAperturaTecnica)],
    ['Apertura económica', detailDate(dates.FechaActoAperturaEconomica)],
    ['Adjudicación estimada', detailDate(dates.FechaEstimadaAdjudicacion || dates.FechaAdjudicacion)]
  ]);
}

function detailConditionsBlock(o) {
  const raw = o?.raw || {};
  return detailList('Condiciones informadas por Mercado Público', [
    ['Fuente de financiamiento', raw.FuenteFinanciamiento],
    ['Tipo de convocatoria', raw.TipoConvocatoria],
    ['Subcontratación', raw.SubContratacion != null ? detailFlag(raw.SubContratacion) : null],
    ['Renovable', raw.EsRenovable != null ? detailFlag(raw.EsRenovable) : null],
    ['Extensión de plazo', raw.ExtensionPlazo != null ? detailFlag(raw.ExtensionPlazo) : null],
    ['Toma de razón', raw.TomaRazon != null ? detailFlag(raw.TomaRazon) : null],
    ['Dirección de visita', raw.DireccionVisita],
    ['Dirección de entrega', raw.DireccionEntrega],
    ['Cantidad de reclamos', raw.CantidadReclamos]
  ]);
}

function detailItemsBlock(o) {
  const rawItems = rawValue(o, ['Items']);
  const items = Array.isArray(rawItems?.Listado) ? rawItems.Listado : [];
  if (!items.length) {
    return '<section class="cc-detail-block"><h4>Ítems solicitados</h4><p class="muted">La API no informó ítems para esta licitación.</p></section>';
  }
  return `<section class="cc-detail-block">
    <h4>Ítems solicitados</h4>
    <div class="cc-detail-items">
      ${items.map((item,index) => `<article>
        <div><span>Ítem ${index + 1}</span><strong>${e(item.NombreProducto || item.Descripcion || 'Sin nombre')}</strong></div>
        <dl>
          <div><dt>Cantidad</dt><dd>${e(detailText(item.Cantidad))} ${e(item.UnidadMedida || '')}</dd></div>
          <div><dt>Categoría</dt><dd>${e(detailText(item.Categoria))}</dd></div>
          <div><dt>Descripción</dt><dd>${e(detailText(item.Descripcion))}</dd></div>
          ${item.CodigoProducto ? `<div><dt>Código producto</dt><dd>${e(String(item.CodigoProducto))}</dd></div>` : ''}
        </dl>
      </article>`).join('')}
    </div>
  </section>`;
}

function documentUrl(doc) {
  if (!doc || typeof doc !== 'object') return '';
  const direct = [
    doc.Url, doc.URL, doc.url, doc.Enlace, doc.enlace, doc.Link, doc.link,
    doc.Href, doc.href, doc.Ruta, doc.ruta, doc.UrlArchivo, doc.URLArchivo,
    doc.Descarga, doc.descarga
  ].find((value) => /^https?:\/\//i.test(String(value || '').trim()));
  if (direct) return String(direct).trim();

  for (const value of Object.values(doc)) {
    if (typeof value === 'string' && /^https?:\/\//i.test(value.trim())) return value.trim();
  }
  return '';
}

function detailDocumentsBlock(o) {
  const docs = rawValue(o, ['Documentos']) || rawValue(o, ['Adjuntos']) || rawValue(o, ['Archivos']);
  const list = Array.isArray(docs) ? docs : Array.isArray(docs?.Listado) ? docs.Listado : [];
  return `<section class="cc-detail-block cc-documents-block">
    <div class="cc-detail-block-title">
      <div><h4>Bases y documentos</h4><span>Archivos oficiales asociados a la licitación.</span></div>
      <button type="button" class="link-btn" data-cc-market>Fuente oficial ↗</button>
    </div>
    ${list.length
      ? `<div class="cc-document-list">${list.map((doc,index) => {
          const name = doc?.Nombre || doc?.nombre || doc?.Descripcion || doc?.descripcion || doc?.Titulo || `Documento ${index + 1}`;
          const url = documentUrl(doc);
          return `<article class="cc-document-row">
            <span class="cc-document-icon" aria-hidden="true">▤</span>
            <div><strong>${e(name)}</strong><small>${url ? 'Documento oficial disponible' : 'Documento informado por Mercado Público'}</small></div>
            ${url ? `<a class="ghost-btn cc-document-open" href="${e(url)}" target="_blank" rel="noopener noreferrer">Ver ↗</a>` : ''}
          </article>`;
        }).join('')}</div>`
      : `<div class="cc-api-note">
          <strong>Mercado Público no entregó los archivos adjuntos mediante la API.</strong>
          <span>Puedes seguir analizando esta licitación dentro del CRM. Para descargar las bases oficiales, abre la fuente en una pestaña nueva.</span>
        </div>`}
    ${!list.length ? '<button type="button" class="ghost-btn cc-open-public-record" data-cc-market>Abrir bases en Mercado Público ↗</button>' : ''}
  </section>`;
}

function detailBody(o) {
  if (chilecompraState.detailTab === 'coincidencias') {
    const campaigns = campaignsForOpportunity(o.id);
    const terms = matchedTerms(o);
    return `<section class="cc-detail-section"><h4>Seguimientos que encontraron esta publicación</h4><div class="cc-tags">${campaigns.length ? campaigns.map((c) => tag(c.name)).join('') : '<span class="muted">Resultado de búsqueda manual.</span>'}</div><h4>Términos coincidentes</h4><div class="cc-tags">${terms.length ? terms.map(tag).join('') : '<span class="muted">Sin términos asociados.</span>'}</div></section>`;
  }
  if (chilecompraState.detailTab === 'requisitos') {
    return `<section class="cc-detail-section">${detailConditionsBlock(o)}</section>`;
  }
  if (chilecompraState.detailTab === 'documentos') {
    return `<section class="cc-detail-section">${detailDocumentsBlock(o)}</section>`;
  }
  if (chilecompraState.detailTab === 'items') {
    return `<section class="cc-detail-section">${detailItemsBlock(o)}</section>`;
  }
  if (chilecompraState.detailTab === 'fechas') {
    return `<section class="cc-detail-section">${detailDatesBlock(o)}</section>`;
  }
  const description = o.description
    || (chilecompraState.detailLoading
      ? 'Cargando información desde Mercado Público…'
      : chilecompraState.detailError
        ? 'No pudimos completar la ficha desde Mercado Público.'
        : 'Mercado Público no informó una descripción para esta licitación.');
  const published = o.published_at
    ? fmtDate(o.published_at.slice(0, 10))
    : (chilecompraState.detailLoading ? 'Cargando…' : 'No informada');
  return `<section class="cc-detail-section">
    ${chilecompraState.detailLoading ? '<div class="cc-detail-loading"><span class="cc-search-spinner"></span><span>Cargando ficha completa…</span></div>' : ''}
    ${chilecompraState.detailError ? `<div class="cc-detail-warning"><strong>No se pudo completar la ficha</strong><span>${e(chilecompraState.detailError)}</span><button type="button" class="ghost-btn" data-cc-detail-retry>Reintentar</button></div>` : ''}
    <div class="cc-detail-facts"><div><small>Cierre</small><strong>${o.close_at ? fmtDate(o.close_at.slice(0, 10)) : 'Sin fecha'}</strong></div><div><small>Monto estimado</small><strong>${e(amountLabel(o))}</strong></div><div><small>Publicación</small><strong>${published}</strong></div></div>
    <h4>Descripción</h4><p class="cc-description">${e(description)}</p>
    ${detailBuyerBlock(o)}
    <h4>Seguimientos relacionados</h4><div class="cc-tags">${campaignTags(o) || '<span class="muted">Búsqueda manual.</span>'}</div>
  </section>`;
}

function detailPanel(o) {
  if (!o) return '<aside class="cc-detail"><div class="cc-empty">Selecciona una licitación para revisar su ficha.</div></aside>';
  const campaigns = campaignsForOpportunity(o.id);
  return `<aside class="cc-detail">
    <div class="cc-detail-head"><div class="cc-detail-campaign-summary"><strong>${campaigns.length}</strong><span>${campaigns.length === 1 ? 'seguimiento coincide' : 'seguimientos coinciden'}</span></div><button type="button" class="icon-btn" data-cc-save="${o.id}" aria-label="Guardar oportunidad">♡</button></div>
    <h2>${e(o.name)}</h2><p class="cc-detail-buyer">⌂ ${e(o.buyer_name || (chilecompraState.detailLoading ? 'Cargando comprador…' : 'Comprador no informado'))}</p>
    <div class="cc-meta-row"><span>ID ${e(o.external_code)}</span><span>${e(o.procurement_type || 'Licitación pública')}</span><span class="cc-open-dot">● ${e(o.status || 'Publicada')}</span></div>
    <div class="cc-detail-tabs">${[
      ['resumen','Resumen'],
      ['documentos','Bases y documentos'],
      ['requisitos','Condiciones'],
      ['items','Ítems'],
      ['fechas','Fechas'],
      ['coincidencias','Coincidencias']
    ].map(([id,label]) => `<button type="button" data-cc-detail-tab="${id}" class="${chilecompraState.detailTab === id ? 'active' : ''}">${label}</button>`).join('')}</div>
    ${detailBody(o)}
    <div class="cc-detail-actions">${o.radar_state === 'crm' ? '<button type="button" class="primary-btn" disabled>✓ Ya está en CRM</button>' : `<button type="button" class="primary-btn" data-cc-crm="${o.id}">▣ Agregar al CRM</button>`}<button type="button" class="ghost-btn" data-cc-save="${o.id}">${o.radar_state === 'guardado' ? '✓ Guardada' : '♡ Guardar'}</button><button type="button" class="ghost-btn" data-cc-discard="${o.id}">⊘ Descartar</button><button type="button" class="link-btn cc-market-link" data-cc-market>Fuente oficial en Mercado Público ↗</button></div>
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

function marketBars(data, { limit = 18 } = {}) {
  const categories = (data?.categories || []).filter((x) => Number(x.value || 0) > 0);
  const metric = data?.metric || chilecompraState.analyticsMetric || 'publications';
  const categoryTotal = categories.reduce((sum, x) => sum + Number(x.value || 0), 0);
  const total = metric === 'amount'
    ? Number(data?.amount || categoryTotal)
    : metric === 'buyers'
      ? Number(data?.buyers || categoryTotal)
      : Number(data?.publications || categoryTotal);
  if (!categories.length || total <= 0) {
    return `<div class="cc-market-empty"><strong>Sin datos para este universo</strong><span>${data?.configured === false ? 'Configura las palabras clave para comenzar el análisis.' : 'Todavía no hay información suficiente.'}</span></div>`;
  }


  const unit = metric === 'amount' ? 'monto observado' : metric === 'buyers' ? 'compradores' : 'publicaciones';
  const totalLabel = metric === 'amount' ? compactAmount(total) : total.toLocaleString('es-CL');
  const unclassified = categories.find((row) => row.label === 'Sin clasificar');
  const rows = categories.length <= limit
    ? categories
    : [
        ...categories.filter((row) => row.label !== 'Sin clasificar').slice(0, Math.max(1, limit - (unclassified ? 1 : 0))),
        ...(unclassified ? [unclassified] : [])
      ];

  const renderExamples = (label) => {
    const examples = data?.categoryExamples?.[label] || [];
    if (!examples.length) return '<span class="cc-category-empty">Sin ejemplos disponibles para este grupo.</span>';
    return examples.map((item) => `
      <button type="button" class="cc-category-example" data-cc-example-code="${e(item.code || '')}">
        <span><strong>${e(item.name || 'Sin nombre')}</strong><small>${e(item.buyer || 'Comprador no informado')}</small></span>
        <b>${item.amount ? e(compactAmount(item.amount)) : 'Ver'}</b>
      </button>`).join('');
  };

  return `<div class="cc-market-bars">
    <div class="cc-market-bars-summary"><strong>${e(totalLabel)}</strong><span>${e(unit)}</span><small>${categories.length} rubros detectados</small></div>
    <div class="cc-market-bars-list">${rows.map((x) => {
      const value = Number(x.value || 0);
      const pct = total ? (value / total) * 100 : 0;
      const shown = metric === 'amount' ? compactAmount(value) : value.toLocaleString('es-CL');
      return `<details class="cc-market-bar-row">
        <summary>
          <div class="cc-market-bar-label"><span>${e(x.label)}</span><strong>${e(shown)} · ${pct.toFixed(0)}%</strong></div>
          <div class="cc-market-bar-track"><i style="width:${Math.max(2,pct).toFixed(1)}%"></i></div>
        </summary>
        <div class="cc-category-examples">
          <span class="cc-category-examples-title">Ejemplos de publicaciones en este grupo</span>
          ${renderExamples(x.label)}
        </div>
      </details>`;
    }).join('')}</div>
  </div>`;
}

function analyticsControls() {
  return `<div class="cc-analytics-controls">
    <label>Universo<select id="ccAnalyticsUniverse"><option value="campaigns" ${chilecompraState.analyticsUniverse === 'campaigns' ? 'selected' : ''}>Mis seguimientos</option><option value="business" ${chilecompraState.analyticsUniverse === 'business' ? 'selected' : ''}>Mi negocio</option><option value="general" ${chilecompraState.analyticsUniverse === 'general' ? 'selected' : ''}>Mercado general Chile</option></select></label>
    <label>Métrica<select id="ccAnalyticsMetric"><option value="publications" ${chilecompraState.analyticsMetric === 'publications' ? 'selected' : ''}>Publicaciones</option><option value="amount" ${chilecompraState.analyticsMetric === 'amount' ? 'selected' : ''}>Monto publicado</option><option value="buyers" ${chilecompraState.analyticsMetric === 'buyers' ? 'selected' : ''}>Compradores</option></select></label>
    <label>Agrupar por<select id="ccAnalyticsGroupBy"><option value="industry" ${chilecompraState.analyticsGroupBy === 'industry' ? 'selected' : ''}>Rubro</option><option value="orgType" ${chilecompraState.analyticsGroupBy === 'orgType' ? 'selected' : ''}>Tipo de organización</option><option value="procurementType" ${chilecompraState.analyticsGroupBy === 'procurementType' ? 'selected' : ''}>Tipo de publicación</option></select></label>
    ${chilecompraState.analyticsUniverse === 'business' ? '<button type="button" class="ghost-btn cc-config-business" data-cc-business-open>Configurar mi negocio</button>' : ''}
  </div>`;
}

function campaignRow(c, stats, { controls = true } = {}) {
  const count = stats.newByCampaign?.[c.id] || 0;
  return `<article class="cc-user-campaign" data-cc-campaign-open="${c.id}"><div class="cc-user-campaign-icon">⌖</div><div class="cc-user-campaign-copy"><strong>${e(c.name)}</strong><span>${e((c.query_terms || []).slice(0, 4).join(', ') || 'Sin términos configurados')}</span></div><b>${count}</b>${controls ? `<label class="cc-switch" title="${c.active ? 'Desactivar' : 'Activar'} seguimiento"><input type="checkbox" data-cc-campaign-toggle="${c.id}" ${c.active ? 'checked' : ''}><span></span></label>` : ''}<span class="cc-chevron">›</span></article>`;
}

function dashboardNav(stats) {
  const opportunityTabs = new Set(['coincidencias','guardadas','crm','buscar']);
  const marketTabs = new Set(['mercado','compradores','convenio']);
  const activeSection = chilecompraState.tab === 'resumen'
    ? 'resumen'
    : chilecompraState.tab === 'campanas'
      ? 'campanas'
      : opportunityTabs.has(chilecompraState.tab)
        ? 'oportunidades'
        : 'mercado';

  const primary = [
    ['resumen','Resumen','resumen'],
    ['coincidencias','Oportunidades','oportunidades'],
    ['campanas','Seguimientos','campanas'],
    ['mercado','Mercado','mercado']
  ];

  const secondary = activeSection === 'oportunidades'
    ? [
        ['coincidencias','Coincidencias',stats.total],
        ['guardadas','Guardadas',''],
        ['crm','En CRM',''],
        ['buscar','Buscar','']
      ]
    : activeSection === 'mercado'
      ? [
          ['mercado','Mercado Chile',''],
          ['compradores','Compradores',''],
          ['convenio','Convenio Marco','']
        ]
      : [];

  return `<div class="cc-dashboard-nav cc-dashboard-nav--grouped">
    <nav class="cc-tabs cc-dashboard-tabs cc-dashboard-tabs--primary" aria-label="Secciones ChileCompra">
      ${primary.map(([id,label,section]) => `<button type="button" data-cc-tab="${id}" class="${activeSection === section ? 'active' : ''}">${label}</button>`).join('')}
    </nav>
    ${secondary.length ? `<nav class="cc-secondary-nav cc-secondary-nav--context" aria-label="${activeSection === 'mercado' ? 'Mercado' : 'Oportunidades'}">
      ${secondary.map(([id,label,count]) => `<button type="button" data-cc-tab="${id}" class="${chilecompraState.tab === id ? 'active' : ''}">${label}${count !== '' ? `<span class="cc-nav-count">${count}</span>` : ''}</button>`).join('')}
    </nav>` : ''}
  </div>`;
}

function sharedDialogs() {
  return `<dialog id="ccCampaignDialog" class="modal cc-campaign-dialog"><form id="ccCampaignForm" class="modal-card"><div class="modal-head"><div><h2>Crear seguimiento</h2><p>Dinos qué vendes o qué oportunidad quieres detectar. El CRM buscará coincidencias por ti.</p></div><button type="button" class="icon-btn" data-cc-dialog-close="ccCampaignDialog">×</button></div><div class="form-grid"><label class="span-2">Nombre del seguimiento<input id="ccCampaignName" required placeholder="Ej. Telemetría industrial"></label><label class="span-2">Palabras o frases a seguir<textarea id="ccCampaignTerms" rows="5" required placeholder="Escribe palabras o frases de búsqueda"></textarea></label></div><div id="ccCampaignSuggestions" class="cc-campaign-suggestions"><div class="cc-suggestion-hint">Escribe el nombre o una palabra clave y te sugeriremos búsquedas relacionadas.</div></div><p class="muted">Sepáralas por coma o por línea. Puedes usar las recomendaciones o escribir tus propios términos.</p><div class="modal-actions"><button type="button" class="ghost-btn" data-cc-dialog-close="ccCampaignDialog">Cancelar</button><button type="submit" class="primary-btn">Crear y buscar</button></div></form></dialog>
  <dialog id="ccBusinessDialog" class="modal cc-campaign-dialog"><form id="ccBusinessForm" class="modal-card"><div class="modal-head"><div><h2>Mi negocio</h2><p>Define el universo estratégico que quieres estudiar, independiente de tus seguimientos.</p></div><button type="button" class="icon-btn" data-cc-dialog-close="ccBusinessDialog">×</button></div><div class="form-grid"><label class="span-2">Palabras o frases de tu negocio<textarea id="ccBusinessTerms" rows="6" placeholder="software operacional, IoT, trazabilidad, telemetría...">${e((chilecompraState.marketProfile?.query_terms || []).join(', '))}</textarea></label></div><div class="modal-actions"><button type="button" class="ghost-btn" data-cc-dialog-close="ccBusinessDialog">Cancelar</button><button type="submit" class="primary-btn">Guardar perfil</button></div></form></dialog>`;
}

function renderSummaryDashboard(stats) {
  const hasMatches = stats.total > 0;
  const onboarding = !stats.activeCampaigns
    ? `<section class="cc-dashboard-card cc-getting-started">
        <span class="cc-eyebrow">Empieza aquí</span>
        <h3>Encuentra oportunidades en 3 pasos</h3>
        <div class="cc-start-steps">
          <div><b>1</b><span><strong>Crea un seguimiento</strong><small>Escribe qué producto o servicio quieres detectar.</small></span></div>
          <div><b>2</b><span><strong>El radar busca por ti</strong><small>Revisamos licitaciones activas y guardamos las coincidencias.</small></span></div>
          <div><b>3</b><span><strong>Revisa y pasa al CRM</strong><small>Abre una coincidencia, guárdala o conviértela en oportunidad.</small></span></div>
        </div>
        <button type="button" class="primary-btn cc-primary-start" data-cc-campaign-new>Crear mi primer seguimiento</button>
      </section>`
    : '';

  const radar = stats.activeCampaigns
    ? (hasMatches
      ? `<div class="cc-kpi-grid"><button type="button" data-cc-tab="coincidencias"><strong>${stats.total}</strong><span>Coincidencias nuevas</span></button><button type="button" data-cc-tab="campanas"><strong>${stats.activeCampaigns}</strong><span>Seguimientos activos</span></button><div><strong>${stats.buyers}</strong><span>Compradores detectados</span></div><div><strong>${compactAmount(stats.amount)}</strong><span>Monto observado</span></div></div>`
      : `<section class="cc-dashboard-card cc-zero-state"><div><span class="cc-eyebrow">Radar al día</span><h3>No hay coincidencias nuevas</h3><p>Tus ${stats.activeCampaigns} seguimiento${stats.activeCampaigns === 1 ? '' : 's'} están activos. Puedes buscar novedades ahora o revisar sus términos si esperabas más resultados.</p></div><div class="cc-zero-actions"><button type="button" class="primary-btn" data-cc-tab="campanas">Revisar seguimientos</button><button type="button" class="ghost-btn" data-cc-tab="buscar">Hacer búsqueda puntual</button></div></section>`)
    : '';

  const followups = stats.activeCampaigns
    ? `<section class="cc-dashboard-card">
        <div class="cc-section-head"><div><h3>Seguimientos activos</h3><p>Estas búsquedas funcionan de forma automática. Toca una para ver sus coincidencias.</p></div></div>
        <div class="cc-user-campaign-list">${stats.campaigns.map((campaign) => campaignRow(campaign, stats, { controls: true })).join('')}</div>
      </section>`
    : '';

  return `<section class="cc-dashboard">
    ${onboarding}
    ${radar}
    ${followups}
    <section class="cc-dashboard-card cc-market-pulse-card">
      <div class="cc-section-head">
        <div><span class="cc-eyebrow">Pulso nacional</span><h3>Qué está comprando Chile</h3><p>Rubros con más publicaciones activas en Mercado Público. Abre un rubro para ver ejemplos reales.</p></div>
        <button type="button" class="ghost-btn" data-cc-tab="mercado">Analizar mercado</button>
      </div>
      ${chilecompraState.marketPulseLoading ? '<div class="cc-empty">Analizando Mercado Público…</div>' : marketBars(chilecompraState.marketPulse, { limit: 10 })}
    </section>
  </section>`;
}

function renderCampaignsDashboard(stats) {
  return `<section class="cc-dashboard"><section class="cc-dashboard-card"><div class="cc-section-head"><div><h3>Seguimientos</h3><p>Cada seguimiento es una búsqueda automática. Puedes activarlo, pausarlo o abrir sus coincidencias.</p></div><button type="button" class="primary-btn" data-cc-campaign-new>+ Crear seguimiento</button></div><div class="cc-user-campaign-list">${chilecompraState.campaigns.length ? chilecompraState.campaigns.map((c) => campaignRow(c, stats, { controls: true })).join('') : '<div class="cc-empty"><strong>Sin seguimientos</strong><span>Crea la primera búsqueda automática para empezar.</span></div>'}</div></section></section>`;
}

function renderMarketDashboard() {
  const data = chilecompraState.analyticsUniverse === 'campaigns' && !chilecompraState.analytics
    ? chilecompraLocalBreakdown({ metric: chilecompraState.analyticsMetric })
    : chilecompraState.analytics;

  return `<section class="cc-dashboard">
    <section class="cc-dashboard-card">
      <div class="cc-section-head">
        <div><span class="cc-eyebrow">Inteligencia de mercado</span><h3>Cómo respira Mercado Público</h3><p>Compara el mercado general de Chile, tu negocio o tus seguimientos y descubre dónde se concentra la demanda.</p></div>
      </div>
      ${analyticsControls()}
      ${chilecompraState.analyticsLoading ? '<div class="cc-empty">Analizando licitaciones activas…</div>' : marketBars(data, { limit: 24 })}
      <div class="cc-market-kpis"><div><strong>${Number(data?.publications || 0).toLocaleString('es-CL')}</strong><span>Publicaciones</span></div><div><strong>${Number(data?.buyers || 0).toLocaleString('es-CL')}</strong><span>Compradores</span></div><div><strong>${compactAmount(data?.amount || 0)}</strong><span>Monto observado</span></div></div>
    </section>
  </section>`;
}


function cmMetricBars(rows = [], { valueKey = 'total', labelKey = 'name', limit = 7, currency = 'CLP' } = {}) {
  const selected = rows.filter((row) => Number(row?.[valueKey] || 0) > 0).slice(0, limit);
  const max = Math.max(1, ...selected.map((row) => Number(row[valueKey] || 0)));
  if (!selected.length) return '<div class="cc-empty">Todavía no hay datos suficientes para este período.</div>';
  return `<div class="cc-cm-bars">${selected.map((row) => {
    const value = Number(row[valueKey] || 0);
    const shown = valueKey === 'total' ? cmMoney(value, currency) : value.toLocaleString('es-CL');
    return `<div class="cc-cm-bar"><div><span>${e(row[labelKey] || 'Sin nombre')}</span><strong>${e(shown)}</strong></div><i><b style="width:${Math.max(3,(value/max)*100).toFixed(1)}%"></b></i></div>`;
  }).join('')}</div>`;
}

function cmCommercialBadge(order) {
  const state = order?.commercial_state?.radar_state || 'nuevo';
  const labels = { nuevo:'Nueva', guardado:'Guardada', crm:'En CRM', descartado:'Descartada' };
  return `<span class="cc-cm-state cc-cm-state--${e(state)}">${e(labels[state] || state)}</span>`;
}

function cmOrderRow(order) {
  return `<article class="cc-cm-order" data-cm-order="${e(order.code)}">
    <div class="cc-cm-order-main">
      <div class="cc-cm-order-head"><strong>${e(order.name || order.description || 'Orden de Convenio Marco')}</strong>${cmCommercialBadge(order)}</div>
      <span>${e(order.code)} · ${e(order.agreement_code || 'Convenio no identificado')}</span>
      <small>${e(order.buyer_name || order.buyer_unit || 'Comprador no informado')} → ${e(order.supplier_name || 'Proveedor no informado')}</small>
      ${(order.matched_campaigns || []).length ? `<div class="cc-tags">${order.matched_campaigns.slice(0,3).map((campaign) => tag(campaign.name)).join('')}</div>` : ''}
    </div>
    <div class="cc-cm-order-side">
      <strong>${e(cmMoney(order.total, order.currency || 'CLP'))}</strong>
      <span>${order.created_at_mp ? e(fmtDate(order.created_at_mp.slice(0,10))) : 'Sin fecha'}</span>
    </div>
    <span class="cc-chevron">›</span>
  </article>`;
}

function renderCmPulse(data) {
  const stats = data?.stats || {};
  return `<div class="cc-cm-pulse">
    <div class="cc-kpi-grid cc-cm-kpis">
      <div><strong>${Number(stats.orders || 0).toLocaleString('es-CL')}</strong><span>Órdenes CM</span></div>
      <div><strong>${e(cmMoney(stats.total || 0))}</strong><span>Monto observado</span></div>
      <div><strong>${Number(stats.buyers || 0).toLocaleString('es-CL')}</strong><span>Organismos compradores</span></div>
      <div><strong>${Number(stats.suppliers || 0).toLocaleString('es-CL')}</strong><span>Proveedores</span></div>
    </div>

    <div class="cc-cm-grid-2">
      <section class="cc-cm-panel"><div class="cc-section-head"><div><h4>Quién está comprando más</h4><p>Monto de órdenes de Convenio Marco en el período.</p></div></div>${cmMetricBars(data?.buyers || [])}</section>
      <section class="cc-cm-panel"><div class="cc-section-head"><div><h4>Quién está vendiendo más</h4><p>Proveedores con mayor monto observado.</p></div></div>${cmMetricBars(data?.suppliers || [])}</section>
    </div>

    <section class="cc-cm-panel">
      <div class="cc-section-head"><div><h4>Productos y servicios con mayor gasto</h4><p>Precios y demanda observados en órdenes reales de Convenio Marco.</p></div><button type="button" class="ghost-btn" data-cm-view="productos">Ver productos y precios</button></div>
      ${cmMetricBars((data?.products || []).map((row) => ({...row,name:row.label})), { labelKey:'name', valueKey:'total', limit:10 })}
    </section>
  </div>`;
}

function renderCmOrders(data) {
  const rows = data?.orders || [];
  return `<section class="cc-cm-panel">
    <div class="cc-section-head"><div><h4>Órdenes de compra por Convenio Marco</h4><p>Compras reales emitidas por organismos del Estado. Abre una orden para revisar productos, proveedor y precios.</p></div></div>
    <div class="cc-cm-order-list">${rows.length ? rows.map(cmOrderRow).join('') : '<div class="cc-empty">No encontramos órdenes CM para este filtro.</div>'}</div>
  </section>`;
}

function renderCmProducts(data) {
  const rows = data?.products || [];
  return `<section class="cc-cm-panel">
    <div class="cc-section-head"><div><h4>Productos y precios observados</h4><p>Se calculan desde órdenes de compra CM reales. Para revisar la maestra oficial vigente usa Catálogo oficial.</p></div><button type="button" class="ghost-btn" data-cm-view="convenios">Catálogo oficial</button></div>
    <div class="cc-cm-product-list">${rows.length ? rows.map((row) => `<article>
      <div class="cc-cm-product-title"><strong>${e(row.label || row.productCode || 'Producto')}</strong><span>${e(row.productCode || row.category || '')}</span></div>
      <div class="cc-cm-product-metrics">
        <div><small>Órdenes</small><strong>${Number(row.orders || 0).toLocaleString('es-CL')}</strong></div>
        <div><small>Compradores</small><strong>${Number(row.buyers || 0).toLocaleString('es-CL')}</strong></div>
        <div><small>Precio prom.</small><strong>${row.avgPrice != null ? e(cmMoney(row.avgPrice)) : '—'}</strong></div>
        <div><small>Rango</small><strong>${row.minPrice != null ? `${e(cmMoney(row.minPrice))} – ${e(cmMoney(row.maxPrice))}` : '—'}</strong></div>
        <div><small>Monto</small><strong>${e(cmMoney(row.total || 0))}</strong></div>
      </div>
      ${(row.agreementCodes || []).length ? `<div class="cc-tags">${row.agreementCodes.map((code) => tag(code)).join('')}</div>` : ''}
    </article>`).join('') : '<div class="cc-empty">Todavía no hay ítems detallados suficientes para este período.</div>'}</div>
  </section>`;
}

function renderCmEntities(data, kind) {
  const isBuyer = kind === 'compradores';
  const rows = isBuyer ? (data?.buyers || []) : (data?.suppliers || []);
  return `<section class="cc-cm-panel">
    <div class="cc-section-head"><div><h4>${isBuyer ? 'Organismos compradores' : 'Proveedores en Convenio Marco'}</h4><p>${isBuyer ? 'Quién compra, cuánto y con qué frecuencia.' : 'Quién está capturando las compras observadas en el período.'}</p></div></div>
    <div class="cc-cm-entity-list">${rows.length ? rows.map((row,index) => `<article><b>${index+1}</b><div><strong>${e(row.name)}</strong><span>${row.orders} orden${row.orders===1?'':'es'} · ${(row.agreements || []).slice(0,3).map(e).join(' · ')}</span></div><strong>${e(cmMoney(row.total || 0))}</strong></article>`).join('') : '<div class="cc-empty">No hay datos para este período.</div>'}</div>
  </section>`;
}

function renderCmAgreements(data) {
  const observed = new Map((data?.agreements || []).map((row) => [row.code,row]));
  const catalog = new Map((data?.catalogFiles || []).map((row) => [String(row.code || '').toUpperCase(), row]));
  return `<section class="cc-cm-panel">
    <div class="cc-section-head"><div><h4>Convenios Marco vigentes</h4><p>Directorio oficial revisado al ${e(fmtDate(CM_DIRECTORY_REVIEWED_AT))}, cruzado con las órdenes observadas por el CRM.</p></div><div class="cc-cm-source-actions"><button type="button" class="ghost-btn" data-cm-external="https://www.mercadopublico.cl/TiendaHome/">Abrir Tienda oficial ↗</button><button type="button" class="ghost-btn" data-cm-external="https://datos-abiertos.chilecompra.cl/descargas/convenio-marco">Datos Abiertos ↗</button></div></div>
    <div class="cc-cm-agreement-list">${CM_CURRENT_AGREEMENTS.map((agreement) => {
      const status=agreementStatus(agreement);
      const row=observed.get(agreement.code);
      const file=catalog.get(agreement.code);
      return `<article>
        <div><span class="cc-cm-agreement-code">${e(agreement.code)}</span><strong>${e(agreement.name)}</strong><small>Vigencia hasta ${e(fmtDate(agreement.expires))}${file?.updatedAt ? ` · maestra actualizada ${e(file.updatedAt)}` : ''}</small></div>
        <div class="cc-cm-agreement-observed"><span class="cc-cm-validity cc-cm-validity--${status.tone}">${e(status.label)}</span><strong>${row ? e(cmMoney(row.total || 0)) : 'Sin compras en el período'}</strong><small>${row ? `${row.orders} órdenes · ${row.buyers} compradores · ${row.suppliers} proveedores` : 'Amplía el período para buscar transacciones.'}</small>${file?.url ? `<button type="button" class="cc-cm-catalog-link" data-cm-external="${e(file.url)}">Abrir maestra oficial ↗</button>` : ''}</div>
      </article>`;
    }).join('')}</div>
    <div class="cc-api-note cc-cm-catalog-note"><strong>Catálogo oficial integrado</strong><span>El módulo consulta el índice oficial de maestras de Convenio Marco publicado por ChileCompra en Datos Abiertos. Cada convenio muestra la fecha de actualización de su maestra y permite abrir el archivo oficial. Los precios del panel Productos y precios son valores realmente observados en órdenes de compra.</span></div>
  </section>
  <section class="cc-cm-panel cc-cm-gran-compra">
    <div class="cc-section-head"><div><span class="cc-eyebrow">También dentro de Convenio Marco</span><h4>Gran Compra</h4><p>Los procesos de Gran Compra se publican como un conjunto separado en Datos Abiertos. Desde aquí puedes acceder a la fuente oficial para analizar procesos de alto monto.</p></div><button type="button" class="primary-btn" data-cm-external="https://datos-abiertos.chilecompra.cl/descargas">Ver procesos de Gran Compra ↗</button></div>
  </section>`;
}

function renderConvenioMarcoDashboard() {
  const data = chilecompraState.cmData;
  const view = chilecompraState.cmView || 'pulso';
  const views = [
    ['pulso','Pulso'],
    ['ordenes','Órdenes'],
    ['productos','Productos y precios'],
    ['compradores','Compradores'],
    ['proveedores','Proveedores'],
    ['convenios','Catálogo oficial']
  ];

  return `<section class="cc-dashboard cc-cm-dashboard">
    <section class="cc-dashboard-card cc-cm-hero">
      <div class="cc-section-head"><div><span class="cc-eyebrow">Inteligencia comercial</span><h3>Convenio Marco</h3><p>Ve qué está comprando el Estado por catálogo, a quién le compra, cuánto paga y qué proveedores están capturando la demanda.</p></div><button type="button" class="primary-btn" data-cm-sync>${chilecompraState.cmLoading ? 'Actualizando…' : 'Actualizar datos'}</button></div>
      <form id="ccCmSearch" class="cc-cm-controls">
        <label><span>Período</span><select id="ccCmDays"><option value="1" ${chilecompraState.cmDays===1?'selected':''}>Último día</option><option value="3" ${chilecompraState.cmDays===3?'selected':''}>Últimos 3 días</option><option value="7" ${chilecompraState.cmDays===7?'selected':''}>Últimos 7 días</option><option value="30" ${chilecompraState.cmDays===30?'selected':''}>Últimos 30 días</option></select></label>
        <label class="cc-cm-search"><span>Buscar</span><input id="ccCmQuery" type="search" value="${e(chilecompraState.cmQuery)}" placeholder="Producto, organismo, proveedor, código OC o convenio"></label>
        <button type="submit" class="ghost-btn">Aplicar</button>
      </form>
      ${data?.coverage ? `<div class="cc-cm-coverage"><span>Período analizado: <strong>${data.days} día${data.days===1?'':'s'}</strong></span><span>Órdenes cargadas: <strong>${Number(data.coverage.orders||0).toLocaleString('es-CL')}</strong></span><span>Detalle de ítems: <strong>${data.coverage.percent}%</strong></span>${data.coverage.truncated ? `<span class="cc-cm-coverage-warning">Hay ${Number(data.coverage.detected||0).toLocaleString('es-CL')} órdenes en caché para el período; el análisis usa las ${Number(data.coverage.loaded||0).toLocaleString('es-CL')} más recientes.</span>` : ''}</div>` : ''}
      ${chilecompraState.cmError ? `<div class="cc-detail-warning"><strong>No se pudo completar la consulta</strong><span>${e(chilecompraState.cmError)}</span></div>` : ''}
      ${(data?.campaigns || []).length ? `<div class="cc-campaign-filter cc-cm-campaign-filter">
        <button type="button" data-cm-campaign-filter="" class="${!chilecompraState.cmCampaignId ? 'active' : ''}">Todo Convenio Marco</button>
        ${data.campaigns.map((campaign) => `<button type="button" data-cm-campaign-filter="${e(campaign.id)}" class="${chilecompraState.cmCampaignId===campaign.id?'active':''}">${e(campaign.name)} <b>${Number(campaign.orders || 0).toLocaleString('es-CL')}</b></button>`).join('')}
      </div>` : ''}
    </section>

    <nav class="cc-cm-subnav">${views.map(([id,label]) => `<button type="button" data-cm-view="${id}" class="${view===id?'active':''}">${label}</button>`).join('')}</nav>

    ${chilecompraState.cmLoading && !data
      ? '<section class="cc-cm-panel cc-cm-loading"><span class="cc-search-spinner"></span><strong>Cargando órdenes de Convenio Marco…</strong><small>Consultamos la API oficial de órdenes de compra y filtramos las de tipo CM.</small></section>'
      : view==='ordenes' ? renderCmOrders(data)
      : view==='productos' ? renderCmProducts(data)
      : view==='compradores' ? renderCmEntities(data,'compradores')
      : view==='proveedores' ? renderCmEntities(data,'proveedores')
      : view==='convenios' ? renderCmAgreements(data)
      : renderCmPulse(data)}
  </section>`;
}

function renderCmOrderPage() {
  const payload=chilecompraState.cmDetail;
  const order=payload?.order || (chilecompraState.cmData?.orders || []).find((row)=>row.code===chilecompraState.cmSelectedCode);
  if(chilecompraState.cmDetailLoading && !order) return '<section class="cc-cm-panel cc-cm-loading"><span class="cc-search-spinner"></span><strong>Cargando orden de Convenio Marco…</strong></section>';
  if(!order) return '<section class="cc-detail-page"><div class="cc-empty">No pudimos cargar esta orden de Convenio Marco.</div></section>';
  const items=payload?.items || cmOrderItems(order.code);
  const state=order.commercial_state?.radar_state || 'nuevo';

  return `<section class="cc-detail-page cc-cm-detail-page">
    <div class="cc-detail-page-toolbar"><button type="button" class="cc-back-btn" data-cm-back>← Volver a Convenio Marco</button><span>OC ${e(order.code)}</span></div>
    <div class="cc-detail-page-shell">
      <div class="cc-cm-detail">
        <div class="cc-cm-detail-head"><div><span class="cc-eyebrow">${e(order.agreement_code || 'Convenio Marco')}</span><h2>${e(order.name || order.description || 'Orden de compra')}</h2><p>${e(order.buyer_name || order.buyer_unit || 'Comprador no informado')} → ${e(order.supplier_name || 'Proveedor no informado')}</p></div>${cmCommercialBadge(order)}</div>
        <div class="cc-cm-detail-kpis">
          <div><small>Total OC</small><strong>${e(cmMoney(order.total,order.currency||'CLP'))}</strong></div>
          <div><small>Estado</small><strong>${e(order.status || 'Sin estado')}</strong></div>
          <div><small>Fecha</small><strong>${order.created_at_mp ? e(fmtDate(order.created_at_mp.slice(0,10))) : 'No informada'}</strong></div>
          <div><small>Ítems</small><strong>${items.length}</strong></div>
        </div>
        ${order.description ? `<section class="cc-detail-block"><h4>Descripción</h4><p class="cc-description">${e(order.description)}</p></section>` : ''}
        <div class="cc-cm-grid-2">
          <section class="cc-detail-block"><h4>Organismo comprador</h4><div class="cc-detail-kv">
            <div><small>Organismo</small><strong>${e(order.buyer_name || 'No informado')}</strong></div>
            <div><small>Unidad</small><strong>${e(order.buyer_unit || 'No informada')}</strong></div>
            <div><small>RUT</small><strong>${e(order.buyer_rut || 'No informado')}</strong></div>
            <div><small>Región / comuna</small><strong>${e([order.buyer_region,order.buyer_commune].filter(Boolean).join(' · ') || 'No informado')}</strong></div>
            <div><small>Contacto</small><strong>${e(order.buyer_contact || 'No informado')}</strong></div>
            <div><small>Correo</small><strong>${e(order.buyer_email || 'No informado')}</strong></div>
          </div></section>
          <section class="cc-detail-block"><h4>Proveedor</h4><div class="cc-detail-kv">
            <div><small>Proveedor</small><strong>${e(order.supplier_name || 'No informado')}</strong></div>
            <div><small>RUT</small><strong>${e(order.supplier_rut || 'No informado')}</strong></div>
            <div><small>Región / comuna</small><strong>${e([order.supplier_region,order.supplier_commune].filter(Boolean).join(' · ') || 'No informado')}</strong></div>
            <div><small>Contacto</small><strong>${e(order.supplier_contact || 'No informado')}</strong></div>
            <div><small>Correo</small><strong>${e(order.supplier_email || 'No informado')}</strong></div>
            <div><small>Convenio</small><strong>${e(order.agreement_code || 'No identificado')}</strong></div>
          </div></section>
        </div>
        <section class="cc-detail-block"><h4>Productos / servicios comprados</h4>
          <div class="cc-detail-items">${items.length ? items.map((item,index)=>`<article><div><span>Ítem ${index+1}</span><strong>${e(item.raw?.Producto || item.supplier_spec || item.buyer_spec || item.category || item.product_code || 'Producto')}</strong></div><dl>
            <div><dt>Producto</dt><dd>${e(item.raw?.Producto || item.supplier_spec || item.buyer_spec || 'No informado')}</dd></div>
            <div><dt>Código ONU / producto</dt><dd>${e(item.product_code || item.category_code || 'No informado')}</dd></div>
            <div><dt>Categoría</dt><dd>${e(item.category || 'No informada')}</dd></div>
            <div><dt>Cantidad</dt><dd>${item.quantity ?? '—'} ${e(item.unit || '')}</dd></div>
            <div><dt>Precio unitario</dt><dd>${item.unit_price != null ? e(cmMoney(item.unit_price,item.currency||order.currency||'CLP')) : '—'}</dd></div>
            <div><dt>Total ítem</dt><dd>${item.total != null ? e(cmMoney(item.total,item.currency||order.currency||'CLP')) : '—'}</dd></div>
            <div><dt>Convenio</dt><dd>${e(item.agreement_code || order.agreement_code || 'No identificado')}</dd></div>
          </dl></article>`).join('') : '<div class="cc-empty">La API todavía no devolvió el detalle de ítems para esta orden.</div>'}</div>
        </section>
        <div class="cc-detail-actions cc-cm-detail-actions">
          <button type="button" class="primary-btn" data-cm-crm="${e(order.code)}" ${state==='crm'?'disabled':''}>${state==='crm'?'✓ Ya está en CRM':'Agregar al CRM'}</button>
          <button type="button" class="ghost-btn" data-cm-state="guardado" data-cm-code="${e(order.code)}">${state==='guardado'?'✓ Guardada':'♡ Guardar'}</button>
          <button type="button" class="ghost-btn" data-cm-state="descartado" data-cm-code="${e(order.code)}">⊘ Descartar</button>
        </div>
      </div>
    </div>
  </section>`;
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
  return `<section class="cc-dashboard"><section class="cc-dashboard-card"><div class="cc-section-head"><div><h3>Compradores detectados</h3><p>Organismos que aparecen dentro de tus seguimientos activos.</p></div></div><div class="cc-buyers-list">${rows.length ? rows.slice(0, 30).map((r) => `<article><div><strong>${e(r.name)}</strong><span>${e([...r.industries].slice(0, 3).join(' · '))}</span></div><b>${r.publications}</b><small>${compactAmount(r.amount)}</small></article>`).join('') : '<div class="cc-empty">Todavía no hay compradores detectados por tus seguimientos.</div>'}</div></section></section>`;
}

function renderOpportunityWorkspace(stats) {
  const rows = filteredRows();
  const selected = selectedOpportunity();
  const isSearch = chilecompraState.tab === 'buscar';
  const query = String(chilecompraState.query || '').trim();
  const sourceCount = Number(chilecompraState.sourceCount || 0);
  const quickSearches = ['luminarias LED', 'telemetría', 'software SaaS', 'IoT', 'mantenimiento industrial', 'climatización'];

  const searchExperience = isSearch ? `
    <section class="cc-search-hero">
      <div class="cc-search-copy">
        <span class="cc-eyebrow">Búsqueda puntual</span>
        <h3>¿Qué quieres encontrar?</h3>
        <p>Busca una licitación por producto, servicio, necesidad o código.</p>
      </div>
      <form id="ccTraditionalSearch" class="cc-search-form">
        <div class="cc-search-field">
          <span aria-hidden="true">⌕</span>
          <input id="ccSearch" type="search" placeholder="Ej. luminarias LED, telemetría, software..." value="${e(query)}" autocomplete="off">
        </div>
        <button type="submit" class="primary-btn" ${chilecompraState.searching ? 'disabled' : ''}>${chilecompraState.searching ? 'Buscando…' : 'Buscar'}</button>
      </form>
      <div class="cc-quick-searches">
        <span>Prueba con:</span>
        ${quickSearches.map((term) => `<button type="button" data-cc-quick-search="${e(term)}">${e(term)}</button>`).join('')}
      </div>
    </section>` : '';

  const searchResults = isSearch
    ? chilecompraState.searching
      ? '<section class="cc-search-state cc-search-loading"><span class="cc-search-spinner"></span><strong>Buscando en Mercado Público</strong><small>Estamos revisando las licitaciones activas.</small></section>'
      : !query
        ? '<section class="cc-search-state"><strong>Empieza con una búsqueda</strong><small>No necesitas crear un seguimiento para consultar ChileCompra.</small></section>'
        : rows.length
          ? `<section class="cc-search-results-head"><div><strong>${rows.length} resultado${rows.length === 1 ? '' : 's'} para “${e(query)}”</strong><small>${sourceCount ? `Buscamos dentro de ${sourceCount.toLocaleString('es-CL')} licitaciones activas.` : 'Resultados encontrados en Mercado Público.'}</small></div><div class="cc-search-result-actions"><button type="button" class="ghost-btn" data-cc-follow-search>Crear seguimiento</button><select id="ccSort" aria-label="Ordenar oportunidades"><option value="recent" ${chilecompraState.sort === 'recent' ? 'selected' : ''}>Más recientes</option><option value="close" ${chilecompraState.sort === 'close' ? 'selected' : ''}>Cierre más próximo</option></select></div></section><div class="cc-opportunity-list">${rows.map(opportunityCard).join('')}</div>`
          : `<section class="cc-search-state cc-search-empty">
              <span class="cc-search-empty-icon">⌕</span>
              <strong>No encontramos resultados para “${e(query)}”</strong>
              <small>${sourceCount ? `Revisamos ${sourceCount.toLocaleString('es-CL')} licitaciones activas.` : ''} Prueba con menos palabras o un término más general.</small>
              <div class="cc-search-empty-actions">
                <button type="button" class="primary-btn" data-cc-focus-search>Modificar búsqueda</button>
                <button type="button" class="ghost-btn" data-cc-follow-search>Crear seguimiento con este término</button>
              </div>
            </section>`
    : '';

  return `<section class="cc-workspace">
    ${searchExperience}
    ${!isSearch && chilecompraState.tab === 'coincidencias' && stats.campaigns.length ? `<div class="cc-campaign-filter"><button type="button" data-cc-campaign-filter="" class="${!chilecompraState.selectedCampaignId ? 'active' : ''}">Todas</button>${stats.campaigns.map((c) => `<button type="button" data-cc-campaign-filter="${c.id}" class="${chilecompraState.selectedCampaignId === c.id ? 'active' : ''}">${e(c.name)} <b>${stats.newByCampaign[c.id] || 0}</b></button>`).join('')}</div>` : ''}
    ${isSearch ? searchResults : `<div class="cc-results-toolbar"><strong class="cc-result-title">${resultHeading(rows)}</strong><select id="ccSort" aria-label="Ordenar oportunidades"><option value="recent" ${chilecompraState.sort === 'recent' ? 'selected' : ''}>Más recientes</option><option value="close" ${chilecompraState.sort === 'close' ? 'selected' : ''}>Cierre más próximo</option></select></div>${chilecompraState.sourceCount ? `<p class="cc-result-count">Consulta sobre ${chilecompraState.sourceCount.toLocaleString('es-CL')} licitaciones activas.</p>` : ''}<div class="cc-opportunity-list">${rows.length ? rows.map(opportunityCard).join('') : '<div class="cc-empty">No hay resultados para esta vista.</div>'}</div>`}
  </section>`;
}

function detailReturnLabel() {
  if (chilecompraState.tab === 'buscar') return 'Resultados de búsqueda';
  if (chilecompraState.tab === 'guardadas') return 'Guardadas';
  if (chilecompraState.tab === 'crm') return 'En CRM';
  if (chilecompraState.tab === 'coincidencias') {
    const campaign = chilecompraState.campaigns.find((row) => row.id === chilecompraState.selectedCampaignId);
    return campaign ? `Coincidencias · ${campaign.name}` : 'Coincidencias';
  }
  return 'Oportunidades';
}

function renderOpportunityPage(o) {
  if (!o) return '<section class="cc-detail-page"><div class="cc-empty">No pudimos cargar esta licitación.</div></section>';
  const context = detailReturnLabel();
  return `<section class="cc-detail-page">
    <div class="cc-detail-page-toolbar">
      <button type="button" class="cc-back-btn" data-cc-detail-back>← Volver a ${e(context)}</button>
      <span>ID ${e(o.external_code)}</span>
    </div>
    <div class="cc-detail-page-shell">${detailPanel(o)}</div>
  </section>`;
}

function renderInner() {
  const stats = chilecompraDashboardStats();
  if (chilecompraState.cmSelectedCode) return `${renderCmOrderPage()}${sharedDialogs()}`;

  const selected = chilecompraState.selectedId ? selectedOpportunity() : null;
  if (selected) return `${renderOpportunityPage(selected)}${sharedDialogs()}`;

  const isSearch = chilecompraState.tab === 'buscar';
  const isCm = chilecompraState.tab === 'convenio';
  const updated = chilecompraState.lastSyncAt
    ? 'Última revisión ' + new Date(chilecompraState.lastSyncAt).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })
    : stats.activeCampaigns ? 'Listo para buscar novedades' : 'Sin revisión reciente';

  const showToolbar = !isCm && !isSearch && stats.activeCampaigns > 0 && chilecompraState.tab !== 'campanas';
  const toolbar = showToolbar ? `<section class="cc-module-toolbar">
    <span class="cc-updated"><i></i>${updated}</span>
    <div class="cc-module-actions">
      <button type="button" class="ghost-btn" data-cc-sync ${chilecompraState.syncing ? 'disabled' : ''}>↻ ${chilecompraState.syncing ? 'Buscando…' : 'Buscar novedades'}</button>
    </div>
  </section>` : '';

  const content = chilecompraState.tab === 'resumen' ? renderSummaryDashboard(stats)
    : chilecompraState.tab === 'campanas' ? renderCampaignsDashboard(stats)
    : chilecompraState.tab === 'mercado' ? renderMarketDashboard()
    : chilecompraState.tab === 'compradores' ? renderBuyersDashboard()
    : chilecompraState.tab === 'convenio' ? renderConvenioMarcoDashboard()
    : renderOpportunityWorkspace(stats);

  return `${toolbar}${dashboardNav(stats)}${content}${sharedDialogs()}`;
}

export function renderChileCompra() {
  return '<div id="chilecompraRoot" class="cc-root"></div>';
}

function rerender() {
  const root = document.getElementById('chilecompraRoot');
  if (root) root.innerHTML = renderInner();
}

export async function runTraditionalSearch(query) {
  const clean = query.trim();
  if (clean.length < 2) return toast('Escribe al menos 2 caracteres para buscar.', 'error');
  chilecompraState.query = clean;
  chilecompraState.tab = 'buscar';
  chilecompraState.searching = true;
  chilecompraState.selectedId = '';
  rerender();
  try {
    const data = await invokeRadar({ action: 'search', query: clean });
    chilecompraState.results = (data.results || []).map(withUserState);
    chilecompraState.sourceCount = Number(data.sourceCount || 0);
    mergeRows(chilecompraState.results);
  } finally {
    chilecompraState.searching = false;
    notify();
    rerender();
  }
}

function replaceEverywhere(updated) {
  const merged = withUserState(updated);
  const oi = chilecompraState.opportunities.findIndex((o) => o.id === updated.id);
  if (oi >= 0) chilecompraState.opportunities[oi] = merged;
  const ri = chilecompraState.results.findIndex((o) => o.id === updated.id);
  if (ri >= 0) chilecompraState.results[ri] = merged;
}

async function markReviewed(id) {
  const now = new Date().toISOString();
  campaignMatchesForOpportunity(id).forEach((m) => { m.reviewed_at = now; });
  notify();
  try { await invokeRadar({ action: 'review', opportunityId: id }); } catch (err) { console.error('No se pudo marcar coincidencia revisada', err); }
}

async function loadDetail(id, { force = false } = {}) {
  const current = [...chilecompraState.results, ...chilecompraState.opportunities].find((o) => o.id === id);
  if (!current) return;

  await markReviewed(id);

  const hasUsefulDetail = Boolean(
    current.description
    || current.buyer_name
    || current.published_at
    || current.amount != null
    || (current.raw && Object.keys(current.raw).length > 6)
  );
  if (!force && current.detail_loaded && hasUsefulDetail) {
    chilecompraState.detailLoading = false;
    chilecompraState.detailError = '';
    rerender();
    return;
  }

  chilecompraState.detailLoading = true;
  chilecompraState.detailError = '';
  rerender();

  try {
    const data = await invokeRadar({ action: 'detail', code: current.external_code });
    if (data?.opportunity) {
      replaceEverywhere(data.opportunity);
      if (data.detailComplete === false) {
        chilecompraState.detailError = 'Mercado Público devolvió solo información básica para esta licitación.';
      }
      notify();
    }
  } catch (err) {
    console.error('No se pudo cargar detalle ChileCompra', err);
    chilecompraState.detailError = err?.message || 'Mercado Público no respondió con el detalle de esta licitación.';
  } finally {
    chilecompraState.detailLoading = false;
    rerender();
  }
}

async function patchOpportunity(id, patch) {
  if (isReadOnly()) return toast('Tu perfil es de solo lectura.', 'error');
  const organizationId = session.profile?.organization_id;
  const profileId = session.user?.id;
  if (!organizationId || !profileId) throw new Error('No se pudo resolver tu perfil.');
  const current = chilecompraState.userStates.find((row) => row.opportunity_id === id);
  const payload = {
    organization_id: organizationId,
    profile_id: profileId,
    opportunity_id: id,
    radar_state: patch.radar_state || current?.radar_state || 'nuevo',
    lead_id: patch.lead_id ?? current?.lead_id ?? null,
    updated_at: patch.updated_at || new Date().toISOString()
  };
  const { data, error } = await supabase
    .from('chilecompra_user_states')
    .upsert(payload, { onConflict: 'organization_id,profile_id,opportunity_id' })
    .select('*')
    .single();
  if (error) throw error;
  const idx = chilecompraState.userStates.findIndex((row) => row.opportunity_id === id);
  if (idx >= 0) chilecompraState.userStates[idx] = data;
  else chilecompraState.userStates.push(data);
  const canonical = [...chilecompraState.opportunities, ...chilecompraState.results].find((o) => o.id === id);
  if (canonical) replaceEverywhere(canonical);
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
  if (!chilecompraState.marketPulse && !chilecompraState.marketPulseLoading) {
    ensureMarketPulse().then(() => rerender());
  }

  root.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      if (ev.target.id === 'ccTraditionalSearch') return await runTraditionalSearch(document.getElementById('ccSearch')?.value || '');
      if (ev.target.id === 'ccCmSearch') {
        chilecompraState.cmQuery = document.getElementById('ccCmQuery')?.value?.trim() || '';
        await loadConvenioMarco();
        return;
      }
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

    const cmCampaignFilter = ev.target.closest('[data-cm-campaign-filter]');
    if (cmCampaignFilter) {
      chilecompraState.cmCampaignId = cmCampaignFilter.dataset.cmCampaignFilter || '';
      chilecompraState.cmData = null;
      rerender();
      try { await loadConvenioMarco(); }
      catch (err) { toast(err.message || 'No se pudo filtrar Convenio Marco.', 'error'); }
      return;
    }

    const cmView = ev.target.closest('[data-cm-view]');
    if (cmView) {
      chilecompraState.cmView = cmView.dataset.cmView || 'pulso';
      rerender();
      return;
    }
    if (ev.target.closest('[data-cm-sync]')) {
      try {
        await loadConvenioMarco({ forceSync: true });
        toast('Convenio Marco actualizado.');
      } catch (err) {
        toast(err.message || 'No se pudieron actualizar las órdenes de Convenio Marco.', 'error');
      }
      return;
    }
    const cmOrder = ev.target.closest('[data-cm-order]');
    if (cmOrder) {
      try {
        await loadCmOrderDetail(cmOrder.dataset.cmOrder || '');
      } catch (err) {
        toast(err.message || 'No se pudo cargar la orden de Convenio Marco.', 'error');
      }
      return;
    }
    if (ev.target.closest('[data-cm-back]')) {
      chilecompraState.cmSelectedCode = '';
      chilecompraState.cmDetail = null;
      rerender();
      return;
    }
    const cmState = ev.target.closest('[data-cm-state]');
    if (cmState) {
      const code = cmState.dataset.cmCode || '';
      const nextState = cmState.dataset.cmState || 'guardado';
      try {
        await patchCmCommercialState(code, nextState);
        toast(nextState === 'guardado' ? 'Orden guardada.' : 'Orden descartada.');
      } catch (err) {
        toast(err.message || 'No se pudo actualizar la orden.', 'error');
      }
      return;
    }
    const cmCrm = ev.target.closest('[data-cm-crm]');
    if (cmCrm) {
      try { await convertCmToCrm(cmCrm.dataset.cmCrm || ''); }
      catch (err) { toast(err.message || 'No se pudo agregar al CRM.', 'error'); }
      return;
    }
    const cmExternal = ev.target.closest('[data-cm-external]');
    if (cmExternal) {
      openExternal(cmExternal.dataset.cmExternal || 'https://www.mercadopublico.cl/TiendaHome/');
      return;
    }

    const quickSearch = ev.target.closest('[data-cc-quick-search]');
    if (quickSearch) {
      await runTraditionalSearch(quickSearch.dataset.ccQuickSearch || '');
      return;
    }
    if (ev.target.closest('[data-cc-focus-search]')) {
      const input = document.getElementById('ccSearch');
      input?.focus();
      input?.select?.();
      return;
    }
    if (ev.target.closest('[data-cc-follow-search]')) {
      const query = String(chilecompraState.query || '').trim();
      const dialog = document.getElementById('ccCampaignDialog');
      if (dialog) {
        const name = document.getElementById('ccCampaignName');
        const terms = document.getElementById('ccCampaignTerms');
        if (name && !name.value) name.value = query ? `Seguimiento · ${query}` : '';
        if (terms) terms.value = query;
        dialog.showModal();
        requestAnimationFrame(renderCampaignTermSuggestions);
      }
      return;
    }
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
      chilecompraState.detailReturnY = window.scrollY || 0;
      chilecompraState.selectedId = select.dataset.ccSelect;
      chilecompraState.detailTab = 'resumen';
      chilecompraState.detailError = '';
      rerender();
      await loadDetail(chilecompraState.selectedId);
      return;
    }

    const example = ev.target.closest('[data-cc-example-code]');
    if (example) {
      const code = example.dataset.ccExampleCode || '';
      if (!code) return;
      await runTraditionalSearch(code);
      const match = chilecompraState.results.find((row) => row.external_code === code) || chilecompraState.results[0];
      if (match) {
        chilecompraState.detailReturnY = window.scrollY || 0;
        chilecompraState.selectedId = match.id;
        chilecompraState.detailTab = 'resumen';
        chilecompraState.detailError = '';
        rerender();
        await loadDetail(match.id);
      }
      return;
    }

    if (ev.target.closest('[data-cc-detail-back]')) {
      const returnY = Number(chilecompraState.detailReturnY || 0);
      chilecompraState.selectedId = '';
      chilecompraState.detailLoading = false;
      chilecompraState.detailError = '';
      rerender();
      requestAnimationFrame(() => window.scrollTo({ top: returnY, behavior: 'instant' }));
      return;
    }
    if (ev.target.closest('[data-cc-detail-retry]')) {
      if (chilecompraState.selectedId) await loadDetail(chilecompraState.selectedId, { force: true });
      return;
    }
    const tab = ev.target.closest('[data-cc-tab]');
    if (tab) {
      chilecompraState.tab = tab.dataset.ccTab;
      if (chilecompraState.tab !== 'coincidencias') chilecompraState.selectedCampaignId = '';
      chilecompraState.selectedId = '';
      rerender();
      if (chilecompraState.tab === 'resumen' && !chilecompraState.marketPulse) await ensureMarketPulse();
      if (chilecompraState.tab === 'mercado' && chilecompraState.analyticsUniverse !== 'campaigns' && !chilecompraState.analytics) await refreshAnalyticsFromControls();
      if (chilecompraState.tab === 'convenio' && !chilecompraState.cmData && !chilecompraState.cmLoading) {
        try { await loadConvenioMarco(); } catch (err) { toast(err.message || 'No se pudo cargar Convenio Marco.', 'error'); }
      }
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
        await ensureMarketPulse({ force: true });
        rerender();
      } catch (err) {
        toast(err.message || 'No se pudo actualizar el radar.', 'error');
      }
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
    if (ev.target.closest('[data-cc-market]')) {
      const selected = selectedOpportunity();
      const code = selected?.external_code || '';
      openExternal(code
        ? `https://buscador.mercadopublico.cl/ficha?code=${encodeURIComponent(code)}`
        : 'https://buscador.mercadopublico.cl/');
    }
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
      if (ev.target.id === 'ccCmDays') {
        chilecompraState.cmDays = Number(ev.target.value || 30);
        await loadConvenioMarco();
        return;
      }
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
  if (chilecompraState.tab === 'convenio' && !chilecompraState.cmData && !chilecompraState.cmLoading) {
    loadConvenioMarco().catch((err) => { console.error(err); toast('No se pudo cargar Convenio Marco.', 'error'); });
  }
}
