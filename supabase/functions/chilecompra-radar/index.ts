import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-radar-cron",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const API_BASE = "https://api.mercadopublico.cl/servicios/v1/publico";
const MP_SEARCH_URL = "https://www.mercadopublico.cl/BuscarLicitacion";

// El radar no presupone productos. Las coincidencias se definen exclusivamente
// por campañas y por el perfil de mercado configurados por cada organización.
const CAPABILITIES = [];

function json(body, status=200) {
  return new Response(JSON.stringify(body), { status, headers:{...CORS,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"} });
}
function normalize(v) {
  return String(v ?? "").normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase().replace(/\s+/g," ").trim();
}
function escapeRegex(v) {
  return v.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
}
function termMatches(text, term) {
  const needle=normalize(term);
  if (!needle) return false;
  if (/^[a-z0-9]{1,4}$/.test(needle)) {
    return new RegExp("(^|[^a-z0-9])"+escapeRegex(needle)+"([^a-z0-9]|$)","i").test(text);
  }
  return text.includes(needle);
}
function deepText(value, depth=0) {
  if (depth>7 || value==null) return "";
  if (typeof value==="string" || typeof value==="number") return String(value);
  if (Array.isArray(value)) return value.map(v=>deepText(v,depth+1)).join(" ");
  if (typeof value==="object") return Object.values(value).map(v=>deepText(v,depth+1)).join(" ");
  return "";
}
function get(obj,...keys) {
  for (const key of keys) if (obj && obj[key]!==undefined && obj[key]!==null) return obj[key];
}
function listFrom(payload) {
  const candidates=[
    payload?.Listado,
    payload?.listado,
    payload?.Listado?.Licitacion,
    payload?.Listado?.licitacion,
    payload?.Licitaciones?.Listado,
    payload?.Licitaciones?.Listado?.Licitacion,
    payload?.Licitaciones?.Listado?.licitacion
  ];
  for(const candidate of candidates) {
    if(Array.isArray(candidate)) return candidate;
    if(candidate && typeof candidate==="object" && (candidate.CodigoExterno || candidate.codigoExterno || candidate.Codigo)) return [candidate];
  }
  return [];
}
function isoDate(value) {
  if (!value) return null;
  const d=new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function money(value) {
  if (value==null || value==="") return null;
  const raw=String(value).trim();
  const normalized=raw.includes(",") ? raw.replace(/\./g,"").replace(",",".") : raw;
  const n=Number(normalized.replace(/[^\d.-]/g,""));
  return Number.isFinite(n) ? n : null;
}
function statusFrom(item) {
  const explicit=String(get(item,"Estado","estado")||"").trim();
  if (explicit) return explicit;
  return ({5:"Publicada",6:"Cerrada",7:"Desierta",8:"Adjudicada",15:"Revocada",16:"Suspendida",17:"Anulada"})[Number(get(item,"CodigoEstado","codigoEstado"))] || "Publicada";
}
function scoreText(raw) {
  const text=normalize(raw);
  let score=0;
  const capabilities=new Set(), solutions=new Set(), reasons=[];
  for (const cap of CAPABILITIES) {
    const matched=cap.terms.filter(term=>termMatches(text,term));
    if (!matched.length) continue;
    score += cap.weight + Math.min(12,(matched.length-1)*4);
    capabilities.add(cap.capability);
    if (cap.solution) cap.solution.split(" + ").forEach(s=>solutions.add(s));
    reasons.push(cap.capability+": "+matched.slice(0,3).join(", "));
  }
  const productCapabilities = [...capabilities].filter((name) =>
    !["HVAC","Facility","Grupos electrógenos","Telecomunicaciones","Transporte vertical","Industria","Utilities","Minería y túneles"].includes(name)
  );
  if (productCapabilities.length>=2) score+=12;
  if (solutions.size>=2) score+=10;
  if (solutions.size===0) score=0;
  score=Math.min(100,Math.round(score));
  return {
    score,
    fitLevel:score>=65?"alto":score>=25?"parcial":"bajo",
    capabilities:[...capabilities].slice(0,10),
    solutions:[...solutions].slice(0,4),
    reasons:reasons.slice(0,8)
  };
}
function listingFields(item) {
  const buyer=get(item,"Comprador","comprador")||{};
  const fechas=get(item,"Fechas")||{};
  return {
    code:String(get(item,"CodigoExterno","Codigo","codigo")||"").trim(),
    name:String(get(item,"Nombre","nombre")||"").trim(),
    description:String(get(item,"Descripcion","descripcion")||"").trim(),
    buyerName:String(get(buyer,"NombreOrganismo","NombreUnidad","RazonSocial","Nombre")||get(item,"NombreOrganismo","Organismo")||"").trim(),
    buyerCode:String(get(buyer,"CodigoOrganismo","CodigoUnidad","Codigo")||"").trim(),
    status:statusFrom(item),
    closeAt:isoDate(get(item,"FechaCierre","fechaCierre","FechaCierreRecepcionOferta")),
    publishedAt:isoDate(get(fechas,"FechaPublicacion")||get(item,"FechaPublicacion","fechaPublicacion")),
    amount:money(get(item,"MontoEstimado","Monto","Presupuesto")),
    currency:String(get(item,"Moneda","moneda")||"CLP").trim()||"CLP",
    procurementType:String(get(item,"Tipo","TipoLicitacion","tipo")||"Licitación pública").trim()
  };
}
function rowFromItem(item, organizationId) {
  const f=listingFields(item), fit=scoreText(deepText(item));
  return {
    organization_id:organizationId, external_code:f.code, name:f.name, description:f.description,
    buyer_name:f.buyerName, buyer_code:f.buyerCode, status:f.status, procurement_type:f.procurementType,
    published_at:f.publishedAt, close_at:f.closeAt, amount:f.amount, currency:f.currency,
    source_url:f.code ? `https://buscador.mercadopublico.cl/ficha?code=${encodeURIComponent(f.code)}` : MP_SEARCH_URL,
    fit_score:fit.score, fit_level:fit.fitLevel, matched_solutions:fit.solutions,
    matched_capabilities:fit.capabilities, match_reasons:fit.reasons, raw:item,
    last_seen_at:new Date().toISOString(), updated_at:new Date().toISOString()
  };
}
async function mercado(path,ticket,params={}) {
  const url=new URL(API_BASE+"/"+path);
  Object.entries(params).forEach(([k,v])=>{if(v) url.searchParams.set(k,String(v));});
  url.searchParams.set("ticket",ticket);
  const response=await fetch(url,{headers:{Accept:"application/json"}});
  if(!response.ok) throw new Error("Mercado Público respondió "+response.status);
  return await response.json();
}
async function loadSecret(admin,fn) {
  const {data,error}=await admin.rpc(fn);
  if(error||!data) throw new Error("No disponible: "+fn);
  return String(data);
}
async function activeListings(ticket) {
  return listFrom(await mercado("licitaciones.json",ticket,{estado:"activas"}));
}
function traditionalMatches(listings,query) {
  const q=normalize(query);
  const tokens=[...new Set(q.split(/\s+/).filter(x=>x.length>=2))];
  const ranked=[];
  for (const item of listings) {
    const f=listingFields(item);
    if(!f.code||!f.name) continue;

    const code=normalize(f.code);
    const name=normalize(f.name);
    const hay=normalize([f.code,f.name,f.description,f.buyerName,f.procurementType].filter(Boolean).join(" "));
    if(!hay) continue;

    let score=0;
    if(code===q) score+=400;
    if(name===q) score+=260;
    if(hay.includes(q)) score+=180;

    let hits=0;
    for (const token of tokens) {
      if(!hay.includes(token)) continue;
      hits+=1;
      score+=35;
      if(name.includes(token)) score+=24;
      if(code.includes(token)) score+=30;
    }

    const minimumHits=tokens.length<=1 ? 1 : Math.max(1,Math.ceil(tokens.length*0.6));
    if(!hay.includes(q) && hits<minimumHits) continue;
    if(score>0) ranked.push({item,score,hits});
  }
  ranked.sort((a,b)=>b.score-a.score || b.hits-a.hits);
  return ranked.slice(0,120).map(x=>x.item);
}
function campaignMatch(item, terms=[]) {
  const f=listingFields(item);
  const hay=normalize([f.code,f.name,f.description,f.buyerName,f.procurementType].filter(Boolean).join(" "));
  const matched=[...new Set((terms||[]).filter(term=>termMatches(hay,term)).map(term=>String(term).trim()).filter(Boolean))];
  return { matched, score: matched.length ? Math.min(100, 45 + (matched.length-1)*12) : 0 };
}
function hasDetailedFields(item) {
  const f=listingFields(item);
  return Boolean(
    f.description
    || f.buyerName
    || f.publishedAt
    || f.amount!=null
    || get(item,"Items","Documentos","Adjuntos")
    || get(item,"Comprador","comprador")
    || get(item,"Fechas")
  );
}
async function enrichRows(rows,ticket,limit=8) {
  const out=[...rows];
  for(let i=0;i<Math.min(limit,out.length);i++) {
    try {
      const payload=await mercado("licitaciones.json",ticket,{codigo:out[i].external_code});
      const item=listFrom(payload)[0]||payload;
      out[i]={...out[i],...rowFromItem(item,out[i].organization_id),detail_loaded:hasDetailedFields(item)};
    } catch {
      out[i]={...out[i],detail_loaded:false};
    }
  }
  return out;
}
async function upsertRows(admin,rows) {
  if(!rows.length) return [];
  const clean=rows.map(row=>({...row,detail_loaded:Boolean(row.detail_loaded)}));
  const {data,error}=await admin.from("chilecompra_opportunities")
    .upsert(clean,{onConflict:"organization_id,external_code"}).select("*");
  if(error) throw error;
  return data||[];
}
async function searchTraditional(admin,ticket,org,query) {
  const listings=await activeListings(ticket);
  let rows=traditionalMatches(listings,query).map(item=>rowFromItem(item,org));
  rows=await enrichRows(rows,ticket,8);
  const saved=await upsertRows(admin,rows);
  const order=new Map(rows.map((r,i)=>[r.external_code,i]));
  saved.sort((a,b)=>(order.get(a.external_code)??999)-(order.get(b.external_code)??999));
  return {sourceCount:listings.length,results:saved.slice(0,120)};
}
async function upsertCampaignMatches(admin,campaignId,items,opportunityByCode) {
  const now=new Date().toISOString();
  const rows=[];
  for(const item of items) {
    const f=listingFields(item);
    const opp=opportunityByCode.get(f.code);
    if(!opp) continue;
    const campaign=items._campaign;
    const match=campaignMatch(item,campaign?.query_terms||[]);
    if(!match.matched.length) continue;
    rows.push({
      campaign_id:campaignId,
      opportunity_id:opp.id,
      score:match.score,
      matched_terms:match.matched,
      updated_at:now,
      last_seen_at:now
    });
  }
  if(!rows.length) return [];
  const {data,error}=await admin.from("chilecompra_campaign_matches")
    .upsert(rows,{onConflict:"campaign_id,opportunity_id"}).select("*");
  if(error) throw error;
  return data||[];
}
async function searchCampaign(admin,ticket,org,campaignId) {
  const {data:campaign,error:campaignError}=await admin.from("chilecompra_campaigns")
    .select("*").eq("id",campaignId).eq("organization_id",org).maybeSingle();
  if(campaignError) throw campaignError;
  if(!campaign) throw new Error("Campaña no encontrada");
  const listings=await activeListings(ticket);
  const matchedItems=listings
    .map(item=>({item,match:campaignMatch(item,campaign.query_terms||[])}))
    .filter(x=>x.match.matched.length)
    .sort((a,b)=>b.match.score-a.match.score)
    .slice(0,250);
  let rows=matchedItems.map(x=>rowFromItem(x.item,org));
  rows=await enrichRows(rows,ticket,10);
  const saved=await upsertRows(admin,rows);
  const byCode=new Map(saved.map(x=>[x.external_code,x]));
  const now=new Date().toISOString();
  const matches=matchedItems.map(x=>{
    const code=listingFields(x.item).code;
    const opp=byCode.get(code);
    return opp ? {
      campaign_id:campaign.id, opportunity_id:opp.id, score:x.match.score,
      matched_terms:x.match.matched, updated_at:now, last_seen_at:now
    } : null;
  }).filter(Boolean);
  if(matches.length) {
    const {error}=await admin.from("chilecompra_campaign_matches")
      .upsert(matches,{onConflict:"campaign_id,opportunity_id"});
    if(error) throw error;
  }
  const order=new Map(rows.map((r,i)=>[r.external_code,i]));
  saved.sort((a,b)=>(order.get(a.external_code)??999)-(order.get(b.external_code)??999));
  return {sourceCount:listings.length,results:saved.slice(0,250),campaign};
}
async function syncOrganization(admin,ticket,org) {
  const {data:campaigns,error:campaignError}=await admin.from("chilecompra_campaigns")
    .select("*").eq("organization_id",org).eq("active",true).order("created_at");
  if(campaignError) throw campaignError;
  if(!(campaigns||[]).length) {
    return {organizationId:org,sourceCount:0,campaigns:0,matched:0,newMatches:0};
  }

  const listings=await activeListings(ticket);
  const byCode=new Map();
  const pendingMatches=[];
  for(const item of listings) {
    const f=listingFields(item);
    if(!f.code||!f.name) continue;
    for(const campaign of campaigns) {
      const match=campaignMatch(item,campaign.query_terms||[]);
      if(!match.matched.length) continue;
      if(!byCode.has(f.code)) byCode.set(f.code,rowFromItem(item,org));
      pendingMatches.push({campaign,item,code:f.code,match});
    }
  }

  const rows=[...byCode.values()];
  const {data:existing}=await admin.from("chilecompra_opportunities")
    .select("external_code,detail_loaded").eq("organization_id",org);
  const detail=new Map((existing||[]).map(x=>[x.external_code,Boolean(x.detail_loaded)]));
  const prepared=rows.map(r=>({...r,detail_loaded:detail.get(r.external_code)||false}));
  const saved=await upsertRows(admin,prepared);
  const opportunityByCode=new Map(saved.map(x=>[x.external_code,x]));
  const now=new Date().toISOString();
  const matchRows=pendingMatches.map(x=>{
    const opp=opportunityByCode.get(x.code);
    return opp ? {
      campaign_id:x.campaign.id,
      opportunity_id:opp.id,
      score:x.match.score,
      matched_terms:x.match.matched,
      updated_at:now,
      last_seen_at:now
    } : null;
  }).filter(Boolean);

  if(matchRows.length) {
    const {error}=await admin.from("chilecompra_campaign_matches")
      .upsert(matchRows,{onConflict:"campaign_id,opportunity_id"});
    if(error) throw error;
  }

  return {
    organizationId:org,
    sourceCount:listings.length,
    campaigns:campaigns.length,
    matched:saved.length,
    matches:matchRows.length
  };
}

const INDUSTRIES=[
  ["Salud",["prestaciones medicas","prestacion medica","imagenologia","ambulatoria","hospital","salud","clinica","cesfam","medica","medico","farmacia","laboratorio clinico","dental","insumo medico"]],
  ["Tecnología / Software",["software","plataforma","saas","licencia de software","tecnologia de informacion","tecnologia","informatico","computacional","hosting","cloud","nube","base de datos","ciberseguridad","realidad virtual","simulacion","desarrollo web","aplicacion movil","aplicacion web"]],
  ["Telecomunicaciones",["telecom","fibra optica","fibra","antena","radioenlace","lte","5g","conectividad","red de datos","telefonia","internet"]],
  ["Seguridad / Defensa",["seguridad","ejercito","armada","carabineros","pdi","defensa","vigilancia","cctv","control de acceso"]],
  ["Educación",["universidad","educacion","colegio","liceo","escuela","junaeb","capacitacion","curso","docencia"]],
  ["Construcción / Infraestructura",["construccion","obra civil","infraestructura","edificio","pavimento","techumbre","urbanizacion","habilitacion de espacios"]],
  ["Energía / Utilities",["energia","electrico","electricidad","agua potable","sanitaria","generador","electrogeno","panel solar","iluminacion","luminaria"]],
  ["Transporte / Logística",["transporte","logistica","flete","distribucion","vehiculo","camion","metro","traslado","bodega","almacenamiento"]],
  ["Industria / Minería",["mineria","industrial","planta industrial","faena","proceso productivo","maquinaria industrial","motor industrial","bomba industrial"]],
  ["Alimentación / Catering",["alimento","alimentacion","catering","casino","colacion","racion","bebida","comestible"]],
  ["Aseo / Facility",["aseo","limpieza","facility","jardineria","sanitizacion","desinfeccion","residuo","mantencion integral","mantenimiento integral"]],
  ["Oficina / Insumos",["articulo de oficina","insumo de oficina","papeleria","tinta","toner","impresora","fotocopiadora","utiles de oficina"]],
  ["Equipamiento / Mobiliario",["mobiliario","mueble","silla","escritorio","estanteria","equipamiento mobiliario"]],
  ["Consultoría / Servicios profesionales",["consultoria","asesoria","estudio","auditoria","servicio profesional","ingenieria","levantamiento","consultor"]],
  ["Medioambiente",["medioambiente","ambiental","reciclaje","monitoreo ambiental","areas verdes","gestion de residuos"]],
  ["Maquinaria / Vehículos",["maquinaria","excavadora","grua","camioneta","automovil","repuesto","neumatico"]],
  ["Textil / EPP",["uniforme","vestuario","ropa de trabajo","calzado","epp","elemento de proteccion personal"]],
  ["Comunicaciones / Eventos",["publicidad","difusion","impresion grafica","grafica","evento","produccion audiovisual","comunicaciones"]],
  ["Finanzas / Seguros",["seguro","poliza","bancaria","bancario","conciliacion bancaria","servicio financiero","financiero","leasing"]],
  ["Legal / Personas",["juridico","juridica","abogado","legal","recursos humanos","seleccion de personal","reclutamiento","evaluacion psicologica"]],
  ["Arriendo / Servicios operacionales",["arriendo","arrendamiento","mantencion","mantenimiento","reparacion","soporte tecnico","servicio tecnico"]],
  ["Cultura / Deporte / Turismo",["cultura","cultural","deporte","deportivo","turismo","hotel","alojamiento","recreacion"]],
  ["Ciencias / Laboratorio",["reactivo","laboratorio","microscopio","instrumental cientifico","equipo cientifico","analisis quimico"]],
  ["Agricultura / Veterinaria",["agricola","agricultura","veterinaria","veterinario","animal","riego","semilla","fertilizante"]]
];

function industryScore(text, term, weight) {
  if (!termMatches(text,term)) return 0;
  const normalizedTerm=normalize(term);
  const specificity=normalizedTerm.includes(" ") ? 1.1 : normalizedTerm.length>=9 ? .55 : 0;
  return weight+specificity;
}
function industryOf(item) {
  const f=listingFields(item);
  const name=normalize(f.name);
  const description=normalize(f.description);
  const buyer=normalize(f.buyerName);
  let bestLabel="Sin clasificar", bestScore=0;
  for(const [label,terms] of INDUSTRIES) {
    let score=0;
    for(const term of terms) {
      score+=industryScore(name,term,3);
      score+=industryScore(description,term,1.4);
      score+=industryScore(buyer,term,.65);
    }
    if(score>bestScore) { bestScore=score; bestLabel=label; }
  }
  return bestScore>=2.2 ? bestLabel : "Sin clasificar";
}
function orgTypeOf(item) {
  const name=normalize(listingFields(item).buyerName);
  if(/municipal|alcaldia|alcaldía/.test(name)) return "Municipalidades";
  if(/hospital|servicio de salud|salud|fonasa|cenabast/.test(name)) return "Salud";
  if(/universidad|colegio|liceo|escuela|educacion|educación/.test(name)) return "Educación";
  if(/ejercito|ejército|armada|carabineros|pdi|gendarmeria|gendarmería|defensa/.test(name)) return "FF.AA. / Seguridad";
  if(/empresa|metro|enap|efe|correos/.test(name)) return "Empresas públicas";
  if(name) return "Gobierno / servicios públicos";
  return "Sin clasificar";
}
function analyticsValue(item,metric) {
  if(metric==="amount") return Number(listingFields(item).amount||0);
  return 1;
}
function filterByTerms(listings,terms) {
  if(!(terms||[]).length) return [];
  return listings.filter(item=>campaignMatch(item,terms).matched.length);
}
function aggregateAnalytics(listings,{metric="publications",groupBy="industry"}={}) {
  const groups=new Map();
  const buyerGroups=new Map();
  const examples=new Map();

  for(const item of listings) {
    const f=listingFields(item);
    const key=groupBy==="orgType" ? orgTypeOf(item)
      : groupBy==="procurementType" ? (f.procurementType||"Sin clasificar")
      : industryOf(item);

    if(!examples.has(key)) examples.set(key,[]);
    const bucket=examples.get(key);
    if(bucket.length<6) {
      bucket.push({
        code:f.code||"",
        name:f.name||"Sin nombre",
        buyer:f.buyerName||"",
        amount:Number(f.amount||0),
        closeAt:f.closeAt||""
      });
    }

    if(metric==="buyers") {
      if(!buyerGroups.has(key)) buyerGroups.set(key,new Set());
      if(f.buyerName) buyerGroups.get(key).add(f.buyerName);
    } else {
      groups.set(key,(groups.get(key)||0)+analyticsValue(item,metric));
    }
  }

  if(metric==="buyers") {
    for(const [key,set] of buyerGroups) groups.set(key,set.size);
  }

  return {
    categories:[...groups.entries()]
      .map(([label,value])=>({label,value:Number(value||0)}))
      .sort((a,b)=>{
        if(a.label==="Sin clasificar") return 1;
        if(b.label==="Sin clasificar") return -1;
        return b.value-a.value;
      }),
    categoryExamples:Object.fromEntries([...examples.entries()])
  };
}
async function marketAnalytics(admin,ticket,org,body) {
  const universe=String(body?.universe||"campaigns");
  const metric=String(body?.metric||"publications");
  const groupBy=String(body?.groupBy||"industry");
  const listings=await activeListings(ticket);
  let selected=listings, configured=true;

  if(universe==="campaigns") {
    const {data:campaigns,error}=await admin.from("chilecompra_campaigns")
      .select("query_terms").eq("organization_id",org).eq("active",true);
    if(error) throw error;
    const terms=[...new Set((campaigns||[]).flatMap(c=>c.query_terms||[]))];
    configured=terms.length>0;
    selected=filterByTerms(listings,terms);
  } else if(universe==="business") {
    const {data:profile,error}=await admin.from("chilecompra_market_profiles")
      .select("query_terms").eq("organization_id",org).maybeSingle();
    if(error) throw error;
    const terms=profile?.query_terms||[];
    configured=terms.length>0;
    selected=filterByTerms(listings,terms);
  } else if(universe!=="general") {
    throw new Error("Universo inválido");
  }

  const buyerSet=new Set(selected.map(x=>listingFields(x).buyerName).filter(Boolean));
  const breakdown=aggregateAnalytics(selected,{metric,groupBy});
  return {
    universe,metric,groupBy,configured,
    sourceCount:listings.length,
    publications:selected.length,
    buyers:buyerSet.size,
    amount:selected.reduce((sum,x)=>sum+Number(listingFields(x).amount||0),0),
    categories:breakdown.categories,
    categoryExamples:breakdown.categoryExamples
  };
}


function orderListFrom(payload) {
  const candidates=[
    payload?.Listado,
    payload?.listado,
    payload?.Listado?.OrdenCompra,
    payload?.Listado?.ordenCompra,
    payload?.Ordenes?.Listado,
    payload?.Ordenes?.Listado?.OrdenCompra,
    payload?.Ordenes?.Listado?.ordenCompra
  ];
  for(const candidate of candidates) {
    if(Array.isArray(candidate)) return candidate;
    if(candidate && typeof candidate==="object" && (candidate.Codigo || candidate.codigo)) return [candidate];
  }
  return [];
}
function orderStatusFrom(item) {
  const explicit=String(get(item,"Estado","estado")||"").trim();
  if(explicit) return explicit;
  return ({
    4:"Enviada a proveedor",
    5:"En proceso",
    6:"Aceptada",
    9:"Cancelada",
    12:"Recepción conforme",
    13:"Pendiente de recepcionar",
    14:"Recepcionada parcialmente",
    15:"Recepción conforme incompleta"
  })[Number(get(item,"CodigoEstado","codigoEstado"))] || "Sin estado";
}
function agreementCodeFrom(value) {
  const text=String(value||"");
  const direct=text.match(/\b\d{4,}-\d+-L[A-Z]\d{2}\b/i);
  return direct ? direct[0].toUpperCase() : "";
}
function cmOrderFields(item) {
  const buyer=get(item,"Comprador","comprador")||{};
  const supplier=get(item,"Proveedor","proveedor")||{};
  const dates=get(item,"Fechas","fechas")||{};
  const type=String(get(item,"Tipo","tipo")||"").trim();
  const typeCode=Number(get(item,"CodigoTipo","codigoTipo"));
  const agreementCode=String(get(item,"CodigoLicitacion","codigoLicitacion")||"").trim() || agreementCodeFrom(deepText(get(item,"Items","items")||item));
  return {
    code:String(get(item,"Codigo","codigo")||"").trim(),
    name:String(get(item,"Nombre","nombre")||"").trim(),
    description:String(get(item,"Descripcion","descripcion")||"").trim(),
    statusCode:Number(get(item,"CodigoEstado","codigoEstado"))||null,
    status:orderStatusFrom(item),
    typeCode:Number.isFinite(typeCode) ? typeCode : null,
    type:type||"CM",
    currency:String(get(item,"TipoMoneda","Moneda","moneda")||"CLP").trim()||"CLP",
    netTotal:money(get(item,"TotalNeto","totalNeto")),
    total:money(get(item,"Total","total")),
    discounts:money(get(item,"Descuentos","descuentos")),
    charges:money(get(item,"Cargos","cargos")),
    taxes:money(get(item,"Impuestos","impuestos")),
    createdAt:isoDate(get(dates,"FechaCreacion")||get(item,"FechaCreacion")),
    sentAt:isoDate(get(dates,"FechaEnvio")||get(item,"FechaEnvio")),
    acceptedAt:isoDate(get(dates,"FechaAceptacion")||get(item,"FechaAceptacion")),
    cancelledAt:isoDate(get(dates,"FechaCancelacion")||get(item,"FechaCancelacion")),
    modifiedAt:isoDate(get(dates,"FechaUltimaModificacion")||get(item,"FechaUltimaModificacion")),
    buyerCode:String(get(buyer,"CodigoOrganismo")||"").trim(),
    buyerName:String(get(buyer,"NombreOrganismo","NombreUnidad")||"").trim(),
    buyerUnit:String(get(buyer,"NombreUnidad")||"").trim(),
    buyerRut:String(get(buyer,"RutUnidad")||"").trim(),
    buyerRegion:String(get(buyer,"RegionUnidad")||"").trim(),
    buyerCommune:String(get(buyer,"ComunaUnidad")||"").trim(),
    buyerAddress:String(get(buyer,"DireccionUnidad")||"").trim(),
    buyerContact:String(get(buyer,"NombreContacto")||"").trim(),
    buyerEmail:String(get(buyer,"MailContacto")||"").trim(),
    supplierCode:String(get(supplier,"Codigo")||"").trim(),
    supplierName:String(get(supplier,"Nombre","NombreSucursal")||"").trim(),
    supplierRut:String(get(supplier,"RutSucursal")||"").trim(),
    supplierRegion:String(get(supplier,"Region")||"").trim(),
    supplierCommune:String(get(supplier,"Comuna")||"").trim(),
    supplierAddress:String(get(supplier,"Direccion")||"").trim(),
    supplierContact:String(get(supplier,"NombreContacto")||"").trim(),
    supplierEmail:String(get(supplier,"MailContacto")||"").trim(),
    agreementCode
  };
}
function isCmOrder(item) {
  const f=cmOrderFields(item);
  return f.typeCode===9 || normalize(f.type)==="cm" || normalize(f.type).includes("convenio marco");
}
function cmOrderRow(item) {
  const f=cmOrderFields(item);
  return {
    code:f.code,
    name:f.name,
    description:f.description,
    status_code:f.statusCode,
    status:f.status,
    type_code:f.typeCode,
    type:f.type,
    currency:f.currency,
    net_total:f.netTotal,
    total:f.total,
    discounts:f.discounts,
    charges:f.charges,
    taxes:f.taxes,
    created_at_mp:f.createdAt,
    sent_at:f.sentAt,
    accepted_at:f.acceptedAt,
    cancelled_at:f.cancelledAt,
    modified_at_mp:f.modifiedAt,
    buyer_code:f.buyerCode,
    buyer_name:f.buyerName,
    buyer_unit:f.buyerUnit,
    buyer_rut:f.buyerRut,
    buyer_region:f.buyerRegion,
    buyer_commune:f.buyerCommune,
    buyer_address:f.buyerAddress,
    buyer_contact:f.buyerContact,
    buyer_email:f.buyerEmail,
    supplier_code:f.supplierCode,
    supplier_name:f.supplierName,
    supplier_rut:f.supplierRut,
    supplier_region:f.supplierRegion,
    supplier_commune:f.supplierCommune,
    supplier_address:f.supplierAddress,
    supplier_contact:f.supplierContact,
    supplier_email:f.supplierEmail,
    agreement_code:f.agreementCode,
    source_url:"https://www.mercadopublico.cl/",
    raw:item,
    detail_loaded:Boolean(get(item,"Items","Proveedor","Comprador") && (get(item,"Items")||{}).Listado),
    last_seen_at:new Date().toISOString(),
    updated_at:new Date().toISOString()
  };
}
function cmOrderItems(item) {
  const raw=get(item,"Items","items")||{};
  let list=get(raw,"Listado","listado")||[];
  if(!Array.isArray(list)) list=list && typeof list==="object" ? [list] : [];
  const orderAgreement=cmOrderFields(item).agreementCode;
  return list.map((row,index)=>({
    line_no:Number(get(row,"Correlativo","correlativo"))||index+1,
    category_code:String(get(row,"CodigoCategoria","codigoCategoria")||"").trim(),
    category:String(get(row,"Categoria","categoria")||"").trim(),
    product_code:String(get(row,"CodigoProducto","codigoProducto")||"").trim(),
    buyer_spec:String(get(row,"EspecificacionComprador","especificacionComprador")||"").trim(),
    supplier_spec:String(get(row,"EspecificacionProveedor","especificacionProveedor")||"").trim(),
    quantity:money(get(row,"Cantidad","cantidad")),
    unit:String(get(row,"UnidadMedida","unidadMedida","Unidad")||"").trim(),
    currency:String(get(row,"Moneda","moneda")||cmOrderFields(item).currency||"CLP").trim()||"CLP",
    unit_price:money(get(row,"PrecioNeto","precioNeto")),
    charges:money(get(row,"TotalCargos","totalCargos")),
    discounts:money(get(row,"TotalDescuentos","totalDescuentos")),
    taxes:money(get(row,"TotalImpuestos","totalImpuestos")),
    total:money(get(row,"Total","total")),
    agreement_code:agreementCodeFrom(deepText(row))||orderAgreement,
    raw:row,
    updated_at:new Date().toISOString()
  }));
}
function apiDate(date) {
  const d=new Date(date);
  const dd=String(d.getUTCDate()).padStart(2,"0");
  const mm=String(d.getUTCMonth()+1).padStart(2,"0");
  return dd+mm+d.getUTCFullYear();
}
async function upsertCmOrder(admin,item,{detailLoaded=false}={}) {
  const row=cmOrderRow(item);
  if(!row.code) return null;
  row.detail_loaded=detailLoaded || row.detail_loaded;
  const {data,error}=await admin.from("chilecompra_cm_orders")
    .upsert(row,{onConflict:"code"}).select("*").single();
  if(error) throw error;

  const items=cmOrderItems(item).map(x=>({...x,order_code:row.code}));
  if(items.length) {
    const {error:deleteError}=await admin.from("chilecompra_cm_order_items").delete().eq("order_code",row.code);
    if(deleteError) throw deleteError;
    const {error:itemError}=await admin.from("chilecompra_cm_order_items").insert(items);
    if(itemError) throw itemError;
  }
  return data;
}
async function fetchCmDetail(admin,ticket,code) {
  const payload=await mercado("ordenesdecompra.json",ticket,{codigo:code});
  const item=orderListFrom(payload)[0]||null;
  if(!item || !isCmOrder(item)) return null;
  return await upsertCmOrder(admin,item,{detailLoaded:true});
}
async function syncCmOrders(admin,ticket,{days=3,detailLimit=48}={}) {
  const safeDays=Math.max(1,Math.min(31,Number(days)||3));
  const candidates=new Map();
  const errors=[];
  for(let offset=0;offset<safeDays;offset++) {
    const d=new Date();
    d.setUTCDate(d.getUTCDate()-offset);
    try {
      const payload=await mercado("ordenesdecompra.json",ticket,{fecha:apiDate(d)});
      for(const item of orderListFrom(payload)) {
        if(!isCmOrder(item)) continue;
        const code=cmOrderFields(item).code;
        if(code) candidates.set(code,item);
      }
    } catch(error) {
      errors.push({date:apiDate(d),message:error instanceof Error?error.message:String(error)});
    }
  }

  const basicItems=[...candidates.values()];
  for(const item of basicItems) await upsertCmOrder(admin,item,{detailLoaded:false});

  let detailed=0;
  const codes=[...candidates.keys()].slice(0,Math.max(0,Math.min(160,Number(detailLimit)||48)));
  const workers=Math.min(5,codes.length);
  let cursor=0;
  await Promise.all(Array.from({length:workers},async()=>{
    while(cursor<codes.length) {
      const index=cursor++;
      const code=codes[index];
      try {
        const full=await fetchCmDetail(admin,ticket,code);
        if(full) detailed+=1;
      } catch(error) {
        errors.push({code,message:error instanceof Error?error.message:String(error)});
      }
    }
  }));

  return {days:safeDays,found:candidates.size,detailed,errors:errors.slice(0,12),syncedAt:new Date().toISOString()};
}
async function loadCmItems(admin,codes=[]) {
  const all=[];
  for(let i=0;i<codes.length;i+=180) {
    const chunk=codes.slice(i,i+180);
    if(!chunk.length) continue;
    const {data,error}=await admin.from("chilecompra_cm_order_items")
      .select("*").in("order_code",chunk);
    if(error) throw error;
    all.push(...(data||[]));
  }
  return all;
}
function cmText(order,items=[]) {
  return normalize([
    order.code,order.name,order.description,order.buyer_name,order.buyer_unit,
    order.supplier_name,order.supplier_rut,order.agreement_code,
    ...items.flatMap(item=>[item.category,item.product_code,item.buyer_spec,item.supplier_spec,item.agreement_code])
  ].join(" "));
}
function aggregateCmProducts(items,ordersByCode) {
  const map=new Map();
  for(const item of items) {
    const order=ordersByCode.get(item.order_code);
    if(!order) continue;
    const label=String(item.supplier_spec||item.buyer_spec||item.category||item.product_code||"Producto sin nombre").trim();
    const key=String(item.product_code||"")+"|"+normalize(label);
    const row=map.get(key)||{
      key,label,productCode:item.product_code||"",category:item.category||"",
      orders:new Set(),buyers:new Set(),suppliers:new Set(),quantity:0,total:0,
      minPrice:null,maxPrice:null,weightedPrice:0,pricedQty:0,agreementCodes:new Set()
    };
    row.orders.add(item.order_code);
    if(order.buyer_name) row.buyers.add(order.buyer_name);
    if(order.supplier_name) row.suppliers.add(order.supplier_name);
    const qty=Number(item.quantity||0);
    const price=Number(item.unit_price||0);
    row.quantity+=qty;
    row.total+=Number(item.total||0);
    if(price>0) {
      row.minPrice=row.minPrice==null?price:Math.min(row.minPrice,price);
      row.maxPrice=row.maxPrice==null?price:Math.max(row.maxPrice,price);
      row.weightedPrice+=price*(qty>0?qty:1);
      row.pricedQty+=(qty>0?qty:1);
    }
    if(item.agreement_code) row.agreementCodes.add(item.agreement_code);
    map.set(key,row);
  }
  return [...map.values()].map(row=>({
    label:row.label,productCode:row.productCode,category:row.category,
    orders:row.orders.size,buyers:row.buyers.size,suppliers:row.suppliers.size,
    quantity:row.quantity,total:row.total,
    minPrice:row.minPrice,maxPrice:row.maxPrice,
    avgPrice:row.pricedQty?row.weightedPrice/row.pricedQty:null,
    agreementCodes:[...row.agreementCodes]
  })).sort((a,b)=>b.total-a.total || b.orders-a.orders);
}
function aggregateCmEntities(orders,field) {
  const map=new Map();
  for(const order of orders) {
    const name=String(order[field]||"").trim();
    if(!name) continue;
    const row=map.get(name)||{name,orders:0,total:0,agreements:new Set(),last:""};
    row.orders+=1;
    row.total+=Number(order.total||0);
    if(order.agreement_code) row.agreements.add(order.agreement_code);
    row.last=[row.last,order.created_at_mp||order.sent_at||""].sort().at(-1)||"";
    map.set(name,row);
  }
  return [...map.values()].map(row=>({...row,agreements:[...row.agreements]}))
    .sort((a,b)=>b.total-a.total || b.orders-a.orders);
}
function aggregateCmAgreements(orders,items) {
  const map=new Map();
  for(const order of orders) {
    const code=order.agreement_code||"";
    if(!code) continue;
    const row=map.get(code)||{code,orders:0,total:0,buyers:new Set(),suppliers:new Set(),products:new Set()};
    row.orders+=1;
    row.total+=Number(order.total||0);
    if(order.buyer_name) row.buyers.add(order.buyer_name);
    if(order.supplier_name) row.suppliers.add(order.supplier_name);
    map.set(code,row);
  }
  for(const item of items) {
    const code=item.agreement_code||orders.find(o=>o.code===item.order_code)?.agreement_code||"";
    if(!code) continue;
    const row=map.get(code)||{code,orders:0,total:0,buyers:new Set(),suppliers:new Set(),products:new Set()};
    if(item.product_code) row.products.add(item.product_code);
    map.set(code,row);
  }
  return [...map.values()].map(row=>({
    code:row.code,orders:row.orders,total:row.total,
    buyers:row.buyers.size,suppliers:row.suppliers.size,products:row.products.size
  })).sort((a,b)=>b.total-a.total || b.orders-a.orders);
}
async function cmDashboard(admin,ticket,org,body) {
  const days=Math.max(1,Math.min(180,Number(body?.days)||30));
  const query=String(body?.query||"").trim();
  const forceSync=Boolean(body?.forceSync);
  const cutoff=new Date(Date.now()-days*86400000).toISOString();

  const {data:lastRows,error:lastError}=await admin.from("chilecompra_cm_orders")
    .select("code,last_seen_at").order("last_seen_at",{ascending:false}).limit(1);
  if(lastError) throw lastError;
  const lastSync=lastRows?.[0]?.last_seen_at ? new Date(lastRows[0].last_seen_at).getTime() : 0;
  if(forceSync || !lastSync || Date.now()-lastSync>5*3600000) {
    await syncCmOrders(admin,ticket,{days:Math.min(days,forceSync?31:7),detailLimit:forceSync?100:48});
  }

  let orderQuery=admin.from("chilecompra_cm_orders")
    .select("*").gte("created_at_mp",cutoff).order("created_at_mp",{ascending:false}).limit(3000);
  const {data:ordersData,error:ordersError}=await orderQuery;
  if(ordersError) throw ordersError;
  const allOrders=ordersData||[];
  const allItems=await loadCmItems(admin,allOrders.map(x=>x.code));
  const itemsByOrder=new Map();
  for(const item of allItems) {
    if(!itemsByOrder.has(item.order_code)) itemsByOrder.set(item.order_code,[]);
    itemsByOrder.get(item.order_code).push(item);
  }

  const selected=query.length>=2
    ? allOrders.filter(order=>cmText(order,itemsByOrder.get(order.code)||[]).includes(normalize(query)))
    : allOrders;
  const selectedCodes=new Set(selected.map(x=>x.code));
  const items=allItems.filter(x=>selectedCodes.has(x.order_code));
  const byCode=new Map(selected.map(x=>[x.code,x]));

  const {data:states,error:statesError}=await admin.from("chilecompra_cm_states")
    .select("*").eq("organization_id",org).in("order_code",selected.slice(0,1000).map(x=>x.code));
  if(statesError && statesError.code!=="PGRST116") throw statesError;
  const stateByCode=new Map((states||[]).map(x=>[x.order_code,x]));
  const orders=selected.map(order=>({...order,commercial_state:stateByCode.get(order.code)||null}));

  const total=orders.reduce((sum,x)=>sum+Number(x.total||0),0);
  const detailed=orders.filter(x=>x.detail_loaded).length;
  return {
    days,query,
    coverage:{orders:orders.length,detailed,percent:orders.length?Math.round(detailed*100/orders.length):0},
    stats:{
      orders:orders.length,
      total,
      buyers:new Set(orders.map(x=>x.buyer_name).filter(Boolean)).size,
      suppliers:new Set(orders.map(x=>x.supplier_name).filter(Boolean)).size,
      products:new Set(items.map(x=>x.product_code).filter(Boolean)).size
    },
    orders:orders.slice(0,700),
    items:items.slice(0,8000),
    products:aggregateCmProducts(items,byCode).slice(0,250),
    buyers:aggregateCmEntities(orders,"buyer_name").slice(0,120),
    suppliers:aggregateCmEntities(orders,"supplier_name").slice(0,120),
    agreements:aggregateCmAgreements(orders,items).slice(0,80)
  };
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:CORS});
  if(req.method!=="POST") return json({error:"method_not_allowed"},405);

  const url=Deno.env.get("SUPABASE_URL"), key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key) return json({error:"server_config_missing"},500);
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});

  try {
    const cronHeader=req.headers.get("x-radar-cron")||"";
    let org="", cron=false;
    if(cronHeader) cron=cronHeader===await loadSecret(admin,"internal_chilecompra_cron_key");

    if(!cron) {
      const jwt=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
      if(!jwt) return json({error:"unauthorized"},401);
      const {data:auth,error:authError}=await admin.auth.getUser(jwt);
      if(authError||!auth?.user) return json({error:"unauthorized"},401);
      const {data:profile,error:profileError}=await admin.from("profiles")
        .select("organization_id,active").eq("id",auth.user.id).maybeSingle();
      if(profileError||!profile?.active||!profile.organization_id) return json({error:"profile_unavailable"},403);
      org=profile.organization_id;
    }

    const body=await req.json().catch(()=>({}));
    const action=String(body?.action||"sync");
    const ticket=await loadSecret(admin,"internal_chilecompra_ticket");

    if(action==="search") {
      if(cron) return json({error:"search_requires_user"},403);
      const query=String(body?.query||"").trim();
      if(query.length<2) return json({error:"query_too_short",message:"Escribe al menos 2 caracteres."},400);
      return json({ok:true,query,...await searchTraditional(admin,ticket,org,query)});
    }

    if(action==="campaign") {
      if(cron) return json({error:"campaign_requires_user"},403);
      const campaignId=String(body?.campaignId||"").trim();
      if(!campaignId) return json({error:"campaign_required"},400);
      return json({ok:true,...await searchCampaign(admin,ticket,org,campaignId)});
    }

    if(action==="analytics") {
      if(cron) return json({error:"analytics_requires_user"},403);
      return json({ok:true,...await marketAnalytics(admin,ticket,org,body)});
    }

    if(action==="review") {
      if(cron) return json({error:"review_requires_user"},403);
      const opportunityId=String(body?.opportunityId||"").trim();
      if(!opportunityId) return json({error:"opportunity_required"},400);
      const {data:campaigns}=await admin.from("chilecompra_campaigns")
        .select("id").eq("organization_id",org);
      const ids=(campaigns||[]).map(x=>x.id);
      if(ids.length) {
        const {error}=await admin.from("chilecompra_campaign_matches")
          .update({reviewed_at:new Date().toISOString(),updated_at:new Date().toISOString()})
          .eq("opportunity_id",opportunityId).in("campaign_id",ids);
        if(error) throw error;
      }
      return json({ok:true});
    }

    if(action==="detail") {
      if(cron) return json({error:"detail_requires_user"},403);
      const code=String(body?.code||"").trim();
      if(!code) return json({error:"code_required"},400);
      const {data:existing}=await admin.from("chilecompra_opportunities")
        .select("*").eq("organization_id",org).eq("external_code",code).maybeSingle();
      if(!existing) return json({error:"opportunity_not_found"},404);
      const payload=await mercado("licitaciones.json",ticket,{codigo:code});
      const item=listFrom(payload)[0]||payload;
      const full=rowFromItem(item,org);
      const detailComplete=hasDetailedFields(item);
      delete full.organization_id;
      delete full.external_code;
      const {data,error}=await admin.from("chilecompra_opportunities")
        .update({...full,detail_loaded:detailComplete,updated_at:new Date().toISOString()})
        .eq("id",existing.id).select("*").single();
      if(error) throw error;
      return json({opportunity:data,detailComplete});
    }

    if(action==="sync") {
      let orgs=[];
      if(cron) {
        const {data,error}=await admin.from("organizations").select("id");
        if(error) throw error;
        orgs=(data||[]).map(x=>x.id).filter(Boolean);
      } else orgs=[org];
      const results=[];
      for(const orgId of orgs) results.push(await syncOrganization(admin,ticket,orgId));
      return json({ok:true,syncedAt:new Date().toISOString(),results});
    }

    return json({error:"unknown_action"},400);
  } catch(error) {
    console.error("ChileCompra radar error",error);
    const message=error instanceof Error ? error.message : String(error?.message||error);
    return json({error:"radar_error",message},500);
  }
});
