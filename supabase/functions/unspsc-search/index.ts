import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SOURCE = "https://raw.githubusercontent.com/RedCiudadana/radar-compras-data/main/data/reference/unspcs--en-espanol.csv";
const OFFICIAL = "https://www.ungm.org/Public/UNSPSC";

type Row = {
  segmentCode:string; segmentName:string;
  familyCode:string; familyName:string;
  classCode:string; className:string;
  code:string; name:string;
};

let cache: Row[] | null = null;
let loadedAt = 0;

function cors(req: Request) {
  const origin = req.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function parseCsvLine(line:string) {
  const out:string[] = [];
  let cur = "", quoted = false;
  for (let i=0;i<line.length;i++) {
    const ch=line[i];
    if (ch === '"') {
      if (quoted && line[i+1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      out.push(cur); cur="";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function norm(value:string) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
}

async function loadCatalog() {
  if (cache && Date.now() - loadedAt < 6*60*60*1000) return cache;
  const res = await fetch(SOURCE, { headers:{ "accept":"text/csv" }});
  if (!res.ok) throw new Error("No se pudo cargar el catálogo UNSPSC");
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  const rows:Row[] = [];
  for (let i=1;i<lines.length;i++) {
    const c = parseCsvLine(lines[i]);
    if (c.length < 8) continue;
    rows.push({
      segmentCode:String(c[0]||"").trim(),
      segmentName:String(c[1]||"").trim(),
      familyCode:String(c[2]||"").trim(),
      familyName:String(c[3]||"").trim(),
      classCode:String(c[4]||"").trim(),
      className:String(c[5]||"").trim(),
      code:String(c[6]||"").trim(),
      name:String(c[7]||"").trim()
    });
  }
  cache = rows;
  loadedAt = Date.now();
  return rows;
}

Deno.serve(async (req:Request) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response("ok",{headers});
  try {
    const body = await req.json().catch(()=>({}));
    const q = String(body?.query || "").trim();
    const segment = String(body?.segment || "").replace(/\D/g,"").slice(0,2);
    const limit = Math.min(250, Math.max(10, Number(body?.limit || 100)));
    const rows = await loadCatalog();

    const segmentsMap = new Map<string,{code:string,name:string,count:number}>();
    rows.forEach(r=>{
      const key=r.segmentCode;
      const cur=segmentsMap.get(key) || {code:key,name:r.segmentName,count:0};
      cur.count++; segmentsMap.set(key,cur);
    });
    const segments=[...segmentsMap.values()].sort((a,b)=>a.code.localeCompare(b.code));

    let filtered = rows;
    if (segment) filtered = filtered.filter(r=>r.segmentCode === segment);

    if (q) {
      const nq = norm(q);
      const digits = q.replace(/\D/g,"");
      filtered = filtered.filter(r => {
        if (digits && (r.code.includes(digits) || r.classCode.includes(digits) || r.familyCode.includes(digits) || r.segmentCode.includes(digits))) return true;
        const hay = norm([r.name,r.className,r.familyName,r.segmentName].join(" "));
        return hay.includes(nq);
      });
    } else if (!segment) {
      filtered = [];
    }

    return new Response(JSON.stringify({
      source:"Referencia UNSPSC en español",
      sourceUrl:SOURCE,
      officialUrl:OFFICIAL,
      totalCatalog: rows.length,
      segments,
      totalMatches: filtered.length,
      results: filtered.slice(0,limit)
    }), { headers:{...headers,"Content-Type":"application/json","Cache-Control":"public, max-age=900"}});
  } catch (err) {
    return new Response(JSON.stringify({error:"unspsc_error",message:err?.message || String(err)}),{
      status:500, headers:{...headers,"Content-Type":"application/json"}
    });
  }
});