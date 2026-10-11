import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const TASKFLOW = {
  name:"TaskFlow",
  summary:"SaaS de operación y servicio en terreno: órdenes de trabajo digitales, checklists, fotos, firmas, geolocalización, trazabilidad, inventario, activos, laboratorio y reportes. Útil en mantenimiento, facility, HVAC, telecom, ascensores, grupos electrógenos, servicios técnicos y operaciones distribuidas."
};
const NEOFF = {
  name:"Neoff",
  summary:"Plataforma IoT/telemetría y monitoreo operacional: integración de sensores, gateways y dispositivos, variables en tiempo real, conectividad, edificios inteligentes, telecom sites, ascensores, grupos electrógenos, HVAC, líneas de producción, CCTV/PLC y utilities."
};

function norm(v=""){return String(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();}
const TF = ["orden de trabajo","ot ","mantenimiento","mantencion","servicio tecnico","checklist","inventario","activo","trazabilidad","geolocalizacion","inspeccion","facility","laboratorio","operacion en terreno","gestion de servicio","app tecnico","software de gestion","sistema de gestion"];
const NF = ["telemetria","iot","sensor","monitoreo remoto","monitoreo en tiempo real","gateway","scada","plc","cctv","automatizacion","inmotica","domotica","edificio inteligente","grupo electrogeno","ascensor","hvac","variable operacional","linea de produccion","red lte","conectividad industrial"];

function localOne(o:any){
  const text=norm([o.name,o.description,o.buyer_name,o.procurement_type,JSON.stringify(o.raw||{})].join(" "));
  let tf=0,nf=0;
  TF.forEach(t=>{if(text.includes(norm(t))) tf += t.includes(" ") ? 3:2;});
  NF.forEach(t=>{if(text.includes(norm(t))) nf += t.includes(" ") ? 3:2;});
  let recommendation="No recomendar", score=Math.max(tf,nf);
  if(tf>=4 && nf>=4) recommendation="Ambos";
  else if(tf>=3 && tf>=nf) recommendation="TaskFlow";
  else if(nf>=3) recommendation="Neoff";
  const confidence=Math.min(92, 35 + score*7);
  const why = recommendation==="TaskFlow"
    ? "La necesidad se relaciona con gestión operacional, mantenimiento o trabajo en terreno."
    : recommendation==="Neoff"
      ? "La necesidad se relaciona con monitoreo, sensores, conectividad o telemetría."
      : recommendation==="Ambos"
        ? "Combina gestión operacional con monitoreo o integración de dispositivos."
        : "Con la información pública disponible no aparece un encaje comercial suficientemente claro.";
  return { id:o.id, externalCode:o.external_code, recommendation, confidence, why, risks:[], nextStep: recommendation==="No recomendar" ? "No priorizar salvo que las bases agreguen alcance relevante." : "Revisar alcance, requisitos y condiciones antes de contactar.", source:"local" };
}

function extractText(payload:any){
  if(typeof payload?.output_text==="string") return payload.output_text;
  const parts:any[] = payload?.output || [];
  for(const item of parts){
    for(const c of item?.content || []) if(typeof c?.text==="string") return c.text;
  }
  return "";
}

Deno.serve(async (req:Request)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:{
    "Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"
  }});
  const headers={"Access-Control-Allow-Origin":"*","Content-Type":"application/json"};
  try{
    const body=await req.json();
    const opportunities=Array.isArray(body?.opportunities) ? body.opportunities.slice(0,25) : [];
    if(!opportunities.length) return new Response(JSON.stringify({provider:"local",results:[]}),{headers});

    const apiKey=Deno.env.get("OPENAI_API_KEY");
    if(!apiKey){
      return new Response(JSON.stringify({
        provider:"local",
        configured:false,
        message:"OPENAI_API_KEY no está configurada. Se usó el motor comercial local.",
        results:opportunities.map(localOne)
      }),{headers});
    }

    const compact=opportunities.map((o:any)=>({
      id:o.id, codigo:o.external_code, nombre:o.name, descripcion:o.description, comprador:o.buyer_name,
      tipo:o.procurement_type, monto:o.amount, cierre:o.close_at,
      items:o.items || o.raw?.Items || null
    }));

    const input = `Eres el analista comercial de un CRM chileno que revisa oportunidades de Mercado Público.
Debes decidir el encaje SOLO con estos negocios y SOLO con los datos entregados:

TASKFLOW: ${TASKFLOW.summary}
NEOFF: ${NEOFF.summary}

Reglas:
- Responde exclusivamente JSON válido, sin markdown.
- No inventes requisitos ni asumas haber leído bases o adjuntos.
- Si faltan bases, dilo en riesgos.
- recommendation debe ser: "TaskFlow", "Neoff", "Ambos" o "No recomendar".
- confidence entero 0-100.
- why máximo 220 caracteres.
- risks máximo 3 strings breves.
- nextStep máximo 180 caracteres.
- Devuelve {"results":[...]} y conserva exactamente id y codigo.

Oportunidades:
${JSON.stringify(compact)}`;

    const response=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{"Authorization":`Bearer ${apiKey}`,"Content-Type":"application/json"},
      body:JSON.stringify({model:"gpt-6-luna",input:[{role:"user",content:input}]})
    });
    if(!response.ok){
      const err=await response.text();
      throw new Error(`OpenAI ${response.status}: ${err.slice(0,300)}`);
    }
    const payload=await response.json();
    const raw=extractText(payload).trim().replace(/^\`\`\`json\s*/i,"").replace(/\`\`\`$/,"");
    const parsed=JSON.parse(raw);
    const results=(parsed?.results || []).map((r:any)=>({...r,source:"gpt"}));
    return new Response(JSON.stringify({provider:"gpt-6-luna",configured:true,results}),{headers});
  }catch(err){
    return new Response(JSON.stringify({error:"ai_analysis_failed",message:err?.message || String(err)}),{status:500,headers});
  }
});