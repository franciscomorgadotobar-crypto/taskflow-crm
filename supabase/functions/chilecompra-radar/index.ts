import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-radar-cron",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const API_BASE = "https://api.mercadopublico.cl/servicios/v1/publico";
const MP_SEARCH_URL = "https://www.mercadopublico.cl/BuscarLicitacion";

type Capability = { solution: string; capability: string; terms: string[]; weight: number };

const CAPABILITIES: Capability[] = [
  { solution: "NEOFF", capability: "Telemetría", weight: 30, terms: ["telemetria","monitoreo remoto","supervision remota","adquisicion de datos","variables operacionales","m2m"] },
  { solution: "NEOFF", capability: "IoT", weight: 24, terms: ["iot","internet de las cosas","gateway","sensores","sensor","dispositivo conectado"] },
  { solution: "NEOFF", capability: "SCADA / integración", weight: 22, terms: ["scada","modbus","bacnet","mqtt","opc","protocolo industrial","integracion de protocolos"] },
  { solution: "NEOFF", capability: "RFID", weight: 28, terms: ["rfid","radiofrecuencia","tag rfid","tags rfid","lector rfid","lectores rfid","identificacion por radiofrecuencia"] },
  { solution: "NEOFF", capability: "Control balístico", weight: 34, terms: ["control balistico","trazabilidad de armamento","armamento","municion","arsenal","arsenales"] },
  { solution: "TaskFlow", capability: "Órdenes de trabajo", weight: 27, terms: ["orden de trabajo","ordenes de trabajo","ot digital","ordenes digitales","gestion de mantenimiento"] },
  { solution: "TaskFlow", capability: "Mantenimiento", weight: 23, terms: ["mantenimiento preventivo","mantenimiento correctivo","mantenimiento","servicio tecnico"] },
  { solution: "TaskFlow", capability: "Técnicos en terreno", weight: 20, terms: ["tecnicos en terreno","tecnico en terreno","personal en terreno","cuadrillas","visitas tecnicas"] },
  { solution: "TaskFlow", capability: "Checklists y evidencias", weight: 18, terms: ["checklist","lista de chequeo","inspeccion","evidencia fotografica","firma digital"] },
  { solution: "TaskFlow", capability: "Inventario y repuestos", weight: 18, terms: ["inventario","repuestos","bodega tecnica","stock de repuestos"] },
  { solution: "TaskFlow", capability: "Laboratorio técnico", weight: 22, terms: ["laboratorio tecnico","diagnostico","reparacion de equipos"] },
  { solution: "TaskFlow", capability: "Gestión de activos", weight: 20, terms: ["gestion de activos","trazabilidad de activos","activos fisicos"] },
  { solution: "TaskFlow + NEOFF", capability: "HVAC", weight: 22, terms: ["hvac","climatizacion","aire acondicionado","chiller","ventilacion"] },
  { solution: "TaskFlow + NEOFF", capability: "Facility", weight: 20, terms: ["facility","mantenimiento de infraestructura","infraestructura critica","operacion de edificios"] },
  { solution: "TaskFlow + NEOFF", capability: "Grupos electrógenos", weight: 26, terms: ["grupo electrogeno","grupos electrogenos","generador electrico","generadores"] },
  { solution: "TaskFlow + NEOFF", capability: "Telecomunicaciones", weight: 24, terms: ["telecomunicaciones","fibra optica","torres","nodos","lte","5g","radioenlace","antenas","conectividad"] },
  { solution: "TaskFlow + NEOFF", capability: "Transporte vertical", weight: 24, terms: ["ascensor","ascensores","elevador","elevadores","transporte vertical"] },
  { solution: "NEOFF", capability: "Industria / variables operacionales", weight: 20, terms: ["planta industrial","linea de produccion","temperatura","presion","caudal","nivel","vibracion"] },
  { solution: "NEOFF", capability: "Utilities", weight: 20, terms: ["agua potable","tratamiento de agua","energia","utilities","medicion remota"] },
  { solution: "TaskFlow + NEOFF", capability: "Minería y túneles", weight: 22, terms: ["mineria","tunel","tuneles","faena minera"] },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function termMatches(normalizedText: string, term: string) {
  const needle = normalize(term);
  if (!needle) return false;
  if (/^[a-z0-9]{1,4}$/.test(needle)) {
    const escaped = needle.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\function deepText(value: unknown, depth = 0): string {");
    return new RegExp("(^|[^a-z0-9])" + escaped + "([^a-z0-9]|$)", "i").test(normalizedText);
  }
  return normalizedText.includes(needle);
}

function deepText(value: unknown, depth = 0): string {
  if (depth > 7 || value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map((v) => deepText(v, depth + 1)).join(" ");
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).map((v) => deepText(v, depth + 1)).join(" ");
  return "";
}

function get(obj: any, ...keys: string[]) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

function listFrom(payload: any): any[] {
  if (Array.isArray(payload && payload.Listado)) return payload.Listado;
  if (Array.isArray(payload && payload.listado)) return payload.listado;
  if (Array.isArray(payload && payload.Licitaciones && payload.Licitaciones.Listado)) return payload.Licitaciones.Listado;
  if (Array.isArray(payload && payload.Listado && payload.Listado.Licitacion)) return payload.Listado.Licitacion;
  return [];
}

function isoDate(value: unknown): string | null {
  if (!value) return null;
  const raw = String(value);
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  const m = raw.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const dd = m[1], mm = m[2], yyyy = m[3], hh = m[4] || "00", mi = m[5] || "00", ss = m[6] || "00";
  const local = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss));
  return Number.isNaN(local.getTime()) ? null : local.toISOString();
}

function money(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function scoreText(textRaw: string, campaigns: any[]) {
  const text = normalize(textRaw);
  let score = 0;
  const capabilities = new Set<string>();
  const solutions = new Set<string>();
  const reasons: string[] = [];
  const campaignMatches: { campaign: any; score: number; terms: string[] }[] = [];

  for (const cap of CAPABILITIES) {
    const matched = cap.terms.filter((term) => termMatches(text, term));
    if (!matched.length) continue;
    score += cap.weight + Math.min(10, (matched.length - 1) * 3);
    capabilities.add(cap.capability);
    cap.solution.split(" + ").forEach((s) => solutions.add(s));
    reasons.push(cap.capability + ": " + matched.slice(0, 3).join(", "));
  }

  for (const campaign of campaigns || []) {
    if (!campaign.active) continue;
    const matched = (campaign.query_terms || []).filter((term: string) => termMatches(text, term));
    if (!matched.length) continue;
    const boost = (campaign.priority === "alta" ? 18 : campaign.priority === "media" ? 12 : 8) + Math.min(10, matched.length * 2);
    score += boost;
    (campaign.product_scope || []).forEach((s: string) => solutions.add(s));
    campaignMatches.push({ campaign, score: Math.min(100, 45 + matched.length * 10), terms: matched.slice(0, 8) });
  }

  if (capabilities.size >= 2) score += 10;
  if (solutions.size >= 2) score += 8;
  score = Math.min(100, Math.round(score));

  const fitLevel = score >= 75 ? "alto" : score >= 45 ? "parcial" : "bajo";
  return {
    score,
    fitLevel,
    capabilities: [...capabilities].slice(0, 10),
    solutions: [...solutions].slice(0, 4),
    reasons: reasons.slice(0, 8),
    campaignMatches,
  };
}

function listingFields(item: any) {
  const buyer = get(item, "Comprador", "comprador") || {};
  const code = String(get(item, "CodigoExterno", "Codigo", "codigo") || "").trim();
  const name = String(get(item, "Nombre", "nombre") || "").trim();
  const description = String(get(item, "Descripcion", "descripcion") || "").trim();
  const buyerName = String(
    get(buyer, "NombreOrganismo", "NombreUnidad", "RazonSocial", "Nombre") ||
    get(item, "NombreOrganismo", "Organismo") || ""
  ).trim();
  const buyerCode = String(get(buyer, "CodigoOrganismo", "CodigoUnidad", "Codigo") || "").trim();
  const status = String(get(item, "Estado", "estado") || "").trim();
  const closeAt = isoDate(get(item, "FechaCierre", "fechaCierre", "FechaCierreRecepcionOferta"));
  const fechas = get(item, "Fechas") || {};
  const publishedAt = isoDate(get(fechas, "FechaPublicacion") || get(item, "FechaPublicacion", "fechaPublicacion"));
  const amount = money(get(item, "MontoEstimado", "Monto", "Presupuesto"));
  const currency = String(get(item, "Moneda", "moneda") || "CLP").trim() || "CLP";
  const procurementType = String(get(item, "Tipo", "TipoLicitacion", "tipo") || "Licitación pública").trim();
  return { code, name, description, buyerName, buyerCode, status, closeAt, publishedAt, amount, currency, procurementType };
}

async function mercado(path: string, ticket: string, params: Record<string, string> = {}) {
  const url = new URL(API_BASE + "/" + path);
  Object.entries(params).forEach(([key, value]) => { if (value) url.searchParams.set(key, value); });
  url.searchParams.set("ticket", ticket);
  const response = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!response.ok) throw new Error("Mercado Público respondió " + response.status);
  return await response.json();
}

async function loadSecret(admin: any, fn: string) {
  const { data, error } = await admin.rpc(fn);
  if (error || !data) throw new Error("No disponible: " + fn);
  return String(data);
}

async function syncOrganization(admin: any, ticket: string, organizationId: string) {
  const { data: campaigns, error: campaignError } = await admin
    .from("chilecompra_campaigns")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("active", true);
  if (campaignError) throw campaignError;

  const payload = await mercado("licitaciones.json", ticket, { estado: "activas" });
  const listings = listFrom(payload);
  const candidates: any[] = [];

  for (const item of listings) {
    const f = listingFields(item);
    if (!f.code || !f.name) continue;
    const fit = scoreText(f.name + " " + f.description + " " + f.buyerName, campaigns || []);
    if (fit.score < 30) continue;
    candidates.push({
      organization_id: organizationId,
      external_code: f.code,
      name: f.name,
      description: f.description,
      buyer_name: f.buyerName,
      buyer_code: f.buyerCode,
      status: f.status || "Publicada",
      procurement_type: f.procurementType,
      published_at: f.publishedAt,
      close_at: f.closeAt,
      amount: f.amount,
      currency: f.currency,
      source_url: MP_SEARCH_URL,
      fit_score: fit.score,
      fit_level: fit.fitLevel,
      matched_solutions: fit.solutions,
      matched_capabilities: fit.capabilities,
      match_reasons: fit.reasons,
      raw: item,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      _campaignMatches: fit.campaignMatches,
    });
  }

  candidates.sort((a, b) => b.fit_score - a.fit_score);

  // La consulta de activas solo trae código, nombre y fecha. Enriquecemos una sola
  // vez las oportunidades con encaje comercial para obtener comprador, descripción,
  // monto y requisitos sin agotar el ticket de Mercado Público.
  const { data: existingRows } = await admin
    .from("chilecompra_opportunities")
    .select("external_code,detail_loaded,radar_state")
    .eq("organization_id", organizationId);
  const detailByCode = new Map((existingRows || []).map((x: any) => [x.external_code, Boolean(x.detail_loaded)]));
  const detailedCodes = new Set((existingRows || []).filter((x: any) => x.detail_loaded).map((x: any) => x.external_code));
  // Mercado Público es más estable cuando el detalle se consulta de forma
  // secuencial. En cada barrido enriquecemos las mejores oportunidades pendientes;
  // las siguientes se completarán en barridos posteriores o al abrir su ficha.
  const toEnrich = candidates
    .filter((x) => x.fit_score >= 45 && !detailedCodes.has(x.external_code))
    .sort((a, b) => b.fit_score - a.fit_score)
    .slice(0, 30);

  for (const candidate of toEnrich) {
    try {
      const detailPayload = await mercado("licitaciones.json", ticket, { codigo: candidate.external_code });
      const item = listFrom(detailPayload)[0] || detailPayload;
      const f = listingFields(item);
      const fit = scoreText(deepText(item), campaigns || []);
      candidate.name = f.name || candidate.name;
      candidate.description = f.description || candidate.description;
      candidate.buyer_name = f.buyerName || candidate.buyer_name;
      candidate.buyer_code = f.buyerCode || candidate.buyer_code;
      candidate.status = f.status || candidate.status;
      candidate.procurement_type = f.procurementType || candidate.procurement_type;
      candidate.published_at = f.publishedAt || candidate.published_at;
      candidate.close_at = f.closeAt || candidate.close_at;
      candidate.amount = f.amount === null ? candidate.amount : f.amount;
      candidate.currency = f.currency || candidate.currency;
      candidate.fit_score = fit.score || candidate.fit_score;
      candidate.fit_level = fit.score ? fit.fitLevel : candidate.fit_level;
      candidate.matched_solutions = fit.solutions.length ? fit.solutions : candidate.matched_solutions;
      candidate.matched_capabilities = fit.capabilities.length ? fit.capabilities : candidate.matched_capabilities;
      candidate.match_reasons = fit.reasons.length ? fit.reasons : candidate.match_reasons;
      candidate._campaignMatches = fit.campaignMatches.length ? fit.campaignMatches : candidate._campaignMatches;
      candidate.raw = item;
      candidate.detail_loaded = true;
    } catch (detailError) {
      console.warn("No se pudo enriquecer " + candidate.external_code);
    }
  }

  candidates.sort((a, b) => b.fit_score - a.fit_score);
  const limited = candidates.slice(0, 600);
  const currentCodes = new Set(limited.map((row) => row.external_code));

  // El radar "Para ti" debe reflejar el análisis actual. Las oportunidades que
  // dejaron de encajar se bajan a nivel bajo, sin tocar las guardadas ni las ya
  // convertidas al CRM.
  const staleCodes = (existingRows || [])
    .filter((row: any) => row.radar_state === "nuevo" && !currentCodes.has(row.external_code))
    .map((row: any) => row.external_code);

  for (let i = 0; i < staleCodes.length; i += 100) {
    const batch = staleCodes.slice(i, i + 100);
    if (!batch.length) continue;
    const { error } = await admin
      .from("chilecompra_opportunities")
      .update({ fit_score: 0, fit_level: "bajo", updated_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .in("external_code", batch)
      .eq("radar_state", "nuevo");
    if (error) throw error;
  }

  const rows = limited.map((row) => {
    const clean = { ...row };
    delete clean._campaignMatches;
    clean.detail_loaded = Boolean(clean.detail_loaded ?? detailByCode.get(clean.external_code) ?? false);
    return clean;
  });

  let saved: any[] = [];
  if (rows.length) {
    const { data, error } = await admin
      .from("chilecompra_opportunities")
      .upsert(rows, { onConflict: "organization_id,external_code" })
      .select("id,external_code");
    if (error) throw error;
    saved = data || [];
  }

  const idByCode = new Map(saved.map((row) => [row.external_code, row.id]));
  const matchRows: any[] = [];
  for (const candidate of limited) {
    const opportunityId = idByCode.get(candidate.external_code);
    if (!opportunityId) continue;
    for (const match of candidate._campaignMatches) {
      matchRows.push({
        campaign_id: match.campaign.id,
        opportunity_id: opportunityId,
        score: match.score,
        matched_terms: match.terms,
        updated_at: new Date().toISOString(),
      });
    }
  }
  if (matchRows.length) {
    const { error } = await admin
      .from("chilecompra_campaign_matches")
      .upsert(matchRows, { onConflict: "campaign_id,opportunity_id" });
    if (error) throw error;
  }

  const high = limited.filter((x) => x.fit_level === "alto").length;
  const partial = limited.filter((x) => x.fit_level === "parcial").length;
  return { organizationId, sourceCount: listings.length, matched: limited.length, high, partial };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "server_config_missing" }, 500);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const cronHeader = req.headers.get("x-radar-cron") || "";
    let userOrg = "";
    let cronAuthorized = false;

    if (cronHeader) {
      const expected = await loadSecret(admin, "internal_chilecompra_cron_key");
      cronAuthorized = cronHeader === expected;
    }

    if (!cronAuthorized) {
      const authHeader = req.headers.get("authorization") || "";
      const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!jwt) return json({ error: "unauthorized" }, 401);
      const { data: authData, error: authError } = await admin.auth.getUser(jwt);
      if (authError || !authData || !authData.user) return json({ error: "unauthorized" }, 401);
      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .select("organization_id,active,role")
        .eq("id", authData.user.id)
        .maybeSingle();
      if (profileError || !profile || !profile.active || !profile.organization_id) return json({ error: "profile_unavailable" }, 403);
      userOrg = profile.organization_id;
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body && body.action || "sync");
    const ticket = await loadSecret(admin, "internal_chilecompra_ticket");

    if (action === "detail") {
      if (cronAuthorized) return json({ error: "detail_requires_user" }, 403);
      const code = String(body && body.code || "").trim();
      if (!code) return json({ error: "code_required" }, 400);

      const { data: existing, error: existingError } = await admin
        .from("chilecompra_opportunities")
        .select("*")
        .eq("organization_id", userOrg)
        .eq("external_code", code)
        .maybeSingle();
      if (existingError || !existing) return json({ error: "opportunity_not_found" }, 404);

      const { data: campaigns } = await admin
        .from("chilecompra_campaigns")
        .select("*")
        .eq("organization_id", userOrg)
        .eq("active", true);

      const detailPayload = await mercado("licitaciones.json", ticket, { codigo: code });
      const item = listFrom(detailPayload)[0] || detailPayload;
      const f = listingFields(item);
      const fit = scoreText(deepText(item), campaigns || []);

      const patch = {
        name: f.name || existing.name,
        description: f.description || existing.description,
        buyer_name: f.buyerName || existing.buyer_name,
        buyer_code: f.buyerCode || existing.buyer_code,
        status: f.status || existing.status,
        procurement_type: f.procurementType || existing.procurement_type,
        published_at: f.publishedAt || existing.published_at,
        close_at: f.closeAt || existing.close_at,
        amount: f.amount === null ? existing.amount : f.amount,
        currency: f.currency || existing.currency,
        fit_score: fit.score || existing.fit_score,
        fit_level: fit.score ? fit.fitLevel : existing.fit_level,
        matched_solutions: fit.solutions.length ? fit.solutions : existing.matched_solutions,
        matched_capabilities: fit.capabilities.length ? fit.capabilities : existing.matched_capabilities,
        match_reasons: fit.reasons.length ? fit.reasons : existing.match_reasons,
        raw: item,
        detail_loaded: true,
        updated_at: new Date().toISOString(),
      };

      const { data: updated, error: updateError } = await admin
        .from("chilecompra_opportunities")
        .update(patch)
        .eq("id", existing.id)
        .select("*")
        .single();
      if (updateError) throw updateError;
      return json({ opportunity: updated });
    }

    if (action === "sync") {
      let orgs: string[] = [];
      if (cronAuthorized) {
        const { data, error } = await admin
          .from("chilecompra_campaigns")
          .select("organization_id")
          .eq("active", true);
        if (error) throw error;
        orgs = [...new Set((data || []).map((x: any) => x.organization_id).filter(Boolean))];
      } else {
        orgs = [userOrg];
      }

      const results = [];
      for (const orgId of orgs) results.push(await syncOrganization(admin, ticket, orgId));
      return json({ ok: true, syncedAt: new Date().toISOString(), results });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (error) {
    console.error("ChileCompra radar error", error);
    const message = error instanceof Error
      ? error.message
      : (error && typeof error === "object" && "message" in error ? String((error as any).message) : String(error));
    return json({ error: "radar_error", message }, 500);
  }
});
