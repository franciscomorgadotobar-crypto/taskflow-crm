import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-radar-cron",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const API_BASE = "https://api.mercadopublico.cl/servicios/v1/publico";
const MP_SEARCH_URL = "https://www.mercadopublico.cl/BuscarLicitacion";

const CAPABILITIES = [
  // NEOFF = software de conectividad operacional. No presta mantenimiento.
  { solution:"NEOFF", capability:"Telemetría y monitoreo remoto", weight:38, terms:["telemetria","monitoreo remoto","supervision remota","monitoreo en tiempo real","adquisicion de datos","variables operacionales","m2m"] },
  { solution:"NEOFF", capability:"IoT y equipos conectados", weight:34, terms:["iot","internet de las cosas","gateway","dispositivo conectado","equipos conectados","sensores conectados"] },
  { solution:"NEOFF", capability:"Integración de protocolos", weight:36, terms:["scada","modbus","bacnet","mqtt","opc","protocolo industrial","integracion de protocolos","integracion de equipos"] },
  { solution:"NEOFF", capability:"RFID y trazabilidad", weight:38, terms:["rfid","radiofrecuencia","tag rfid","tags rfid","lector rfid","lectores rfid","identificacion por radiofrecuencia","trazabilidad rfid"] },
  { solution:"NEOFF", capability:"Control balístico digital", weight:42, terms:["control balistico","trazabilidad de armamento","control de armamento","control de municion","arsenal digital"] },
  { solution:"NEOFF", capability:"Software de monitoreo e integración", weight:34, terms:["plataforma de monitoreo","software de monitoreo","plataforma de telemetria","software de telemetria","integracion de sensores","integracion iot"] },

  // TaskFlow = software para gestionar la operación, el trabajo y la mantención.
  { solution:"TaskFlow", capability:"Órdenes de trabajo", weight:36, terms:["orden de trabajo","ordenes de trabajo","ot digital","ordenes digitales","gestion de mantenimiento"] },
  { solution:"TaskFlow", capability:"Gestión de mantenimiento", weight:32, terms:["software de mantenimiento","sistema de mantenimiento","gestion de mantenimiento","mantenimiento preventivo","mantenimiento correctivo"] },
  { solution:"TaskFlow", capability:"Técnicos en terreno", weight:30, terms:["tecnicos en terreno","tecnico en terreno","personal en terreno","cuadrillas","visitas tecnicas"] },
  { solution:"TaskFlow", capability:"Checklists y evidencias", weight:28, terms:["checklist","lista de chequeo","inspeccion","evidencia fotografica","firma digital"] },
  { solution:"TaskFlow", capability:"Inventario y repuestos", weight:28, terms:["inventario de repuestos","control de repuestos","bodega tecnica","stock de repuestos","inventario tecnico"] },
  { solution:"TaskFlow", capability:"Laboratorio técnico", weight:32, terms:["laboratorio tecnico","diagnostico de equipos","reparacion de equipos","servicio tecnico con trazabilidad"] },
  { solution:"TaskFlow", capability:"Gestión de activos", weight:30, terms:["gestion de activos","trazabilidad de activos","activos fisicos","historial de activos"] },

  // Contextos donde pueden aplicar uno u otro producto, pero el rubro por sí solo
  // NO debe clasificar una compra como NEOFF, TaskFlow ni ambos.
  { solution:null, capability:"HVAC", weight:5, terms:["hvac","climatizacion","aire acondicionado","chiller","ventilacion"] },
  { solution:null, capability:"Facility", weight:5, terms:["facility","infraestructura critica","operacion de edificios"] },
  { solution:null, capability:"Grupos electrógenos", weight:5, terms:["grupo electrogeno","grupos electrogenos","generador electrico","generadores"] },
  { solution:null, capability:"Telecomunicaciones", weight:5, terms:["telecomunicaciones","fibra optica","torres","nodos","lte","5g","radioenlace","antenas"] },
  { solution:null, capability:"Transporte vertical", weight:5, terms:["ascensor","ascensores","elevador","elevadores","transporte vertical"] },
  { solution:null, capability:"Industria", weight:5, terms:["planta industrial","linea de produccion","proceso industrial"] },
  { solution:null, capability:"Utilities", weight:5, terms:["agua potable","tratamiento de agua","utilities","distribucion electrica"] },
  { solution:null, capability:"Minería y túneles", weight:5, terms:["mineria","tunel","tuneles","faena minera"] },
];

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
function matchesScope(row,scope) {
  const s=new Set(row.matched_solutions||[]);
  if(scope==="NEOFF") return s.has("NEOFF");
  if(scope==="TaskFlow") return s.has("TaskFlow");
  if(scope==="BOTH") return s.has("NEOFF")&&s.has("TaskFlow");
  return false;
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
async function searchCampaign(admin,ticket,org,scope) {
  const listings=await activeListings(ticket);
  let rows=listings.map(item=>rowFromItem(item,org))
    .filter(row=>row.external_code&&row.name&&matchesScope(row,scope))
    .sort((a,b)=>b.fit_score-a.fit_score||String(a.close_at||"9999").localeCompare(String(b.close_at||"9999")))
    .slice(0,160);
  rows=await enrichRows(rows,ticket,10);
  const saved=await upsertRows(admin,rows);
  const order=new Map(rows.map((r,i)=>[r.external_code,i]));
  saved.sort((a,b)=>(order.get(a.external_code)??999)-(order.get(b.external_code)??999));
  return {sourceCount:listings.length,results:saved.slice(0,160)};
}
async function syncOrganization(admin,ticket,org) {
  const listings=await activeListings(ticket);
  let rows=listings.map(item=>rowFromItem(item,org))
    .filter(row=>row.external_code&&row.name&&(row.matched_solutions||[]).length)
    .sort((a,b)=>b.fit_score-a.fit_score).slice(0,600);
  const {data:existing}=await admin.from("chilecompra_opportunities")
    .select("external_code,detail_loaded").eq("organization_id",org);
  const detail=new Map((existing||[]).map(x=>[x.external_code,Boolean(x.detail_loaded)]));
  rows=rows.map(r=>({...r,detail_loaded:detail.get(r.external_code)||false}));
  const high=rows.filter(r=>r.fit_level==="alto"&&!r.detail_loaded);
  const enriched=await enrichRows(high,ticket,8);
  const byCode=new Map(enriched.map(r=>[r.external_code,r]));
  rows=rows.map(r=>byCode.get(r.external_code)||r);
  const saved=await upsertRows(admin,rows);
  return {
    organizationId:org, sourceCount:listings.length, matched:saved.length,
    high:saved.filter(x=>x.fit_level==="alto").length,
    partial:saved.filter(x=>x.fit_level==="parcial").length
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
      const scope=String(body?.scope||"");
      if(!["NEOFF","TaskFlow","BOTH"].includes(scope)) return json({error:"invalid_scope"},400);
      return json({ok:true,scope,...await searchCampaign(admin,ticket,org,scope)});
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
