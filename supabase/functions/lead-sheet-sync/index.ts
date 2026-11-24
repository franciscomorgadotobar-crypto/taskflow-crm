// Sincroniza planillas de leads (Google Sheets) con el CRM.
//
// La invoca el cron "lead-sheet-sync" cada 10 minutos con la llave interna guardada
// en Vault (header x-lead-sync-cron). Por cada planilla activa de lead_sheet_sources:
// descarga la hoja como CSV (debe estar compartida para lectura por enlace), mapea
// las filas y las entrega a lead_sheet_import(), que crea solo los leads nuevos.
// Nunca escribe en la planilla.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { mapSheetRows, parseCsv } from "./mapping.js";

const MAX_CSV_CHARS = 5_000_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function sameSecret(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function fetchSheetCsv(spreadsheetId: string, gid: string) {
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/export?format=csv&gid=${
    encodeURIComponent(gid || "0")
  }`;
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Google respondió ${res.status} al leer la planilla`);
  const type = res.headers.get("content-type") || "";
  if (!type.includes("text/csv")) {
    throw new Error("La planilla no está compartida para lectura por enlace");
  }
  const text = await res.text();
  if (text.length > MAX_CSV_CHARS) throw new Error("La planilla supera el tamaño máximo admitido");
  return text;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "server_config_missing" }, 500);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const provided = req.headers.get("x-lead-sync-cron") || "";
  const { data: expected, error: keyError } = await admin.rpc("internal_lead_sheet_cron_key");
  if (keyError || !sameSecret(provided, String(expected || ""))) return json({ error: "unauthorized" }, 401);

  const { data: sources, error: sourcesError } = await admin
    .from("lead_sheet_sources")
    .select("id,name,spreadsheet_id,sheet_gid,lead_source")
    .eq("active", true)
    .order("created_at");
  if (sourcesError) return json({ error: "sources_unavailable" }, 500);

  const results = [];
  for (const source of sources ?? []) {
    try {
      const csv = await fetchSheetCsv(source.spreadsheet_id, source.sheet_gid);
      const { rows, skipped } = mapSheetRows(parseCsv(csv), { sourceLabel: source.lead_source || "Meta Ads" });
      const { data, error } = await admin.rpc("lead_sheet_import", { p_source_id: source.id, p_rows: rows });
      if (error) throw new Error(error.message);
      results.push({ source: source.name, ...data, skipped });
    } catch (err) {
      const message = String((err as Error)?.message || err).slice(0, 500);
      console.error("lead-sheet-sync", source.name, message);
      await admin
        .from("lead_sheet_sources")
        .update({ last_sync_at: new Date().toISOString(), last_sync_status: "error", last_sync_error: message })
        .eq("id", source.id);
      results.push({ source: source.name, error: message });
    }
  }

  return json({ ok: true, results });
});
