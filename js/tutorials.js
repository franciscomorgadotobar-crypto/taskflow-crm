import { supabase } from './supabase.js';
import { session } from './auth.js';
import { escapeHtml as e, toast } from './utils.js';

export const TUTORIALS = {
  primeros_pasos: {
    id: 'primeros_pasos',
    name: 'Primeros pasos',
    description: 'Conoce el resumen, tus pendientes y dónde volver a encontrar la ayuda.',
    version: 1,
    duration: 3,
    roles: ['super','admin','comercial','visita'],
    view: 'dashboard',
    steps: [
      {
        selector: '.v2-pipeline-hero',
        title: 'Tu resumen comercial',
        text: 'Aquí ves el valor del pipeline, las oportunidades abiertas y cómo se distribuyen por etapa.'
      },
      {
        selector: '.v2-kpi-overdue',
        title: 'Lo urgente se ve de inmediato',
        text: 'Tareas vencidas y pendientes de hoy son accesos directos. Tócalos para ir a lo que requiere gestión.'
      },
      {
        selector: '.commercial-center-card, .v2-priorities-card',
        title: 'Centro de gestión',
        text: 'Vencidos, hoy, próximos, sin próxima acción y estancados concentran el trabajo que requiere seguimiento.'
      },
      {
        selector: '.v2-chilecompra-card',
        title: 'ChileCompra también vive en el resumen',
        text: 'Aquí ves tus campañas activas, coincidencias nuevas y una lectura rápida del mercado observado.'
      }
    ]
  },
  gestionar_leads: {
    id: 'gestionar_leads',
    name: 'Gestionar leads',
    description: 'Crea, filtra y califica empresas antes de llevarlas al pipeline.',
    version: 1,
    duration: 4,
    roles: ['super','admin','comercial','visita'],
    view: 'leads',
    steps: [
      {
        selector: '.lead-list-card',
        title: 'Aquí viven los leads por calificar',
        text: 'Esta vista reúne empresas que todavía no entran al pipeline. Primero se revisan y califican.'
      },
      {
        selector: '.lead-list-card [data-action="new-lead"]',
        title: 'Agrega una empresa',
        text: 'Nuevo lead abre el formulario para registrar empresa, contacto, origen, responsable y próximos pasos.'
      },
      {
        selector: '.lead-toolbar',
        title: 'Filtra antes de gestionar',
        text: 'Busca por empresa o contacto, filtra por responsable y ordena según valor, próxima acción o actualización.'
      },
      {
        selector: '.lead-list-card .data-table, .lead-list-card',
        title: 'Califica o registra actividad',
        text: 'Al calificar, el lead pasa a Contactado y entra al Pipeline. También puedes levantar información o registrar actividad antes de moverlo.'
      }
    ]
  },
  hiper_foco: {
    id: 'hiper_foco',
    name: 'Híper Foco',
    description: 'Aprende a trabajar una base grande sin llenar el CRM de registros fríos.',
    version: 1,
    duration: 5,
    roles: ['super','admin','comercial'],
    view: 'hyperfocus',
    steps: [
      {
        selector: '.hf-view-head',
        title: 'Campañas de prospección',
        text: 'Híper Foco trabaja campañas separadas del CRM. Puedes importar una base o crear una campaña desde oportunidades existentes.'
      },
      {
        selector: '.hf-campaign-grid, .hf-principle',
        title: 'Cada campaña tiene su avance',
        text: 'Ves cuántos registros quedan por gestionar, cuántos pasaron a prospectos, remarketing o fueron descartados.'
      },
      {
        selector: '.hf-campaign-card, .hf-principle',
        title: 'Gestiona una empresa a la vez',
        text: 'Al iniciar Híper Foco, el CRM reserva un registro y te guía por contacto, resultado comercial y próximo paso.'
      },
      {
        selector: '.hf-principle',
        title: 'Solo lo útil pasa al CRM',
        text: 'Una base importada no llena Leads automáticamente. Solo lo calificado entra a Leads, Pipeline o Remarketing.'
      }
    ]
  },
  gestionar_pipeline: {
    id: 'gestionar_pipeline',
    name: 'Gestionar el pipeline',
    description: 'Aprende a leer el embudo, abrir oportunidades y registrar el siguiente paso.',
    version: 1,
    duration: 4,
    roles: ['super','admin','comercial','visita'],
    view: 'pipeline',
    steps: [
      {
        selector: '[data-action="pipeline-view-kanban"], .kanban',
        title: 'Dos formas de mirar el pipeline',
        text: 'Puedes trabajar con embudo visual o lista. En móvil, la vista embudo mantiene cada etapa separada.'
      },
      {
        selector: '.kanban',
        title: 'Oportunidades por etapa',
        text: 'Cada columna representa una etapa comercial. El número y el monto muestran dónde se concentra tu pipeline.'
      },
      {
        selector: '.deal-card, .kanban-col',
        title: 'Abre una oportunidad',
        text: 'Toca una tarjeta para revisar la ficha, contactos, levantamiento, cotizaciones e historial.'
      },
      {
        selector: '.deal-card [data-action="new-activity"], .kanban',
        title: 'Siempre deja un siguiente paso',
        text: 'Registra llamada, correo, reunión o actividad y agenda la próxima acción para que no se pierda el seguimiento.'
      }
    ]
  },
  chilecompra: {
    id: 'chilecompra',
    name: 'Primeros pasos en ChileCompra',
    description: 'Busca una licitación, crea seguimientos y convierte oportunidades al CRM.',
    version: 3,
    duration: 4,
    roles: ['super','admin','comercial','visita'],
    view: 'chilecompra',
    steps: [
      {
        selector: '.cc-dashboard-nav',
        title: 'Cuatro acciones principales',
        text: 'Resumen muestra el estado del radar, Coincidencias reúne lo encontrado, Seguimientos controla búsquedas automáticas y Buscar sirve para consultas puntuales.'
      },
      {
        selector: '[data-cc-tab="buscar"]',
        title: 'Busca sin configurar nada',
        text: 'Puedes consultar directamente Mercado Público por producto, servicio, necesidad o código.',
        action: 'click'
      },
      {
        selector: '.cc-search-hero',
        title: 'Prueba una búsqueda',
        text: 'Escribe lo que vendes o usa una sugerencia. Si la búsqueda te interesa para el futuro, conviértela en seguimiento.'
      },
      {
        selector: '.cc-more-menu',
        title: 'Herramientas avanzadas',
        text: 'Mercado, Compradores, Guardadas y En CRM quedan agrupados en Más para no sobrecargar la navegación principal.'
      }
    ]
  },
  gestionar_plantillas: {
    id: 'gestionar_plantillas',
    name: 'Gestionar plantillas',
    description: 'Crea mensajes reutilizables, inserta variables y comprueba el resultado con datos reales.',
    version: 1,
    duration: 4,
    roles: ['super','admin'],
    view: 'templates',
    steps: [
      {
        selector: '.template-card-head',
        title: 'Tu biblioteca de mensajes',
        text: 'Aquí administras los mensajes que el equipo puede usar desde la ficha de cada empresa.'
      },
      {
        selector: '[data-action="new-template"]',
        title: 'Crea una plantilla con intención',
        text: 'El formulario te permite poner nombre, canal y una base antes de crearla. Si cancelas, no queda un registro vacío.'
      },
      {
        selector: '.template-toolbar',
        title: 'Filtra por canal',
        text: 'Usa el filtro para revisar mensajes de WhatsApp, correo o ambos canales.'
      },
      {
        selector: '.template-item, .template-list',
        title: 'Edita el contenido',
        text: 'Abre una plantilla para cambiar nombre, canal, asunto y mensaje. También puedes insertar variables sin escribirlas a mano.'
      },
      {
        selector: '.template-preview',
        title: 'Comprueba el mensaje',
        text: 'Elige una empresa dentro de la plantilla para reemplazar las variables y ver cómo quedaría el texto antes de usarlo.'
      }
    ]
  },
  gestionar_equipo: {
    id: 'gestionar_equipo',
    name: 'Configuración y equipo',
    description: 'Administra usuarios, perfiles base, módulos habilitados y capacitaciones.',
    version: 3,
    duration: 4,
    roles: ['super','admin'],
    view: 'settings',
    steps: [
      {
        selector: '.settings-admin-intro',
        title: 'Configuración es administración',
        text: 'Esta pantalla concentra la administración del CRM. Tus datos personales siguen separados en Mi cuenta.'
      },
      {
        selector: '[data-action="team-add"]',
        title: 'Agrega un usuario',
        text: 'Define sus datos, el perfil base y exactamente qué módulos tendrá habilitados desde el primer ingreso.'
      },
      {
        selector: '.team-module-panel, .team-member-card',
        title: 'Ajusta módulos por persona',
        text: 'Cada usuario puede tener un conjunto distinto de módulos. El perfil base define el nivel de permiso y los módulos definen dónde puede entrar.'
      },
      {
        selector: '.team-training-panel, .team-member-card',
        title: 'Capacitación y acceso',
        text: 'También puedes asignar tutoriales, reenviar el acceso, dar de baja o reactivar sin borrar el historial.'
      }
    ]
  }
};

const tutorialState = {
  catalog: [],
  assignments: {},
  progress: {},
  teamAssignments: {},
  teamProgress: {},
  loaded: false,
  active: null,
  offer: null,
  target: null
};

const listeners = new Set();
let mutationObserver = null;
let actionElement = null;
let actionHandler = null;
let runtimeInitialized = false;
let overlayFrame = 0;

const keyFor = (id, version) => `${id}:${version}`;
const emit = () => listeners.forEach((fn) => fn(tutorialState));

export function onTutorialChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function profileRole() {
  return session.profile?.role || '';
}

function tutorialMeta(id) {
  const local = TUTORIALS[id];
  if (!local) return null;
  const remote = tutorialState.catalog.find((x) => x.id === id);
  if (!remote) return local;
  return {
    ...local,
    name: remote.name || local.name,
    description: remote.description || local.description,
    version: remote.version || local.version,
    duration: remote.duration_min || local.duration,
    roles: remote.roles || local.roles,
    active: remote.active !== false
  };
}

export function availableTutorialsForRole(role = profileRole()) {
  return Object.keys(TUTORIALS)
    .map(tutorialMeta)
    .filter((t) => t && t.active !== false && t.roles.includes(role))
    .sort((a,b) => {
      const ar = tutorialState.catalog.find((x) => x.id === a.id)?.sort_order ?? 999;
      const br = tutorialState.catalog.find((x) => x.id === b.id)?.sort_order ?? 999;
      return ar - br || a.name.localeCompare(b.name, 'es');
    });
}

export function availableTutorials() {
  return availableTutorialsForRole(profileRole());
}

const teamKeyFor = (profileId, id, version) => `${profileId}:${id}:${version}`;

export function teamTutorialStatus(profileId, tutorial) {
  const k = teamKeyFor(profileId, tutorial.id, tutorial.version);
  return {
    assigned: Boolean(tutorialState.teamAssignments[k]),
    assignment: tutorialState.teamAssignments[k] || null,
    progress: tutorialState.teamProgress[k] || null
  };
}

export function tutorialStatus(tutorial) {
  const k = keyFor(tutorial.id, tutorial.version);
  return {
    assigned: Boolean(tutorialState.assignments[k]),
    progress: tutorialState.progress[k] || null
  };
}

async function refreshTeamTutorialState() {
  if (profileRole() !== 'super') return;
  const [assignments, progress] = await Promise.all([
    supabase.from('tutorial_assignments').select('*'),
    supabase.from('tutorial_progress').select('*')
  ]);
  if (assignments.error) throw assignments.error;
  if (progress.error) throw progress.error;
  tutorialState.teamAssignments = Object.fromEntries((assignments.data || []).map((x) => [teamKeyFor(x.profile_id, x.tutorial_id, x.version), x]));
  tutorialState.teamProgress = Object.fromEntries((progress.data || []).map((x) => [teamKeyFor(x.profile_id, x.tutorial_id, x.version), x]));
  emit();
}

export async function setTeamTutorialAssignment(profileId, tutorialId, version, assigned, { autoStart = true } = {}) {
  if (profileRole() !== 'super') throw new Error('Solo el súper administrador puede asignar capacitaciones.');
  const k = teamKeyFor(profileId, tutorialId, version);
  if (assigned) {
    const row = {
      profile_id: profileId,
      tutorial_id: tutorialId,
      version,
      auto_start: Boolean(autoStart),
      assigned_by: session.user?.id || null,
      assigned_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from('tutorial_assignments').upsert(row, {
      onConflict: 'profile_id,tutorial_id,version'
    }).select('*').single();
    if (error) throw error;
    tutorialState.teamAssignments[k] = data;
  } else {
    const { error } = await supabase.from('tutorial_assignments')
      .delete()
      .eq('profile_id', profileId)
      .eq('tutorial_id', tutorialId)
      .eq('version', version);
    if (error) throw error;
    delete tutorialState.teamAssignments[k];
  }
  emit();
}

export async function setTeamTutorialAutoStart(profileId, tutorialId, version, autoStart) {
  if (profileRole() !== 'super') throw new Error('Solo el súper administrador puede cambiar esta capacitación.');
  const { error } = await supabase.from('tutorial_assignments')
    .update({ auto_start: Boolean(autoStart) })
    .eq('profile_id', profileId)
    .eq('tutorial_id', tutorialId)
    .eq('version', version);
  if (error) throw error;
  await refreshTeamTutorialState();
}

export async function resetTeamTutorial(profileId, tutorialId, version) {
  if (profileRole() !== 'super') throw new Error('Solo el súper administrador puede reasignar capacitaciones.');
  const now = new Date().toISOString();
  const [assignment, progress] = await Promise.all([
    supabase.from('tutorial_assignments').upsert({
      profile_id: profileId,
      tutorial_id: tutorialId,
      version,
      auto_start: true,
      assigned_by: session.user?.id || null,
      assigned_at: now
    }, { onConflict: 'profile_id,tutorial_id,version' }),
    supabase.from('tutorial_progress').upsert({
      profile_id: profileId,
      tutorial_id: tutorialId,
      version,
      status: 'pending',
      current_step: 0,
      started_at: null,
      completed_at: null,
      updated_at: now
    }, { onConflict: 'profile_id,tutorial_id,version' })
  ]);
  if (assignment.error) throw assignment.error;
  if (progress.error) throw progress.error;
  await refreshTeamTutorialState();
}

export function contextualTutorialForView(view) {
  return availableTutorials().find((tutorial) => tutorial.view === view) || null;
}

export async function startContextTutorial(view) {
  const tutorial = contextualTutorialForView(view);
  if (!tutorial) return false;
  await startTutorial(tutorial.id, { continueProgress: true });
  return true;
}

export async function hydrateTutorials() {
  if (!session.user?.id) return;
  const superUser = profileRole() === 'super';
  const ownAssignments = supabase.from('tutorial_assignments').select('*').eq('profile_id', session.user.id);
  const ownProgress = supabase.from('tutorial_progress').select('*').eq('profile_id', session.user.id);
  const teamAssignments = superUser ? supabase.from('tutorial_assignments').select('*') : Promise.resolve({ data: [], error: null });
  const teamProgress = superUser ? supabase.from('tutorial_progress').select('*') : Promise.resolve({ data: [], error: null });

  const [catalog, assignments, progress, allAssignments, allProgress] = await Promise.all([
    supabase.from('tutorials').select('*').order('sort_order', { ascending: true }),
    ownAssignments,
    ownProgress,
    teamAssignments,
    teamProgress
  ]);
  for (const result of [catalog, assignments, progress, allAssignments, allProgress]) {
    if (result.error) throw result.error;
  }

  tutorialState.catalog = catalog.data || [];
  tutorialState.assignments = Object.fromEntries((assignments.data || []).map((x) => [keyFor(x.tutorial_id, x.version), x]));
  tutorialState.progress = Object.fromEntries((progress.data || []).map((x) => [keyFor(x.tutorial_id, x.version), x]));
  tutorialState.teamAssignments = Object.fromEntries((allAssignments.data || []).map((x) => [teamKeyFor(x.profile_id, x.tutorial_id, x.version), x]));
  tutorialState.teamProgress = Object.fromEntries((allProgress.data || []).map((x) => [teamKeyFor(x.profile_id, x.tutorial_id, x.version), x]));
  tutorialState.loaded = true;
  emit();
}

export function clearTutorials() {
  tutorialState.catalog = [];
  tutorialState.assignments = {};
  tutorialState.progress = {};
  tutorialState.teamAssignments = {};
  tutorialState.teamProgress = {};
  tutorialState.loaded = false;
  tutorialState.active = null;
  tutorialState.offer = null;
  tutorialState.target = null;
  stopWatchingTarget();
  removeOverlay();
  emit();
}

async function saveProgress(tutorial, status, currentStep) {
  if (!session.user?.id) return;
  const k = keyFor(tutorial.id, tutorial.version);
  const previous = tutorialState.progress[k];
  const now = new Date().toISOString();
  const row = {
    profile_id: session.user.id,
    tutorial_id: tutorial.id,
    version: tutorial.version,
    status,
    current_step: currentStep,
    started_at: previous?.started_at || (status === 'pending' ? null : now),
    completed_at: status === 'completed' ? now : null,
    updated_at: now
  };
  tutorialState.progress[k] = row;
  emit();
  const { error } = await supabase.from('tutorial_progress').upsert(row, {
    onConflict: 'profile_id,tutorial_id,version'
  });
  if (error) console.error('No se pudo guardar progreso del tutorial', error);
}

function goView(view) {
  const nav = document.querySelector(`.nav-item[data-view="${view}"]`);
  if (nav) nav.click();
}

export async function startTutorial(id, { continueProgress = true } = {}) {
  const tutorial = tutorialMeta(id);
  if (!tutorial || !session.user?.id) return;
  const progress = tutorialState.progress[keyFor(id, tutorial.version)];
  const savedStep = continueProgress && progress?.status === 'in_progress' ? progress.current_step : 0;
  const step = Math.min(Math.max(Number(savedStep || 0), 0), tutorial.steps.length - 1);

  tutorialState.offer = null;
  tutorialState.active = { id, step };
  tutorialState.target = null;
  emit();
  goView(tutorial.view);
  await saveProgress(tutorial, 'in_progress', step);
  watchCurrentTarget();
}

export function maybeOfferAssignedTutorial() {
  if (!tutorialState.loaded || tutorialState.active || tutorialState.offer || !session.user?.id) return;
  for (const tutorial of availableTutorials()) {
    const k = keyFor(tutorial.id, tutorial.version);
    const assignment = tutorialState.assignments[k];
    const progress = tutorialState.progress[k];
    const postponed = sessionStorage.getItem(`crm-tutorial-postponed:${session.user.id}:${k}`);
    if (assignment?.auto_start && progress?.status !== 'completed' && !postponed) {
      tutorialState.offer = tutorial.id;
      renderOverlay();
      break;
    }
  }
}

function postponeOffer() {
  const id = tutorialState.offer;
  if (!id || !session.user?.id) return;
  const tutorial = tutorialMeta(id);
  sessionStorage.setItem(
    `crm-tutorial-postponed:${session.user.id}:${keyFor(tutorial.id, tutorial.version)}`,
    '1'
  );
  tutorialState.offer = null;
  removeOverlay();
}

async function exitTutorial() {
  if (!tutorialState.active) return;
  const tutorial = tutorialMeta(tutorialState.active.id);
  await saveProgress(tutorial, 'in_progress', tutorialState.active.step);
  tutorialState.active = null;
  tutorialState.target = null;
  stopWatchingTarget();
  removeOverlay();
}

async function completeTutorial() {
  if (!tutorialState.active) return;
  const tutorial = tutorialMeta(tutorialState.active.id);
  await saveProgress(tutorial, 'completed', tutorial.steps.length - 1);
  tutorialState.active = null;
  tutorialState.target = null;
  stopWatchingTarget();
  removeOverlay();
}

async function nextStep() {
  if (!tutorialState.active) return;
  const tutorial = tutorialMeta(tutorialState.active.id);
  const next = tutorialState.active.step + 1;
  if (next >= tutorial.steps.length) return completeTutorial();
  tutorialState.active = { ...tutorialState.active, step: next };
  tutorialState.target = null;
  await saveProgress(tutorial, 'in_progress', next);
  watchCurrentTarget();
}

async function previousStep() {
  if (!tutorialState.active || tutorialState.active.step <= 0) return;
  const tutorial = tutorialMeta(tutorialState.active.id);
  const prev = tutorialState.active.step - 1;
  tutorialState.active = { ...tutorialState.active, step: prev };
  tutorialState.target = null;
  await saveProgress(tutorial, 'in_progress', prev);
  watchCurrentTarget();
}

function removeActionBinding() {
  if (actionElement && actionHandler) actionElement.removeEventListener('click', actionHandler);
  actionElement = null;
  actionHandler = null;
}

function stopWatchingTarget() {
  mutationObserver?.disconnect();
  mutationObserver = null;
  removeActionBinding();
}

function visibleTarget(selector) {
  const candidates = [...document.querySelectorAll(selector)];
  return candidates.find((el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }) || candidates[0] || null;
}

function bindActionStep(step, target) {
  removeActionBinding();
  if (step?.action !== 'click' || !target) return;
  actionElement = target;
  actionHandler = () => setTimeout(() => nextStep(), 80);
  target.addEventListener('click', actionHandler, { once: true });
}

function locateTarget() {
  if (!tutorialState.active) return;
  const tutorial = tutorialMeta(tutorialState.active.id);
  const step = tutorial?.steps[tutorialState.active.step];
  if (!step) return;
  const target = visibleTarget(step.selector);
  if (!target) {
    tutorialState.target = null;
    renderOverlay();
    return;
  }
  if (tutorialState.target !== target) {
    tutorialState.target = target;
    bindActionStep(step, target);
    const rect = target.getBoundingClientRect();
    if (rect.top < 80 || rect.bottom > window.innerHeight - 180) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
  renderOverlay();
}

function watchCurrentTarget() {
  stopWatchingTarget();
  locateTarget();
  mutationObserver = new MutationObserver(() => {
    cancelAnimationFrame(overlayFrame);
    overlayFrame = requestAnimationFrame(locateTarget);
  });
  const observedRoot = document.getElementById('appShell') || document.body;
  mutationObserver.observe(observedRoot, { childList: true, subtree: true, attributes: true });
}

function ensureOverlay() {
  let overlay = document.getElementById('crmTutorialOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'crmTutorialOverlay';
    document.body.appendChild(overlay);
  }
  return overlay;
}

function removeOverlay() {
  document.getElementById('crmTutorialOverlay')?.remove();
}

function offerHtml(tutorial) {
  return `<div class="tutorial-offer-backdrop" role="dialog" aria-modal="true">
    <div class="tutorial-card tutorial-offer-card">
      <span class="tutorial-kicker">Capacitación asignada</span>
      <h2>${e(tutorial.name)}</h2>
      <p>${e(tutorial.description)}</p>
      <small>Duración aproximada: ${tutorial.duration} min</small>
      <div class="tutorial-actions">
        <button type="button" class="ghost-btn" data-tutorial-offer-later>Más tarde</button>
        <button type="button" class="primary-btn" data-tutorial-offer-start>Comenzar</button>
      </div>
    </div>
  </div>`;
}

function renderOverlay() {
  if (tutorialState.offer && !tutorialState.active) {
    const tutorial = tutorialMeta(tutorialState.offer);
    if (!tutorial) return;
    ensureOverlay().innerHTML = offerHtml(tutorial);
    return;
  }
  if (!tutorialState.active) {
    removeOverlay();
    return;
  }

  const tutorial = tutorialMeta(tutorialState.active.id);
  const step = tutorial?.steps[tutorialState.active.step];
  if (!tutorial || !step) return removeOverlay();
  const target = tutorialState.target;
  const overlay = ensureOverlay();

  if (!target) {
    overlay.innerHTML = `<div class="tutorial-wait-backdrop">
      <div class="tutorial-card">
        <span class="tutorial-kicker">${e(tutorial.name)}</span>
        <h2>Preparando el siguiente paso…</h2>
        <p>Estamos buscando el elemento de la interfaz que corresponde a esta parte del tutorial.</p>
        <div class="tutorial-actions"><button class="ghost-btn" type="button" data-tutorial-exit>Salir</button><button class="primary-btn" type="button" data-tutorial-restart>Reiniciar</button></div>
      </div>
    </div>`;
    return;
  }

  const rect = target.getBoundingClientRect();
  const gap = 6;
  const top = Math.max(0, rect.top - gap);
  const left = Math.max(0, rect.left - gap);
  const right = Math.min(window.innerWidth, rect.right + gap);
  const bottom = Math.min(window.innerHeight, rect.bottom + gap);
  const interactive = step.action === 'click';

  overlay.innerHTML = `<div class="tutorial-layer" aria-live="polite">
    <div class="tutorial-shade" style="left:0;top:0;right:0;height:${top}px"></div>
    <div class="tutorial-shade" style="left:0;top:${top}px;width:${left}px;height:${Math.max(0,bottom-top)}px"></div>
    <div class="tutorial-shade" style="left:${right}px;top:${top}px;right:0;height:${Math.max(0,bottom-top)}px"></div>
    <div class="tutorial-shade" style="left:0;top:${bottom}px;right:0;bottom:0"></div>
    <div class="tutorial-focus" style="left:${left}px;top:${top}px;width:${Math.max(0,right-left)}px;height:${Math.max(0,bottom-top)}px"></div>
    <div class="tutorial-card tutorial-step-card">
      <div class="tutorial-step-head"><span class="tutorial-kicker">${e(tutorial.name)}</span><span>${tutorialState.active.step + 1} / ${tutorial.steps.length}</span></div>
      <h2>${e(step.title)}</h2>
      <p>${e(step.text)}</p>
      ${interactive ? '<small class="tutorial-instruction">Toca el elemento resaltado para continuar.</small>' : ''}
      <div class="tutorial-actions">
        <button type="button" class="link-btn" data-tutorial-exit>Salir</button>
        <span class="tutorial-spacer"></span>
        ${tutorialState.active.step > 0 ? '<button type="button" class="ghost-btn" data-tutorial-prev>Anterior</button>' : ''}
        ${interactive ? '' : `<button type="button" class="primary-btn" data-tutorial-next>${tutorialState.active.step === tutorial.steps.length - 1 ? 'Finalizar tutorial' : 'Siguiente'}</button>`}
      </div>
    </div>
  </div>`;
}

export function renderHelp() {
  const tutorials = availableTutorials();
  if (!tutorialState.loaded) return '<div class="card"><div class="card-body"><p class="muted">Cargando ayuda y tutoriales…</p></div></div>';

  return `<section class="help-page">
    <div class="help-intro">
      <div><h2>Ayuda y tutoriales</h2><p>Aprende una tarea sobre la interfaz real y retómala cuando lo necesites.</p></div>
      <span class="help-intro-icon" aria-hidden="true">?</span>
    </div>
    <div class="notice help-notice">Los tutoriales guiados resaltan elementos reales del CRM. Puedes salir en cualquier momento y continuar después desde esta pantalla.</div>
    <div class="help-grid">
      ${tutorials.map((tutorial) => {
        const { assigned, progress } = tutorialStatus(tutorial);
        const completed = progress?.status === 'completed';
        const inProgress = progress?.status === 'in_progress';
        const percent = completed ? 100 : inProgress
          ? Math.round(((Number(progress.current_step || 0) + 1) / tutorial.steps.length) * 100)
          : 0;
        const chip = completed ? '<span class="help-chip success">Completado</span>'
          : assigned ? '<span class="help-chip warning">Asignado</span>'
          : '<span class="help-chip">Disponible</span>';
        return `<article class="help-tutorial-card">
          <div class="help-card-head"><div><small>${tutorial.duration} min</small><h3>${e(tutorial.name)}</h3></div>${chip}</div>
          <p>${e(tutorial.description)}</p>
          ${(inProgress || completed) ? `<div class="help-progress"><div><span>${completed ? 'Terminado' : 'Progreso'}</span><strong>${percent}%</strong></div><div class="help-progress-track"><i style="width:${percent}%"></i></div></div>` : ''}
          <button type="button" class="primary-btn" data-tutorial-start="${tutorial.id}" data-tutorial-continue="${inProgress ? 'true' : 'false'}">${completed ? 'Repetir tutorial' : inProgress ? 'Continuar' : 'Comenzar'}</button>
        </article>`;
      }).join('')}
    </div>
    ${tutorials.length ? '' : '<div class="empty"><strong>Sin tutoriales disponibles</strong><p>No hay capacitaciones habilitadas para tu permiso actual.</p></div>'}
  </section>`;
}

export function initTutorialRuntime() {
  if (runtimeInitialized) return;
  runtimeInitialized = true;

  document.addEventListener('click', (ev) => {
    const start = ev.target.closest('[data-tutorial-start]');
    if (start) {
      startTutorial(start.dataset.tutorialStart, {
        continueProgress: start.dataset.tutorialContinue === 'true'
      });
      return;
    }
    if (ev.target.closest('[data-tutorial-offer-start]')) {
      if (tutorialState.offer) startTutorial(tutorialState.offer);
      return;
    }
    if (ev.target.closest('[data-tutorial-offer-later]')) return postponeOffer();
    if (ev.target.closest('[data-tutorial-exit]')) return exitTutorial();
    if (ev.target.closest('[data-tutorial-restart]')) {
      if (tutorialState.active) startTutorial(tutorialState.active.id, { continueProgress: false });
      return;
    }
    if (ev.target.closest('[data-tutorial-prev]')) return previousStep();
    if (ev.target.closest('[data-tutorial-next]')) return nextStep();

    const reset = ev.target.closest('[data-tutorial-reset-profile]');
    if (reset) {
      const profileId = reset.dataset.tutorialResetProfile;
      const tutorialId = reset.dataset.tutorialId;
      const version = Number(reset.dataset.tutorialVersion || 1);
      if (!confirm('¿Reasignar este tutorial desde el primer paso?')) return;
      reset.disabled = true;
      resetTeamTutorial(profileId, tutorialId, version)
        .then(() => toast('Capacitación reasignada.'))
        .catch((err) => toast(err.message || 'No se pudo reasignar la capacitación.', 'error'))
        .finally(() => { if (reset.isConnected) reset.disabled = false; });
      return;
    }
  });

  document.addEventListener('change', (ev) => {
    const assign = ev.target.closest?.('[data-tutorial-assign-profile]');
    if (assign) {
      const profileId = assign.dataset.tutorialAssignProfile;
      const tutorialId = assign.dataset.tutorialId;
      const version = Number(assign.dataset.tutorialVersion || 1);
      assign.disabled = true;
      setTeamTutorialAssignment(profileId, tutorialId, version, assign.checked, { autoStart: true })
        .then(() => toast(assign.checked ? 'Capacitación asignada.' : 'Capacitación retirada.'))
        .catch((err) => {
          assign.checked = !assign.checked;
          toast(err.message || 'No se pudo cambiar la capacitación.', 'error');
        })
        .finally(() => { if (assign.isConnected) assign.disabled = false; });
      return;
    }

    const auto = ev.target.closest?.('[data-tutorial-auto-profile]');
    if (auto) {
      const profileId = auto.dataset.tutorialAutoProfile;
      const tutorialId = auto.dataset.tutorialId;
      const version = Number(auto.dataset.tutorialVersion || 1);
      auto.disabled = true;
      setTeamTutorialAutoStart(profileId, tutorialId, version, auto.checked)
        .catch((err) => {
          auto.checked = !auto.checked;
          toast(err.message || 'No se pudo cambiar el inicio automático.', 'error');
        })
        .finally(() => { if (auto.isConnected) auto.disabled = false; });
    }
  });

  const reposition = () => tutorialState.active && tutorialState.target && renderOverlay();
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);
}
