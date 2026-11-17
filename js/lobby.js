import { supabase } from './supabase.js';
import { session, isAdmin, isReadOnly } from './auth.js';
import { state as crmState } from './store.js';
import { escapeHtml as e, toast } from './utils.js';

const PORTAL = 'https://www.leylobby.gob.cl/solicitud/audiencia';
const MATTERS = [
  { name: 'TaskFlow', text: 'Presentar soluciones tecnológicas para digitalizar y dar trazabilidad a órdenes de trabajo, mantenimientos, inspecciones, actividades de terreno y control operativo municipal. La audiencia tiene por objeto conocer las necesidades del municipio y evaluar la aplicabilidad de estas herramientas en la gestión, supervisión y seguimiento de sus servicios.' },
  { name: 'NEOFF', text: 'Presentar soluciones tecnológicas para el monitoreo, supervisión y control remoto de infraestructura municipal, incluyendo instalaciones, energía, comunicaciones y equipamiento crítico. Se busca exponer sus capacidades y evaluar su aplicabilidad en modernización, continuidad operacional y eficiencia de la gestión municipal.' },
  { name: 'TaskFlow Defender', text: 'Presentar tecnologías de control, asignación y trazabilidad del equipamiento utilizado por los equipos de seguridad municipal. Se abordarán el registro de entregas y devoluciones, la identificación de responsables por turno, inventarios y supervisión, con el fin de evaluar su aplicabilidad en la gestión de recursos municipales de seguridad.' },
  { name: 'TaskFlow + NEOFF', text: 'Exponer soluciones complementarias para la digitalización de órdenes de trabajo y actividades en terreno, junto con monitoreo remoto y supervisión de infraestructura municipal. Conocer necesidades operativas y evaluar posibles aplicaciones de ambas capacidades en la continuidad y gestión de los servicios.' },
  { name: 'TaskFlow + Defender', text: 'Presentar herramientas de gestión de actividades municipales y de trazabilidad del equipamiento de seguridad, incluyendo órdenes de trabajo, control por responsable y turno, entregas, devoluciones e inventario. Evaluar su aplicabilidad a las operaciones municipales y la administración de recursos de seguridad.' },
  { name: 'NEOFF + Defender', text: 'Exponer tecnologías para supervisión remota de infraestructura y control de equipamiento de seguridad municipal, incluyendo continuidad de servicios críticos, inventarios, asignaciones y trazabilidad por turno. Conocer las necesidades municipales y evaluar posibles casos de uso.' },
  { name: 'Conjunto', text: 'Presentar las capacidades de TaskFlow, NEOFF y TaskFlow Defender para digitalización de operaciones municipales, monitoreo de infraestructura y trazabilidad del equipamiento de seguridad. El objetivo es conocer necesidades y evaluar áreas de aplicación de estas tecnologías en la gestión municipal.' },
  { name: 'Por definir', text: '' }
];
const RESPONSES = ['Sin respuesta','Aceptada','Rechazada','Revisar','Reprogramar','Cancelada'];
const ROLES = ['Alcalde/sa','Administrador/a municipal','Director/a de Seguridad Pública','Director/a de Administración y Finanzas','Director/a de Operaciones','Director/a de Informática / TI','Director/a de Obras Municipales','Director/a de Tránsito','Secretario/a Municipal','Concejal/a','Otro'];
const MODES = ['Presencial','Videoconferencia','Telefónica','Otra'];
const TABS = [['requests','Solicitudes'],['directory','Municipalidades'],['agenda','Agenda'],['followups','Seguimientos']];
const listeners = new Set();
export const lobbyState = {
  municipalities: [], requests: [], loaded: false, loading: false, error: '',
  tab: 'requests', query: '', region: '', initiative: '', status: ''
};
export const onLobbyChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const notify = () => listeners.forEach(fn => fn(lobbyState));
const today = () => new Intl.DateTimeFormat('sv-SE', {timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const norm = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const date = (x) => x ? new Date(String(x).slice(0,10)+'T12:00:00').toLocaleDateString('es-CL') : '—';
const dateTime = (x) => x ? new Date(x).toLocaleString('es-CL',{dateStyle:'short',timeStyle:'short'}) : '—';
const htmlValue = (x) => e(String(x ?? ''));
const canWrite = () => !isReadOnly() && ['super','admin','comercial'].includes(session.profile?.role);
const byMunicipality = (id) => lobbyState.municipalities.find(m => m.id === id);
const connectedLead = (id) => id && crmState.leads.find(l => l.id === id);

export function clearLobby() {
  lobbyState.municipalities = [];
  lobbyState.requests = [];
  lobbyState.loaded = false;
  lobbyState.loading = false;
  lobbyState.error = '';
  lobbyState.tab = 'requests';
  lobbyState.query = '';
  lobbyState.region = '';
  lobbyState.initiative = '';
  lobbyState.status = '';
}

export async function hydrateLobby() {
  if (session.status !== 'signed-in') return;
  lobbyState.loading = true;
  lobbyState.error = '';
  notify();
  try {
    const [m, r] = await Promise.all([
      supabase.from('lobby_municipalities').select('*').order('census_rank'),
      supabase.from('lobby_requests').select('*').order('updated_at',{ascending:false}).limit(3000)
    ]);
    if (m.error) throw m.error;
    if (r.error) throw r.error;
    lobbyState.municipalities = m.data || [];
    lobbyState.requests = r.data || [];
    lobbyState.loaded = true;
  } catch (error) {
    lobbyState.error = error.message || 'No fue posible recuperar Ley de Lobby.';
    console.error('Ley de Lobby:', error);
  } finally {
    lobbyState.loading = false;
    notify();
  }
}

function statusOf(r) {
  if (r.done) return 'Realizada';
  if (r.response === 'Cancelada') return 'Cancelada';
  if (r.response === 'Rechazada') return 'Rechazada';
  if (r.response === 'Reprogramar') return 'Reprogramar';
  if (r.meeting_at) return 'Agendada';
  if (r.response === 'Aceptada') return 'Aceptada';
  if (r.response === 'Revisar') return 'Revisar';
  return (r.sent || r.requested_at) ? 'En espera' : 'Por solicitar';
}
const isOverdue = r => !!r.next_action_at && r.next_action_at < today() &&
  !['Cancelada','Rechazada'].includes(statusOf(r));
function stats() {
  const r = lobbyState.requests;
  return {
    sent:r.filter(x=>x.sent || x.requested_at).length,
    pending:r.filter(x=>statusOf(x)==='En espera').length,
    scheduled:r.filter(x=>statusOf(x)==='Agendada').length,
    done:r.filter(x=>x.done).length,
    overdue:r.filter(isOverdue).length,
    contacted:new Set(r.filter(x=>x.sent || x.requested_at).map(x=>x.municipality_id)).size
  };
}
function metric(label,num,sub='') {
  return '<div class="lobby-kpi"><span>'+e(label)+'</span><strong>'+e(String(num))+'</strong>'+(sub?'<small>'+e(sub)+'</small>':'')+'</div>';
}
function tag(label) {
  const type = label==='Realizada'?'ok':label==='Agendada'?'blue':label==='En espera'?'wait':label==='Rechazada'||label==='Cancelada'?'bad':'neutral';
  return '<span class="lobby-tag lobby-tag--'+type+'">'+e(label)+'</span>';
}
function options(items,value,placeholder='Todos') {
  return '<option value="">'+e(placeholder)+'</option>'+items.map(v=>'<option value="'+htmlValue(v)+'"'+(v===value?' selected':'')+'>'+e(v)+'</option>').join('');
}
function regions() {
  return [...new Set(lobbyState.municipalities.map(m=>m.region))].sort((a,b)=>a.localeCompare(b,'es'));
}
function municipalSearch(m) {
  return norm(m.name+' '+m.comuna+' '+m.region).includes(norm(lobbyState.query));
}
function filteredRequests() {
  return lobbyState.requests.filter(r=>{
    const m=byMunicipality(r.municipality_id);
    return (!lobbyState.query || norm([
      m?.name,m?.comuna,m?.region,r.initiative,r.folio,r.authority_name,
      r.authority_role,r.owner_name,r.matter,r.next_action
    ].join(' ')).includes(norm(lobbyState.query))) &&
      (!lobbyState.region || m?.region===lobbyState.region) &&
      (!lobbyState.initiative || r.initiative===lobbyState.initiative) &&
      (!lobbyState.status || statusOf(r)===lobbyState.status);
  });
}
function filterBar(includeStatus=true) {
  return '<div class="lobby-filters">'+
    '<label class="lobby-search">Buscar<input id="lobbySearch" placeholder="Municipalidad, folio, cargo, iniciativa…" value="'+htmlValue(lobbyState.query)+'" /></label>'+
    '<label>Región<select data-lobby-filter="region">'+options(regions(),lobbyState.region,'Todas las regiones')+'</select></label>'+
    '<label>Iniciativa<select data-lobby-filter="initiative">'+options(MATTERS.map(x=>x.name),lobbyState.initiative,'Todas')+'</select></label>'+
    (includeStatus?'<label>Estado<select data-lobby-filter="status">'+options(['Por solicitar','En espera','Aceptada','Agendada','Realizada','Reprogramar','Revisar','Rechazada','Cancelada'],lobbyState.status,'Todos')+'</select></label>':'')+
  '</div>';
}
function actionButtons(r) {
  return '<div class="lobby-row-actions"><button type="button" class="small-btn" data-lobby-action="edit" data-id="'+htmlValue(r.id)+'">Abrir ficha</button>'+
    (isAdmin()?'<button type="button" class="small-btn danger" data-lobby-action="delete" data-id="'+htmlValue(r.id)+'" aria-label="Eliminar solicitud">Eliminar</button>':'')+'</div>';
}
function check(r,key,label) {
  return '<label class="lobby-check" title="'+e(label)+'"><input type="checkbox" data-lobby-toggle="'+key+'" data-id="'+htmlValue(r.id)+'"'+(r[key]?' checked':'')+(canWrite()?'':' disabled')+'/><span>'+e(label)+'</span></label>';
}
function renderRequests() {
  const arr=filteredRequests();
  return filterBar()+'<div class="lobby-table-scroll"><table class="lobby-table"><thead><tr>'+
    '<th>Municipalidad / iniciativa</th><th>Estado</th><th>Solicitud</th><th>Próxima gestión</th><th>Reunión</th><th>Controles</th><th>Acción</th>'+
    '</tr></thead><tbody>'+
    (arr.length?arr.map(r=>{
      const m=byMunicipality(r.municipality_id);
      return '<tr><td><strong>'+e(m?.name||'Municipalidad')+'</strong><small>'+e(m?.region||'')+' · '+e(r.initiative)+'</small>'+
        (r.authority_role?'<small>'+e(r.authority_role)+'</small>':'')+'</td>'+
        '<td>'+tag(statusOf(r))+(isOverdue(r)?'<small class="lobby-overdue">Seguimiento vencido</small>':'')+'</td>'+
        '<td><div class="lobby-stack">'+check(r,'sent','Enviada')+'<small>'+date(r.requested_at)+'</small><small>'+e(r.folio||'Sin folio')+'</small></div></td>'+
        '<td><strong>'+e(r.next_action||'—')+'</strong><small>'+date(r.next_action_at)+'</small></td>'+
        '<td>'+dateTime(r.meeting_at)+'</td>'+
        '<td><div class="lobby-stack">'+check(r,'done','Realizada')+check(r,'minutes_done','Minuta')+'</div></td>'+
        '<td>'+actionButtons(r)+'</td></tr>';
    }).join(''):'<tr><td colspan="7" class="lobby-empty">No hay solicitudes con estos filtros. Crea una desde “Nueva solicitud” o desde una municipalidad.</td></tr>')+
    '</tbody></table></div><p class="lobby-caption">'+arr.length+' solicitud(es) encontradas. Los tres checkboxes se activan con un clic y guardan los cambios.</p>';
}
function renderDirectory() {
  const q=lobbyState.query;
  const grouped=regions().filter(region=>!lobbyState.region || lobbyState.region===region).map(region=>{
    const ms=lobbyState.municipalities.filter(m=>m.region===region).filter(m=>municipalSearch(m));
    return {region,ms};
  }).filter(g=>g.ms.length);
  const totals=new Map();
  for(const r of lobbyState.requests) totals.set(r.municipality_id,(totals.get(r.municipality_id)||0)+1);
  return filterBar(false)+'<div class="lobby-region-groups">'+grouped.map(g=>{
    const count=g.ms.reduce((n,m)=>n+(totals.get(m.id)?1:0),0);
    return '<details class="lobby-region"'+(q?' open':'')+'><summary><strong>'+e(g.region)+'</strong>'+
      '<span>'+g.ms.length+' municipalidades · '+count+' con registros</span></summary>'+
      '<div class="lobby-municipal-grid">'+g.ms.map(m=>{
        const n=totals.get(m.id)||0;
        return '<div class="lobby-municipal-item"><div><strong>'+e(m.name)+'</strong><small>'+
          (n?n+' solicitud(es) registradas':'Sin solicitudes registradas')+'</small></div>'+
          '<button type="button" class="small-btn" data-lobby-action="new" data-municipality="'+htmlValue(m.id)+'"'+(canWrite()?'':' disabled')+'>+ Solicitud</button></div>';
      }).join('')+'</div></details>';
  }).join('')+'</div>'+
  '<p class="lobby-caption">'+lobbyState.municipalities.length+' municipalidades únicas en 16 regiones. Antártica se administra desde Cabo de Hornos; no se duplica.</p>';
}
function renderAgenda() {
  const now=new Date();
  const all=filteredRequests().filter(r=>r.meeting_at && !r.done && new Date(r.meeting_at)>=now)
    .sort((a,b)=>new Date(a.meeting_at)-new Date(b.meeting_at));
  return filterBar()+'<div class="lobby-cards">'+(all.length?all.map(r=>{
    const m=byMunicipality(r.municipality_id);
    return '<article class="lobby-task"><span class="lobby-task-date">'+dateTime(r.meeting_at)+'</span><div><strong>'+e(m?.name||'')+'</strong>'+
      '<p>'+e(r.initiative)+' · '+e(r.meeting_mode||'Modalidad por definir')+'</p>'+
      '<small>'+e(r.authority_role||'Autoridad por definir')+'</small></div><button class="small-btn" data-lobby-action="edit" data-id="'+htmlValue(r.id)+'">Gestionar</button></article>';
  }).join(''):'<div class="lobby-empty">No hay reuniones futuras agendadas con estos filtros.</div>')+'</div>';
}
function renderFollowups() {
  const all=filteredRequests().filter(r=>r.next_action_at && !['Rechazada','Cancelada'].includes(statusOf(r)))
    .sort((a,b)=>a.next_action_at.localeCompare(b.next_action_at));
  return filterBar()+'<div class="lobby-cards">'+(all.length?all.map(r=>{
    const m=byMunicipality(r.municipality_id);
    return '<article class="lobby-task'+(isOverdue(r)?' is-overdue':'')+'"><span class="lobby-task-date">'+date(r.next_action_at)+
      (isOverdue(r)?'<small>Vencida</small>':'')+'</span><div><strong>'+e(m?.name||'')+'</strong>'+
      '<p>'+e(r.next_action||'Revisar solicitud')+'</p><small>'+e(r.initiative)+' · '+e(r.owner_name||'Sin responsable')+
      '</small></div><button class="small-btn" data-lobby-action="edit" data-id="'+htmlValue(r.id)+'">Gestionar</button></article>';
  }).join(''):'<div class="lobby-empty">No existen seguimientos con fecha para estos filtros.</div>')+'</div>';
}
export function renderLobby() {
  const s=stats();
  return '<section class="lobby">'+
    '<div class="lobby-toolbar"><div><strong>Control de audiencias y reuniones</strong><p>Solicitudes, respuestas, agenda y compromisos en un mismo módulo.</p></div>'+
    '<div class="lobby-toolbar-actions"><a class="small-btn" href="'+PORTAL+'" target="_blank" rel="noopener noreferrer">Portal oficial Ley de Lobby ↗</a>'+
    '<button type="button" class="small-btn" data-lobby-action="refresh">Actualizar</button>'+
    '<button type="button" class="small-btn" data-lobby-action="export">Exportar CSV</button>'+
    '<button type="button" class="primary-btn" data-lobby-action="new"'+(canWrite()?'':' disabled')+'>+ Nueva solicitud</button></div></div>'+
    '<div class="lobby-kpis">'+metric('Enviadas',s.sent)+metric('En espera',s.pending)+metric('Agendadas',s.scheduled)+
    metric('Realizadas',s.done)+metric('Seguimientos vencidos',s.overdue)+
    metric('Municipios contactados',s.contacted,'de '+lobbyState.municipalities.length)+'</div>'+
    '<nav class="lobby-tabs" aria-label="Secciones de Ley de Lobby">'+TABS.map(([k,v])=>'<button type="button"'+
      (lobbyState.tab===k?' class="active"':'')+' data-lobby-action="tab" data-tab="'+k+'">'+e(v)+'</button>').join('')+'</nav>'+
    (lobbyState.error?'<p class="lobby-error">Error de sincronización: '+e(lobbyState.error)+'</p>':'')+
    (lobbyState.loading&&!lobbyState.loaded?'<div class="lobby-empty">Cargando directorio y gestiones…</div>':
    !lobbyState.loaded?'<div class="lobby-empty">Aún no se cargaron los datos. Pulsa Actualizar.</div>':
    '<div class="lobby-content">'+
      (lobbyState.tab==='directory'?renderDirectory():
        lobbyState.tab==='agenda'?renderAgenda():
        lobbyState.tab==='followups'?renderFollowups():renderRequests())+
    '</div>')+
    '<dialog id="lobbyFormDialog" class="lobby-dialog"></dialog>'+
  '</section>';
}
function select(name,vals,selected,blankLabel) {
  return '<select name="'+name+'" id="lobby-'+name+'">'+options(vals,selected,blankLabel)+'</select>';
}
function formMarkup(r={},presetId='') {
  const mid=r.municipality_id||presetId||'';
  const role=ROLES.includes(r.authority_role)?r.authority_role:(r.authority_role?'Otro':'');
  const custom=role==='Otro'?r.authority_role:'';
  const linked=crmState.leads.filter(l=>l.id===r.lead_id||l.company).sort((a,b)=>String(a.company).localeCompare(String(b.company),'es'));
  const initiative=r.initiative||'Por definir';
  const matter=r.matter||(MATTERS.find(x=>x.name===initiative)?.text||'');
  const chk=(n,label)=>'<label class="lobby-checkbox"><input type="checkbox" name="'+n+'"'+(r[n]?' checked':'')+'/>'+label+'</label>';
  const input=(n,type='text',val='')=>'<input type="'+type+'" name="'+n+'" id="lobby-'+n+'" value="'+htmlValue(val)+'"/>';
  const row=(label,field,cls='')=>'<label class="'+cls+'"><span>'+label+'</span>'+field+'</label>';
  const meetingLocal=r.meeting_at?new Date(new Date(r.meeting_at).getTime()-new Date(r.meeting_at).getTimezoneOffset()*60000).toISOString().slice(0,16):'';
  return '<form id="lobbyForm" class="lobby-form"><div class="lobby-dialog-head"><div><h2>'+e(r.id?'Editar solicitud':'Nueva solicitud')+'</h2>'+
    '<p>Registra la gestión completa. La presentación oficial se realiza en el portal de Ley de Lobby.</p></div>'+
    '<button type="button" class="ghost-btn" data-lobby-action="close">Cerrar</button></div>'+
    '<input type="hidden" name="id" value="'+htmlValue(r.id||'')+'"/>'+
    '<div class="lobby-form-grid">'+
    row('Municipalidad *', '<select name="municipality_id" required><option value="">Seleccionar municipalidad</option>'+
      lobbyState.municipalities.map(m=>'<option value="'+htmlValue(m.id)+'"'+(m.id===mid?' selected':'')+'>'+e(m.name)+' · '+e(m.region)+'</option>').join('')+'</select>','span-2')+
    row('Iniciativa *',select('initiative',MATTERS.map(x=>x.name),initiative,'Seleccionar iniciativa'))+
    row('Cargo de la autoridad',select('authority_role',ROLES,role,'Seleccionar cargo'))+
    row('Otro cargo',input('authority_role_other','text',custom), 'lobby-custom-role'+(role==='Otro'?'':' is-hidden'))+
    row('Nombre de la autoridad',input('authority_name','text',r.authority_name||''))+
    row('Materia de la audiencia *','<textarea name="matter" rows="4" required>'+e(matter)+'</textarea>','span-2')+
    '<div class="lobby-form-section span-2">1. Solicitud y respuesta</div>'+
    '<div class="lobby-form-checks span-2">'+chk('sent','Solicitud enviada')+'</div>'+
    row('Fecha de solicitud',input('requested_at','date',r.requested_at||''))+
    row('Folio / comprobante',input('folio','text',r.folio||''))+
    row('Respuesta',select('response',RESPONSES,r.response||'Sin respuesta','Seleccionar respuesta'))+
    row('Fecha de respuesta',input('response_at','date',r.response_at||''))+
    '<div class="lobby-form-section span-2">2. Reunión y seguimiento</div>'+
    row('Fecha y hora de reunión',input('meeting_at','datetime-local',meetingLocal))+
    row('Modalidad',select('meeting_mode',MODES,r.meeting_mode||'','Seleccionar modalidad'))+
    '<div class="lobby-form-checks span-2">'+chk('done','Reunión realizada')+chk('minutes_done','Minuta registrada')+'</div>'+
    row('Siguiente acción',input('next_action','text',r.next_action||'') ,'span-2')+
    row('Fecha próxima gestión',input('next_action_at','date',r.next_action_at||''))+
    row('Responsable',input('owner_name','text',r.owner_name||session.profile?.name||''))+
    row('Acuerdos, observaciones y notas','<textarea name="notes" rows="4">'+e(r.notes||'')+'</textarea>','span-2')+
    row('URL comprobante / evidencia',input('evidence_url','url',r.evidence_url||''),'span-2')+
    row('Vincular oportunidad existente','<select name="lead_id"><option value="">Sin vinculación comercial</option>'+
      linked.map(l=>'<option value="'+htmlValue(l.id)+'"'+(l.id===r.lead_id?' selected':'')+'>'+e(l.company)+'</option>').join('')+'</select>','span-2')+
    '</div><div class="lobby-dialog-foot"><a href="'+PORTAL+'" target="_blank" rel="noopener noreferrer">Abrir formulario oficial ↗</a>'+
    '<button type="button" class="ghost-btn" data-lobby-action="close">Cancelar</button>'+
    '<button type="submit" class="primary-btn">Guardar solicitud</button></div></form>';
}
function openEditor(id='',presetId='') {
  if (!canWrite()) return toast('Tu perfil tiene acceso de solo lectura a este módulo.','error');
  const r=lobbyState.requests.find(x=>x.id===id);
  if (id&&!r) return toast('La solicitud ya no está disponible. Actualiza el módulo.','error');
  const dialog=document.getElementById('lobbyFormDialog');
  if(!dialog)return;
  dialog.innerHTML=formMarkup(r,presetId);
  dialog.showModal();
}
async function persistForm(form) {
  if (!canWrite()) throw new Error('No tienes permisos para guardar.');
  const data=new FormData(form);
  const id=String(data.get('id')||'');
  const val=(k)=>String(data.get(k)||'').trim();
  const nullable=(k)=>val(k)||null;
  const role=val('authority_role')==='Otro'?val('authority_role_other'):val('authority_role');
  const url=val('evidence_url');
  if(url&&!/^https?:\/\//i.test(url))throw new Error('La evidencia debe tener una URL https:// o http:// válida.');
  if (!val('municipality_id') || !val('matter')) throw new Error('Selecciona municipalidad e ingresa la materia.');
  const selected=val('initiative')||'Por definir';
  const sent=data.has('sent')||!!val('requested_at');
  const meeting=val('meeting_at');
  const payload={
    municipality_id:val('municipality_id'),initiative:selected,matter:val('matter'),
    authority_role:role,authority_name:val('authority_name'),sent,
    requested_at:nullable('requested_at'),folio:val('folio'),response:val('response')||'Sin respuesta',
    response_at:nullable('response_at'),next_action_at:nullable('next_action_at'),next_action:val('next_action'),
    meeting_at:meeting?new Date(meeting).toISOString():null,
    meeting_mode:val('meeting_mode'),done:data.has('done'),minutes_done:data.has('minutes_done'),
    owner_name:val('owner_name'),notes:val('notes'),evidence_url:url,lead_id:nullable('lead_id'),
    updated_at:new Date().toISOString()
  };
  const result=id
    ? await supabase.from('lobby_requests').update(payload).eq('id',id).select('*').single()
    : await supabase.from('lobby_requests').insert(payload).select('*').single();
  if(result.error)throw result.error;
  if(id) lobbyState.requests=lobbyState.requests.map(x=>x.id===id?result.data:x);
  else lobbyState.requests.unshift(result.data);
  document.getElementById('lobbyFormDialog')?.close();
  notify();
  toast(id?'Solicitud actualizada.':'Solicitud creada.');
}
async function quickToggle(id,key,checked) {
  if(!canWrite())return;
  const patch={ [key]:checked,updated_at:new Date().toISOString() };
  if(key==='sent'&&checked){
    const r=lobbyState.requests.find(x=>x.id===id);
    if(r&&!r.requested_at)patch.requested_at=today();
  }
  const {data,error}=await supabase.from('lobby_requests').update(patch).eq('id',id).select('*').single();
  if(error)throw error;
  lobbyState.requests=lobbyState.requests.map(x=>x.id===id?data:x);
  notify();
}
async function removeRequest(id) {
  if(!isAdmin()||!window.confirm('¿Eliminar definitivamente esta solicitud de Ley de Lobby?'))return;
  const {error}=await supabase.from('lobby_requests').delete().eq('id',id);
  if(error)throw error;
  lobbyState.requests=lobbyState.requests.filter(x=>x.id!==id);
  notify();
  toast('Solicitud eliminada.');
}
function exportCsv() {
  const headers=['Municipalidad','Región','Comuna','Iniciativa','Cargo','Materia','Enviada','Fecha solicitud','Folio',
    'Respuesta','Fecha respuesta','Próxima gestión','Siguiente acción','Estado','Fecha reunión',
    'Modalidad','Realizada','Minuta','Responsable','Notas','Enlace evidencia','Lead CRM'];
  const safe=(v)=>{
    let s=String(v??'');
    if(/^[=+\-@\t\r]/.test(s))s="'"+s;
    return '"'+s.replace(/"/g,'""')+'"';
  };
  const data=lobbyState.requests.map(r=>{
    const m=byMunicipality(r.municipality_id);
    return [m?.name,m?.region,m?.comuna,r.initiative,r.authority_role,r.matter,r.sent?'Sí':'No',
      r.requested_at,r.folio,r.response,r.response_at,r.next_action_at,r.next_action,statusOf(r),
      r.meeting_at,r.meeting_mode,r.done?'Sí':'No',r.minutes_done?'Sí':'No',
      r.owner_name,r.notes,r.evidence_url,connectedLead(r.lead_id)?.company||''];
  });
  const csv='\uFEFF'+[headers,...data].map(row=>row.map(safe).join(';')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download='TaskFlow_Ley_Lobby_'+today()+'.csv';
  a.click();URL.revokeObjectURL(url);
}
function paint() {
  const root=document.getElementById('viewRoot');
  if(!root)return;
  root.innerHTML=renderLobby();
}
export function mountLobbyView() {
  const root=document.getElementById('viewRoot');
  if(!root||root.dataset.lobbyBound==='1')return;
  root.dataset.lobbyBound='1';
  root.addEventListener('click',async ev=>{
    const b=ev.target.closest('[data-lobby-action]');
    if(!b)return;
    ev.preventDefault();
    const action=b.dataset.lobbyAction;
    try {
      if(action==='new')return openEditor('',b.dataset.municipality||'');
      if(action==='edit')return openEditor(b.dataset.id);
      if(action==='close')return document.getElementById('lobbyFormDialog')?.close();
      if(action==='tab'){lobbyState.tab=b.dataset.tab;return paint();}
      if(action==='export')return exportCsv();
      if(action==='refresh')return await hydrateLobby();
      if(action==='delete')return await removeRequest(b.dataset.id);
    }catch(error){console.error(error);toast(error.message||'No se pudo completar la gestión.','error');}
  });
  root.addEventListener('input',ev=>{
    if(ev.target.id!=='lobbySearch')return;
    const caret=ev.target.selectionStart;
    lobbyState.query=ev.target.value;
    paint();
    const input=document.getElementById('lobbySearch');
    if(input){input.focus();input.setSelectionRange(caret,caret);}
  });
  root.addEventListener('change',async ev=>{
    const x=ev.target;
    if(x.dataset.lobbyFilter){
      lobbyState[x.dataset.lobbyFilter]=x.value;paint();return;
    }
    if(x.name==='initiative'&&x.closest('#lobbyForm')){
      x.form.querySelector('[name="matter"]').value=MATTERS.find(t=>t.name===x.value)?.text||'';
      return;
    }
    if(x.name==='authority_role'&&x.closest('#lobbyForm')){
      x.form.querySelector('.lobby-custom-role')?.classList.toggle('is-hidden',x.value!=='Otro');
      return;
    }
    if(x.dataset.lobbyToggle){
      x.disabled=true;
      try{await quickToggle(x.dataset.id,x.dataset.lobbyToggle,x.checked);}
      catch(error){x.checked=!x.checked;toast(error.message||'No se guardó el cambio.','error');}
      finally{if(x.isConnected)x.disabled=!canWrite();}
    }
  });
  root.addEventListener('submit',async ev=>{
    if(ev.target.id!=='lobbyForm')return;
    ev.preventDefault();
    const form=ev.target;
    if(form.dataset.busy==='1')return;
    form.dataset.busy='1';
    const btn=form.querySelector('[type="submit"]');
    if(btn)btn.disabled=true;
    try{await persistForm(form);}
    catch(error){console.error(error);toast(error.message||'No se pudo guardar la solicitud.','error');}
    finally{delete form.dataset.busy;if(btn?.isConnected)btn.disabled=false;}
  });
}
