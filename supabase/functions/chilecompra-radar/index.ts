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
  if (Array.isArray(payload?.Listado)) return payload.Listado;
  if (Array.isArray(payload?.listado)) return payload.listado;
  if (Array.isArray(payload?.Licitaciones?.Listado)) return payload.Licitaciones.Listado;
  if (Array.isArray(payload?.Listado?.Licitacion)) return payload.Listado.Licitacion;
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
    published_at:f.publishedAt, close_at:f.closeAt, amount:f.amount, currency:f.currency, source_url:MP_SEARCH_URL,
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
  const q=normalize(query), tokens=q.split(/\s+/).filter(x=>x.length>=2), exact=[], partial=[];
  for (const item of listings) {
    const f=listingFields(item);
    if(!f.code||!f.name) continue;
    const hay=normalize(f.code+" "+f.name);
    if(hay.includes(q)) exact.push(item);
    else if(tokens.length && tokens.every(t=>hay.includes(t))) partial.push(item);
  }
  return [...exact,...partial].slice(0,120);
}
function campaignMatch(item, terms=[]) {
  const f=listingFields(item);
  const hay=normalize([f.code,f.name,f.description,f.buyerName,f.procurementType].filter(Boolean).join(" "));
  const matched=[...new Set((terms||[]).filter(term=>termMatches(hay,term)).map(term=>String(term).trim()).filter(Boolean))];
  return { matched, score: matched.length ? Math.min(100, 45 + (matched.length-1)*12) : 0 };
}
async function enrichRows(rows,ticket,limit=8) {
  const out=[...rows];
  for(let i=0;i<Math.min(limit,out.length);i++) {
    try {
      const payload=await mercado("licitaciones.json",ticket,{codigo:out[i].external_code});
      const item=listFrom(payload)[0]||payload;
      out[i]={...out[i],...rowFromItem(item,out[i].organization_id),detail_loaded:true};
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
  ["Tecnología / Software",["software","sistema","plataforma","saas","licencia","digital","tecnologia","informatico","informática","computacional"]],
  ["Salud",["hospital","salud","clinica","clínica","cesfam","medico","médico","farmacia"]],
  ["Telecomunicaciones",["telecom","fibra","antena","radioenlace","lte","5g","conectividad","red de datos"]],
  ["Seguridad / Defensa",["seguridad","ejercito","ejército","armada","carabineros","pdi","defensa","armamento","municion","munición"]],
  ["Educación",["universidad","educacion","educación","colegio","liceo","escuela","junaeb"]],
  ["Construcción / Infraestructura",["construccion","construcción","obra","infraestructura","edificio","reparacion","reparación"]],
  ["Energía / Utilities",["energia","energía","electrico","eléctrico","agua potable","sanitaria","generador","electrogeno","electrógeno"]],
  ["Transporte / Logística",["transporte","logistica","logística","vehiculo","vehículo","camion","camión","metro"]],
  ["Industria / Minería",["mineria","minería","industrial","planta","faena","proceso productivo"]]
];
function industryOf(item) {
  const f=listingFields(item), text=normalize([f.name,f.description,f.buyerName].join(" "));
  for(const [label,terms] of INDUSTRIES) if(terms.some(t=>termMatches(text,t))) return label;
  return "Otros";
}
function orgTypeOf(item) {
  const name=normalize(listingFields(item).buyerName);
  if(/municipal|alcaldia|alcaldía/.test(name)) return "Municipalidades";
  if(/hospital|servicio de salud|salud|fonasa|cenabast/.test(name)) return "Salud";
  if(/universidad|colegio|liceo|escuela|educacion|educación/.test(name)) return "Educación";
  if(/ejercito|ejército|armada|carabineros|pdi|gendarmeria|gendarmería|defensa/.test(name)) return "FF.AA. / Seguridad";
  if(/empresa|metro|enap|efe|correos/.test(name)) return "Empresas públicas";
  if(name) return "Gobierno / servicios públicos";
  return "Otros";
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
  for(const item of listings) {
    const f=listingFields(item);
    const key=groupBy==="orgType" ? orgTypeOf(item)
      : groupBy==="procurementType" ? (f.procurementType||"Otros")
      : industryOf(item);
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
  const categories=[...groups.entries()]
    .map(([label,value])=>({label,value:Number(value||0)}))
    .sort((a,b)=>b.value-a.value);
  if(categories.length>7) {
    const keep=categories.slice(0,6);
    keep.push({label:"Otros",value:categories.slice(6).reduce((s,x)=>s+x.value,0)});
    return keep;
  }
  return categories;
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
  return {
    universe,metric,groupBy,configured,
    sourceCount:listings.length,
    publications:selected.length,
    buyers:buyerSet.size,
    amount:selected.reduce((sum,x)=>sum+Number(listingFields(x).amount||0),0),
    categories:aggregateAnalytics(selected,{metric,groupBy})
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
      delete full.organization_id;
      delete full.external_code;
      const {data,error}=await admin.from("chilecompra_opportunities")
        .update({...full,detail_loaded:true,updated_at:new Date().toISOString()})
        .eq("id",existing.id).select("*").single();
      if(error) throw error;
      return json({opportunity:data});
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
