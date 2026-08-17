import { CRM_CROSS, CRM_FLOW, PIPELINE_STAGES, TEMPLATE_CHANNELS, TEMPLATE_VARIABLES, USER_ROLES } from './catalog.js';
import {
  activitiesOf,
  avgDaysPerStage,
  contactsOf,
  findContact,
  getDiscovery,
  getLead,
  leadsByIndustry,
  metrics,
  openTasks,
  state,
  taskOf
} from './store.js';
import { addDaysISO, daysBetween, escapeHtml as e, fmtDate, fmtDateTime, fmtMoney, fmtNumber, todayISO } from './utils.js';

const stageBadge = (stage) =>
  `<span class="badge ${stage === 'Ganado' ? 'success' : stage === 'Perdido' ? 'danger' : stage === 'Remarketing' ? 'warning' : ''}">${e(stage)}</span>`;

const kpi = (label, value, sub, tone = '') =>
  `<div class="kpi ${tone}"><div class="label">${e(label)}</div><div class="value">${e(value)}</div><div class="sub">${e(sub)}</div></div>`;

const empty = (title, hint) => `<div class="empty"><strong>${e(title)}</strong><p>${e(hint)}</p></div>`;

/**
 * Un movimiento se puede editar/borrar solo si lo registró el usuario a mano.
 * El cierre de una tarea y los eventos del sistema son historia: quedan fijos.
 */
const editableActivity = (a) => !a.task && !a.system;

/** Semáforo de la tarea del prospecto, para verlo sin abrir la ficha. */
function taskDot(lead) {
  const task = taskOf(lead);
  if (!task) return `<span class="task-dot none" title="Sin tarea agendada"></span>`;
  const overdue = !task.date || task.date < todayISO();
  const soon = task.date && task.date <= addDaysISO(todayISO(), 1);
  const tone = overdue ? 'overdue' : soon ? 'soon' : 'ok';
  const label = overdue ? `Tarea vencida: ${task.title}` : `${task.title} · ${fmtDate(task.date)}`;
  return `<span class="task-dot ${tone}" title="${e(label)}"></span>`;
}

/* ---------------- Resumen ---------------- */

export function renderDashboard(ui) {
  const m = metrics();
  const stageDays = avgDaysPerStage();
  const maxStage = Math.max(1, ...m.stageCounts.map((x) => x.count));
  const industries = leadsByIndustry();
  const maxIndustry = Math.max(1, ...industries.map((x) => x.total));
  const tasks = openTasks();
  const overdueCount = tasks.filter((t) => !t.date || t.date < todayISO()).length;

  return `
    <div class="kpi-grid">
      ${kpi('Oportunidades abiertas', fmtNumber(m.open.length), 'Sin ganadas ni perdidas')}
      ${kpi('Pipeline', fmtMoney(m.pipelineValue), `Ponderado ${fmtMoney(m.weighted)}`)}
      ${kpi('Tasa de cierre', `${m.winRate.toFixed(0)}%`, `${m.won.length} ganadas · ${m.lost.length} perdidas`)}
      ${kpi('Ticket promedio', fmtMoney(m.avgTicket), m.avgCycleDays ? `Ciclo ${m.avgCycleDays} días` : 'Sin cierres aún')}
      ${kpi('Tareas vencidas', fmtNumber(overdueCount), overdueCount ? 'Requieren acción hoy' : 'Al día', overdueCount ? 'alert' : '')}
    </div>

    ${m.stale.length ? `<div class="notice warn">${m.stale.length} oportunidad(es) sin próxima acción y sin movimiento hace más de 14 días.</div>` : ''}

    ${renderPendingTasks(ui, tasks)}

    <div class="card">
      <div class="card-head"><h3>Embudo</h3></div>
      <div class="card-body">
        ${m.stageCounts
          .map((x) => {
            const days = stageDays.find((d) => d.stage === x.stage)?.days;
            return `<div class="funnel-row">
              <div class="funnel-top"><span>${e(x.stage)}</span><strong>${x.count}</strong></div>
              <div class="progress"><span style="width:${(x.count / maxStage) * 100}%"></span></div>
              <div class="muted">${days == null ? 'sin historial' : `${days} días promedio en etapa`}</div>
            </div>`;
          })
          .join('')}
      </div>
    </div>

    ${
      industries.length
        ? `<div class="card" style="margin-top:16px">
            <div class="card-head"><h3>Rubros con mayor recepción</h3><span class="muted">${industries.length} rubro(s)</span></div>
            <div class="card-body">
              ${industries
                .map(
                  (g) => `<div class="funnel-row">
                    <div class="funnel-top"><span>${e(g.industry)}</span><strong>${g.total}</strong></div>
                    <div class="progress"><span style="width:${(g.total / maxIndustry) * 100}%"></span></div>
                    <div class="muted">${g.won} ganada(s) · ${g.winRate.toFixed(0)}% de cierre</div>
                  </div>`
                )
                .join('')}
            </div>
          </div>`
        : ''
    }

    ${
      m.lost.length
        ? `<div class="card" style="margin-top:16px">
            <div class="card-head"><h3>Motivos de pérdida</h3></div>
            <div class="card-body"><div class="chips">${m.lossReasons
              .map(([reason, n]) => `<span class="chip">${e(reason)} · <strong>${n}</strong></span>`)
              .join('')}</div></div>
          </div>`
        : ''
    }

    ${renderRecentActivities()}`;
}

/** Las acciones de una tarea son siempre las mismas, esté donde esté. */
export function taskActions(leadId, { includeFicha = true } = {}) {
  return `
    <button class="small-btn" data-action="complete-task" data-id="${leadId}">Marcar realizada</button>
    <button class="small-btn" data-action="reschedule-task" data-id="${leadId}">Reagendar</button>
    ${includeFicha ? `<button class="small-btn" data-action="open-detail" data-id="${leadId}">Ver ficha</button>` : ''}`;
}

/** Una tarea en el resumen: se gestiona sin salir del home. */
function taskRow(t, isOverdue) {
  return `<div class="list-item">
    <div>
      <strong>${e(t.title)}</strong>
      <div class="muted">${e(t.lead.company)} · ${e(t.lead.stage)}${t.lead.owner ? ` · ${e(t.lead.owner)}` : ''}</div>
    </div>
    <div class="list-side">
      <span class="badge ${isOverdue ? 'danger' : ''}">${t.date ? e(fmtDate(t.date)) : 'Sin fecha'}</span>
      <div class="actions">${taskActions(t.lead.id)}</div>
    </div>
  </div>`;
}

/**
 * Próximas tareas: junta los compromisos de actividades y las próximas acciones
 * de cada prospecto. Vencidas = ya pasó su fecha (o no tiene);
 * Próximas a vencer = vencen hoy o mañana; Agendadas = el resto, más adelante.
 */
function renderPendingTasks(ui, all = openTasks()) {
  const today = todayISO();
  const limit = addDaysISO(today, 1);

  const overdue = all.filter((t) => !t.date || t.date < today);
  const soon = all.filter((t) => t.date && t.date >= today && t.date <= limit);
  const scheduled = all.filter((t) => t.date && t.date > limit);

  const tabs = [
    { id: 'overdue', label: 'Vencidas', rows: overdue, emptyTitle: 'Sin tareas vencidas', emptyHint: 'Todo al día. Acá caen las tareas que pasaron su fecha o que quedaron sin fecha.' },
    { id: 'soon', label: 'Próximas a vencer', rows: soon, emptyTitle: 'Nada vence hoy ni mañana', emptyHint: 'Acá aparecen las tareas con fecha para hoy o mañana.' },
    { id: 'scheduled', label: 'Agendadas', rows: scheduled, emptyTitle: 'Sin tareas agendadas', emptyHint: 'Acá aparecen las tareas con fecha de pasado mañana en adelante.' }
  ];
  const active = tabs.find((t) => t.id === ui?.taskTab) || tabs[0];

  return `
    <div class="card ${overdue.length ? 'card-alert' : ''}" style="margin-bottom:16px">
      <div class="card-head">
        <h3>Próximas tareas</h3>
        <div class="button-row">
          ${tabs
            .map(
              (t) =>
                `<button class="small-btn ${t.id === active.id ? 'active-view' : ''}" data-action="tasks-tab" data-tab="${t.id}">${e(t.label)} (${t.rows.length})</button>`
            )
            .join('')}
          <button class="small-btn" data-action="open-manage">Gestionar</button>
        </div>
      </div>
      <div class="card-body">
        ${
          active.rows.length
            ? `<div class="list">${active.rows.map((t) => taskRow(t, active.id === 'overdue' && Boolean(t.date))).join('')}</div>`
            : empty(active.emptyTitle, active.emptyHint)
        }
      </div>
    </div>`;
}

function renderRecentActivities() {
  const recent = [...state.activities].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8);
  return `
    <div class="card" style="margin-top:16px">
      <div class="card-head">
        <h3>Últimos movimientos</h3>
        <span class="muted">${recent.length ? `${recent.length} más recientes` : ''}</span>
      </div>
      <div class="card-body">
        ${
          recent.length
            ? `<div class="list">${recent
                .map((a) => {
                  const l = getLead(a.leadId);
                  const contactName = a.contactId ? findContact(l, a.contactId)?.name : '';
                  const company = l
                    ? `<button class="link-btn" data-action="open-detail" data-id="${l.id}">${e(l.company)}</button>`
                    : `<span class="muted">${e(a.company || 'Empresa eliminada')}</span>`;
                  return `<div class="list-item">
                    <div>
                      <strong>${e(a.type)} · </strong>${company}${contactName ? `<span class="muted"> · ${e(contactName)}</span>` : ''}
                      <div class="muted">${e(a.detail)}</div>
                    </div>
                    <div class="list-side">
                      <span class="badge">${e(fmtDateTime(a.date))}</span>
                      ${
                        editableActivity(a)
                          ? `<div class="actions">
                              <button class="small-btn" data-action="edit-activity" data-id="${a.id}">Editar</button>
                              <button class="small-btn danger" data-action="delete-activity" data-id="${a.id}">Eliminar</button>
                            </div>`
                          : ''
                      }
                    </div>
                  </div>`;
                })
                .join('')}</div>`
            : empty('Sin movimientos registrados', 'Acá aparecen las actividades, las tareas cerradas y los cambios en tus oportunidades.')
        }
      </div>
    </div>`;
}

/* ---------------- Leads ---------------- */

export function filterLeads({ query = '', owner = '', sort = 'updated' }, pool = state.leads) {
  const q = query.trim().toLowerCase();
  let rows = pool.filter((l) => {
    const haystack = `${l.company} ${l.contact} ${l.email} ${l.industry} ${l.owner}`.toLowerCase();
    return (!q || haystack.includes(q)) && (!owner || l.owner === owner);
  });
  const sorters = {
    updated: (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)),
    value: (a, b) => Number(b.value || 0) - Number(a.value || 0),
    company: (a, b) => a.company.localeCompare(b.company),
    next: (a, b) => (a.nextDate || '9999').localeCompare(b.nextDate || '9999')
  };
  return rows.sort(sorters[sort] || sorters.updated);
}

export function renderLeads(ui) {
  const pool = state.leads.filter((l) => l.stage === 'Lead');
  const rows = filterLeads(ui.leadFilters, pool);
  const owners = [...new Set(state.leads.map((l) => l.owner).filter(Boolean))];
  const total = rows.reduce((s, l) => s + Number(l.value || 0), 0);

  return `
    <div class="card">
      <div class="card-head">
        <h3>Leads sin calificar</h3>
        <button class="primary-btn" data-action="new-lead">+ Nuevo lead</button>
      </div>
      <div class="card-body">
        <div class="notice">Al calificar un lead pasa a “Contactado” y se administra desde Pipeline.</div>
        <div class="toolbar">
          <input id="leadQuery" placeholder="Buscar empresa, contacto o email" value="${e(ui.leadFilters.query)}" />
          <select id="leadOwner">
            <option value="">Todos los responsables</option>
            ${owners.map((o) => `<option ${ui.leadFilters.owner === o ? 'selected' : ''}>${e(o)}</option>`).join('')}
          </select>
          <select id="leadSort">
            <option value="updated" ${ui.leadFilters.sort === 'updated' ? 'selected' : ''}>Actualización reciente</option>
            <option value="value" ${ui.leadFilters.sort === 'value' ? 'selected' : ''}>Mayor valor</option>
            <option value="next" ${ui.leadFilters.sort === 'next' ? 'selected' : ''}>Próxima acción</option>
            <option value="company" ${ui.leadFilters.sort === 'company' ? 'selected' : ''}>Empresa A-Z</option>
          </select>
          <span class="toolbar-summary">${rows.length} de ${pool.length} · ${fmtMoney(total)}</span>
        </div>

        ${
          rows.length
            ? `<div class="table-wrap"><table class="data-table">
                <thead><tr><th>Empresa</th><th>Contacto</th><th>Valor</th><th>Próxima acción</th><th>Responsable</th><th></th></tr></thead>
                <tbody>${rows
                  .map(
                    (l) => `<tr>
                      <td>
                        <button class="link-btn" data-action="open-detail" data-id="${l.id}">${e(l.company)}</button>
                        <div class="muted">${e(l.industry || '')}</div>
                      </td>
                      <td>${e(l.contact || '—')}<div class="muted">${e(l.email || l.phone || '')}</div></td>
                      <td>${fmtMoney(l.value)}<div class="muted">${e(l.probability || 0)}%</div></td>
                      <td>${e(l.nextAction || '—')}<div class="muted ${l.nextDate && l.nextDate < todayISO() ? 'overdue' : ''}">${e(fmtDate(l.nextDate))}</div></td>
                      <td>${e(l.owner || '—')}</td>
                      <td><div class="actions">
                        <button class="small-btn" data-action="qualify-lead" data-id="${l.id}">Calificar</button>
                        <button class="small-btn" data-action="edit-lead" data-id="${l.id}">Editar</button>
                        <button class="small-btn" data-action="open-discovery" data-id="${l.id}">Levantar</button>
                        <button class="small-btn" data-action="new-activity" data-id="${l.id}">Actividad</button>
                        <button class="small-btn danger" data-action="delete-lead" data-id="${l.id}">Eliminar</button>
                      </div></td>
                    </tr>`
                  )
                  .join('')}</tbody>
              </table></div>`
            : empty(
                pool.length ? 'Ningún lead coincide con el filtro' : 'Aún no hay leads sin calificar',
                pool.length
                  ? 'Ajusta la búsqueda o limpia los filtros.'
                  : 'Crea el primero con “Nuevo lead”, o carga los datos demo desde Configuración.'
              )
        }
      </div>
    </div>`;
}

/* ---------------- Embudo comercial (Pipeline) ---------------- */

export function filterPipeline({ query = '', stage = '', owner = '' }, pool) {
  const base = pool || state.leads.filter((l) => PIPELINE_STAGES.includes(l.stage));
  const q = query.trim().toLowerCase();
  return base.filter((l) => {
    const haystack = `${l.company} ${l.contact} ${l.email} ${l.industry} ${l.owner}`.toLowerCase();
    return (!q || haystack.includes(q)) && (!stage || l.stage === stage) && (!owner || l.owner === owner);
  });
}

function renderPipelineKanban() {
  return `
    <div class="notice">En escritorio arrastra las tarjetas. En móvil usa <strong>Mover</strong> para cambiar de etapa.</div>
    <div class="kanban">
      ${PIPELINE_STAGES.map((stage) => {
        const ls = state.leads.filter((l) => l.stage === stage);
        const sum = ls.reduce((s, l) => s + Number(l.value || 0), 0);
        return `<section class="kanban-col">
          <header class="kanban-head">
            <span>${e(stage)}</span>
            <span class="kanban-count">${ls.length}</span>
          </header>
          <div class="kanban-sum">${fmtMoney(sum)}</div>
          <div class="kanban-list" data-stage="${e(stage)}">
            ${ls
              .map(
                (l) => `<article class="deal-card" draggable="true" data-id="${l.id}"
                  data-action="open-detail" role="button" tabindex="0"
                  aria-label="Abrir ficha de ${e(l.company)}">
                  <div class="deal-company">${taskDot(l)}${e(l.company)}</div>
                  <div class="meta">${e(l.contact || 'Sin contacto')}</div>
                  <div class="money">${fmtMoney(l.value)}</div>
                  <div class="meta ${l.nextDate && l.nextDate < todayISO() ? 'overdue' : ''}">${e(l.nextAction || 'Sin tarea agendada')}</div>
                  <div class="card-actions">
                    <button class="small-btn" data-action="move-stage" data-id="${l.id}">Mover</button>
                    <button class="small-btn" data-action="new-activity" data-id="${l.id}">Actividad</button>
                  </div>
                </article>`
              )
              .join('')}
          </div>
        </section>`;
      }).join('')}
    </div>`;
}

function renderPipelineList(ui) {
  const rows = filterPipeline(ui.pipelineFilters);
  const owners = [...new Set(state.leads.map((l) => l.owner).filter(Boolean))];
  const total = rows.reduce((s, l) => s + Number(l.value || 0), 0);

  return `
    <div class="toolbar">
      <input id="pipelineQuery" placeholder="Buscar empresa, contacto o email" value="${e(ui.pipelineFilters.query)}" />
      <select id="pipelineStage">
        <option value="">Todas las etapas</option>
        ${PIPELINE_STAGES.map((s) => `<option ${ui.pipelineFilters.stage === s ? 'selected' : ''}>${e(s)}</option>`).join('')}
      </select>
      <select id="pipelineOwner">
        <option value="">Todos los responsables</option>
        ${owners.map((o) => `<option ${ui.pipelineFilters.owner === o ? 'selected' : ''}>${e(o)}</option>`).join('')}
      </select>
      <button class="small-btn" data-action="export-pipeline-csv">Exportar a Excel</button>
      <span class="toolbar-summary">${rows.length} · ${fmtMoney(total)}</span>
    </div>
    ${
      rows.length
        ? `<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Empresa</th><th>Contacto</th><th>Etapa</th><th>Valor</th><th>Próxima acción</th><th>Responsable</th><th></th></tr></thead>
            <tbody>${rows
              .map(
                (l) => `<tr>
                  <td><button class="link-btn" data-action="open-detail" data-id="${l.id}">${e(l.company)}</button><div class="muted">${e(l.industry || '')}</div></td>
                  <td>${e(l.contact || '—')}<div class="muted">${e(l.email || l.phone || '')}</div></td>
                  <td>${stageBadge(l.stage)}</td>
                  <td>${fmtMoney(l.value)}<div class="muted">${e(l.probability || 0)}%</div></td>
                  <td>${e(l.nextAction || '—')}<div class="muted ${l.nextDate && l.nextDate < todayISO() ? 'overdue' : ''}">${e(fmtDate(l.nextDate))}</div></td>
                  <td>${e(l.owner || '—')}</td>
                  <td><div class="actions">
                    <button class="small-btn" data-action="move-stage" data-id="${l.id}">Mover</button>
                    <button class="small-btn" data-action="new-activity" data-id="${l.id}">Actividad</button>
                  </div></td>
                </tr>`
              )
              .join('')}</tbody>
          </table></div>`
        : empty('Ningún prospecto coincide', 'Ajusta la búsqueda o limpia los filtros.')
    }`;
}

export function renderPipeline(ui) {
  const view = ui.pipelineView || 'kanban';
  return `
    <div class="toolbar" style="margin-bottom:16px">
      <div class="button-row">
        <button class="small-btn ${view === 'kanban' ? 'active-view' : ''}" data-action="pipeline-view-kanban">Vista embudo</button>
        <button class="small-btn ${view === 'list' ? 'active-view' : ''}" data-action="pipeline-view-list">Vista lista</button>
      </div>
    </div>
    ${view === 'list' ? renderPipelineList(ui) : renderPipelineKanban()}`;
}

/* ---------------- Implementación ---------------- */

export function renderImplementation() {
  const won = state.leads.filter((l) => l.stage === 'Ganado');
  return `
    <div class="card">
      <div class="card-head"><h3>Clientes ganados · puesta en marcha</h3><span class="muted">${won.length} cliente(s)</span></div>
      <div class="card-body">
        ${
          won.length
            ? `<div class="table-wrap"><table class="data-table">
                <thead><tr><th>Cliente</th><th>Contacto</th><th>Valor</th><th>Alcance levantado</th><th>Integraciones</th><th>Próximo paso</th><th></th></tr></thead>
                <tbody>${won
                  .map((l) => {
                    const d = getDiscovery(l.id) || {};
                    const wonAt = l.stageHistory?.find((h) => h.stage === 'Ganado')?.at;
                    return `<tr>
                      <td><button class="link-btn" data-action="open-detail" data-id="${l.id}">${e(l.company)}</button><div class="muted">${wonAt ? `Ganado hace ${daysBetween(wonAt)} días` : ''}</div></td>
                      <td>${e(l.contact || '—')}<div class="muted">${e(l.email || '')}</div></td>
                      <td>${fmtMoney(l.value)}</td>
                      <td>${e((d.modules || []).join(', ') || 'Sin levantamiento')}</td>
                      <td>${e(d.integrations || '—')}</td>
                      <td>${e(l.nextAction || 'Coordinar kick-off')}<div class="muted">${e(fmtDate(l.nextDate))}</div></td>
                      <td><button class="small-btn" data-action="open-discovery" data-id="${l.id}">Ver alcance</button></td>
                    </tr>`;
                  })
                  .join('')}</tbody>
              </table></div>`
            : empty('Sin clientes ganados', 'Al mover una oportunidad a “Ganado” aparece acá para su kick-off.')
        }
      </div>
    </div>`;
}

/* ---------------- Remarketing ---------------- */

export function renderRemarketing() {
  const rows = state.leads.filter((l) => l.stage === 'Remarketing');
  return `
    <div class="card">
      <div class="card-head"><h3>Prospectos en remarketing</h3><span class="muted">${rows.length} prospecto(s)</span></div>
      <div class="card-body">
        <div class="notice">Prospectos con un "no" temporal (no ahora, el próximo año, etc.). Usá los correos de seguimiento para retomar contacto sin perder el hilo.</div>
        ${
          rows.length
            ? `<div class="table-wrap"><table class="data-table">
                <thead><tr><th>Empresa</th><th>Contacto</th><th>Motivo</th><th>Valor</th><th>Próxima acción</th><th></th></tr></thead>
                <tbody>${rows
                  .map(
                    (l) => `<tr>
                      <td><button class="link-btn" data-action="open-detail" data-id="${l.id}">${e(l.company)}</button><div class="muted">${e(l.industry || '')}</div></td>
                      <td>${e(l.contact || '—')}<div class="muted">${e(l.email || l.phone || '')}</div></td>
                      <td>${e(l.remarketingReason || 'Sin especificar')}</td>
                      <td>${fmtMoney(l.value)}</td>
                      <td>${e(l.nextAction || '—')}<div class="muted ${l.nextDate && l.nextDate < todayISO() ? 'overdue' : ''}">${e(fmtDate(l.nextDate))}</div></td>
                      <td><div class="actions">
                        <button class="small-btn" data-action="remarketing-email" data-id="${l.id}" data-template="remarketing1">Correo 1</button>
                        <button class="small-btn" data-action="remarketing-email" data-id="${l.id}" data-template="remarketing2">Correo 2</button>
                        <button class="small-btn" data-action="remarketing-email" data-id="${l.id}" data-template="remarketing3">Correo 3</button>
                        <button class="small-btn" data-action="back-to-pipeline" data-id="${l.id}">Pasar a prospecto</button>
                        <button class="small-btn" data-action="move-stage" data-id="${l.id}">Mover</button>
                      </div></td>
                    </tr>`
                  )
                  .join('')}</tbody>
              </table></div>`
            : empty('Sin prospectos en remarketing', 'Cuando muevas una oportunidad a “Remarketing” aparece acá.')
        }
      </div>
    </div>`;
}

/* ---------------- Plantillas ---------------- */

export function fillTemplate(text, leadId, contact = null) {
  const lead = getLead(leadId);
  const d = lead ? getDiscovery(lead.id) || {} : {};
  const map = {
    '{{contacto}}': contact?.name || lead?.contact || 'equipo',
    '{{empresa}}': lead?.company || 'su empresa',
    '{{cargo}}': contact?.role || lead?.role || '',
    '{{dolor}}': d.pain || 'la operación en terreno',
    '{{modulos}}': (d.modules || []).join(', ') || 'órdenes de trabajo y trazabilidad',
    '{{responsable}}': lead?.owner || ''
  };
  return Object.entries(map).reduce((acc, [k, v]) => acc.split(k).join(v), text);
}

const channelLabel = (channel) => TEMPLATE_CHANNELS.find((c) => c.id === channel)?.label || 'WhatsApp + Correo';

/**
 * Vista previa del mensaje ya resuelto: las variables reemplazadas por los datos
 * reales de la empresa elegida (o por ejemplos genéricos si no hay ninguna).
 */
export function templatePreviewHtml({ channel, subject, body }, leadId) {
  const filledSubject = fillTemplate(subject || '', leadId);
  const filledBody = fillTemplate(body || '', leadId);
  return `
    ${channel !== 'whatsapp' && filledSubject ? `<p class="preview-subject"><strong>Asunto:</strong> ${e(filledSubject)}</p>` : ''}
    <p class="preview-body">${e(filledBody).replace(/\n/g, '<br />') || '<span class="muted">Escribe el mensaje para ver la vista previa.</span>'}</p>`;
}

export function renderTemplates(ui) {
  const leadId = ui.templateLead;
  const channelFilter = ui.templateChannel || '';
  const rows = state.templates.filter((t) => !channelFilter || t.channel === channelFilter || t.channel === 'both');
  const previewName = leadId ? getLead(leadId)?.company : 'ejemplo genérico';

  return `
    <div class="card">
      <div class="card-head">
        <h3>Plantillas de mensajes</h3>
        <button class="primary-btn" data-action="new-template">+ Nueva plantilla</button>
      </div>
      <div class="card-body">
        <div class="notice">
          <strong>Cómo funciona:</strong> una plantilla es un mensaje base con <em>variables</em> (por ejemplo <code>{{empresa}}</code>)
          que se completan solas con los datos de cada prospecto. Esta pantalla es solo de configuración: acá se escriben y se guardan,
          <strong>desde acá no se envía nada</strong>. El envío se hace en la ficha de cada empresa → <strong>Comunicación</strong>.
        </div>

        <div class="toolbar">
          <select id="templateChannel">
            <option value="">Todos los canales</option>
            ${TEMPLATE_CHANNELS.filter((c) => c.id !== 'both')
              .map((c) => `<option value="${c.id}" ${channelFilter === c.id ? 'selected' : ''}>${e(c.label)}</option>`)
              .join('')}
          </select>
          <select id="templateLead" aria-label="Empresa para la vista previa">
            <option value="">Vista previa: ejemplo genérico</option>
            ${state.leads.map((l) => `<option value="${l.id}" ${leadId === l.id ? 'selected' : ''}>Vista previa: ${e(l.company)}</option>`).join('')}
          </select>
          <span class="toolbar-summary">${rows.length} plantilla(s)</span>
        </div>

        ${
          rows.length
            ? `<div class="template-list">
                ${rows
                  .map(
                    (t) => `<details class="template-item" data-id="${t.id}" ${ui.templateOpen === t.id ? 'open' : ''}>
                      <summary>
                        <span class="template-title">${e(t.name || 'Sin nombre')}</span>
                        <span class="badge">${e(channelLabel(t.channel))}</span>
                        <span class="template-peek">${e((t.body || '').replace(/\s+/g, ' ').slice(0, 70))}…</span>
                        <span class="unsaved-flag">Sin guardar</span>
                      </summary>

                      <div class="template-editor">
                        <div class="template-fields">
                          <label>Nombre
                            <input class="template-name" data-template-name="${t.id}" value="${e(t.name)}" placeholder="Ej. Presentación general" />
                          </label>
                          <label>Canal
                            <select class="template-channel" data-template-channel="${t.id}">
                              ${TEMPLATE_CHANNELS.map((c) => `<option value="${c.id}" ${t.channel === c.id ? 'selected' : ''}>${e(c.label)}</option>`).join('')}
                            </select>
                          </label>
                          <label class="span-2 template-subject-field" ${t.channel === 'whatsapp' ? 'hidden' : ''}>Asunto del correo
                            <input class="template-subject" data-template-subject="${t.id}" value="${e(t.subject)}" placeholder="Asunto que verá el destinatario" />
                          </label>
                          <label class="span-2">Mensaje
                            <textarea data-template-body="${t.id}" rows="9">${e(t.body)}</textarea>
                          </label>
                        </div>

                        <div class="var-chips">
                          <span class="muted">Insertar variable:</span>
                          ${TEMPLATE_VARIABLES.map(
                            (v) => `<button type="button" class="var-chip" data-action="insert-var" data-id="${t.id}" data-var="${e(v)}">${e(v)}</button>`
                          ).join('')}
                        </div>

                        <div class="template-preview">
                          <h5>Así se envía · ${e(previewName || 'ejemplo genérico')}</h5>
                          <div data-template-preview="${t.id}">${templatePreviewHtml(t, leadId)}</div>
                        </div>

                        <div class="template-actions">
                          <button class="small-btn danger" data-action="delete-template" data-id="${t.id}">Eliminar</button>
                          <button class="small-btn" data-action="copy-template" data-id="${t.id}">Copiar mensaje</button>
                          <button class="primary-btn" data-action="save-template" data-id="${t.id}">Guardar plantilla</button>
                        </div>
                      </div>
                    </details>`
                  )
                  .join('')}
              </div>`
            : empty('Sin plantillas para este canal', 'Cambia el filtro o crea una nueva plantilla.')
        }
      </div>
    </div>`;
}

/* ---------------- Configuración ---------------- */

export function renderSettings() {
  const { profile, users } = state.settings;

  return `
    <div class="card">
      <div class="card-head"><h3>Mi usuario</h3></div>
      <div class="card-body">
        <div class="settings-grid">
          <label>Nombre<input id="profileName" value="${e(profile.name)}" placeholder="Tu nombre" /></label>
          <label>Correo<input id="profileEmail" type="email" value="${e(profile.email)}" placeholder="nombre@taskflow.cl" /></label>
          <label>Teléfono<input id="profilePhone" inputmode="tel" value="${e(profile.phone)}" placeholder="+56 9 ..." /></label>
          <label>Contraseña
            <span class="pass-field">
              <input id="profilePassword" type="password" value="${e(profile.password)}" placeholder="Contraseña" />
              <button class="small-btn" data-action="toggle-password" data-target="profilePassword">Ver</button>
            </span>
          </label>
        </div>
        <div class="button-row" style="margin-top:14px">
          <button class="primary-btn" data-action="save-profile">Guardar mis datos</button>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-head">
        <h3>Usuarios invitados</h3>
        <button class="primary-btn" data-action="new-user">+ Invitar usuario</button>
      </div>
      <div class="card-body">
        <div class="notice warn">
          <strong>Importante:</strong> este CRM funciona solo en el navegador, sin servidor. Los usuarios y contraseñas
          quedan guardados en este equipo y <strong>sin cifrar</strong>: sirven para dejar definidos los accesos y permisos,
          pero todavía no son un inicio de sesión real. Para que lo sean hay que conectar un backend.
        </div>
        ${
          users.length
            ? `<div class="table-wrap"><table class="data-table">
                <thead><tr><th>Nombre</th><th>Correo</th><th>Teléfono</th><th>Contraseña</th><th>Permiso</th><th>Estado</th><th></th></tr></thead>
                <tbody>${users
                  .map(
                    (u) => `<tr>
                      <td><input class="cell-input" id="u_${u.id}_name" data-user-field="name" data-id="${u.id}" value="${e(u.name)}" placeholder="Nombre" /></td>
                      <td><input class="cell-input" id="u_${u.id}_email" data-user-field="email" data-id="${u.id}" type="email" value="${e(u.email)}" placeholder="correo@taskflow.cl" /></td>
                      <td><input class="cell-input" id="u_${u.id}_phone" data-user-field="phone" data-id="${u.id}" value="${e(u.phone)}" placeholder="+56 9 ..." /></td>
                      <td><span class="pass-field">
                        <input class="cell-input" id="pass-${u.id}" data-user-field="password" data-id="${u.id}" type="password" value="${e(u.password)}" placeholder="Clave" />
                        <button class="small-btn" data-action="toggle-password" data-target="pass-${u.id}">Ver</button>
                      </span></td>
                      <td><select class="cell-input" id="u_${u.id}_role" data-user-field="role" data-id="${u.id}">
                        ${USER_ROLES.map((r) => `<option value="${r.id}" ${u.role === r.id ? 'selected' : ''}>${e(r.label)}</option>`).join('')}
                      </select></td>
                      <td><label class="inline-check"><input type="checkbox" id="u_${u.id}_active" data-user-field="active" data-id="${u.id}" ${u.active ? 'checked' : ''} /> Activo</label></td>
                      <td><button class="small-btn danger" data-action="delete-user" data-id="${u.id}">Eliminar</button></td>
                    </tr>`
                  )
                  .join('')}</tbody>
              </table></div>`
            : empty('Sin usuarios invitados', 'Usa “Invitar usuario” para sumar a alguien del equipo y asignarle un permiso.')
        }

        <h4 class="settings-subtitle">Qué puede hacer cada permiso</h4>
        <div class="role-list">
          ${USER_ROLES.map((r) => `<div class="role-row"><strong>${e(r.label)}</strong><span class="muted">${e(r.detail)}</span></div>`).join('')}
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-head"><h3>Cómo funciona el CRM</h3><span class="muted">Toca cada paso para ver el detalle</span></div>
      <div class="card-body">
        <div class="flow-map">
          ${CRM_FLOW.map(
            (n, i) => `
            <details class="flow-node" ${i === 0 ? 'open' : ''}>
              <summary>
                <span class="flow-step">${e(n.step)}</span>
                <span class="flow-heading">
                  <strong>${e(n.title)}</strong>
                  <span class="muted">${e(n.tagline)}</span>
                </span>
              </summary>
              <div class="flow-body">
                <p class="flow-detail">${e(n.detail)}</p>
                <div class="flow-cols">
                  <div>
                    <h5>Qué se hace acá</h5>
                    <ul>${n.does.map((d) => `<li>${e(d)}</li>`).join('')}</ul>
                  </div>
                  <div>
                    <h5>Hacia dónde sigue</h5>
                    <ul>${n.goes.map((g) => `<li>${g}</li>`).join('')}</ul>
                  </div>
                </div>
              </div>
            </details>
            ${i < CRM_FLOW.length - 1 ? '<div class="flow-arrow" aria-hidden="true">↓</div>' : ''}`
          ).join('')}
        </div>

        <h4 class="settings-subtitle">Piezas que cruzan todo el flujo</h4>
        <div class="flow-map">
          ${CRM_CROSS.map(
            (c) => `
            <details class="flow-node cross">
              <summary>
                <span class="flow-heading"><strong>${e(c.title)}</strong></span>
              </summary>
              <div class="flow-body"><p class="flow-detail">${c.detail}</p></div>
            </details>`
          ).join('')}
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-head"><h3>Datos de demostración</h3></div>
      <div class="card-body">
        <p class="muted settings-hint">
          Carga un set de ejemplo para probar el CRM: leads por calificar, oportunidades en el embudo comercial,
          prospectos en remarketing y clientes ganados en implementación. Es el único lugar desde donde se cargan.
        </p>
        <div class="button-row">
          <button class="ghost-btn" data-action="load-demo">Cargar datos demo</button>
          <button class="danger-btn" data-action="clear-demo">Borrar todos los datos</button>
        </div>
      </div>
    </div>`;
}

/* ---------------- Ficha de la oportunidad ---------------- */

/** Sección plegable de la ficha. `count` se muestra como badge en el encabezado. */
const section = (title, body, { open = false, count = null, tone = '' } = {}) => `
  <details class="detail-section" ${open ? 'open' : ''}>
    <summary>
      <span class="detail-section-title">${e(title)}</span>
      ${count == null ? '' : `<span class="badge ${tone}">${count}</span>`}
    </summary>
    <div class="detail-section-body">${body}</div>
  </details>`;

const detailRow = (label, value) =>
  value ? `<div class="detail-row"><span>${e(label)}</span><strong>${e(value)}</strong></div>` : '';

/** Actividad del historial: se expande para ver todo y editarla sin salir de la ficha. */
function activityItem(a, lead) {
  const contactName = a.contactId ? findContact(lead, a.contactId)?.name : '';
  return `<details class="activity-item">
    <summary>
      <span class="activity-type">${e(a.type)}</span>
      <span class="activity-peek">${e(a.task ? `Cerró: ${a.task} — ${a.detail}` : a.detail)}</span>
      <span class="badge ${a.task ? 'success' : ''}">${e(fmtDateTime(a.date))}</span>
    </summary>
    <div class="activity-body">
      ${detailRow('Fecha', fmtDateTime(a.date))}
      ${detailRow('Contacto', contactName)}
      ${detailRow('Responsable', a.owner)}
      ${detailRow('Tarea cerrada', a.task)}
      ${detailRow(a.task ? 'Resultado' : 'Detalle', a.detail)}
      ${
        editableActivity(a)
          ? `<div class="actions">
              <button class="small-btn" data-action="edit-activity" data-id="${a.id}">Editar</button>
              <button class="small-btn danger" data-action="delete-activity" data-id="${a.id}">Eliminar</button>
            </div>`
          : '<p class="muted">Una tarea cerrada queda como registro histórico: no se edita ni se elimina.</p>'
      }
    </div>
  </details>`;
}

/** Un cambio de etapa dentro del historial. */
const stageItem = (h) => `
  <div class="history-stage">
    <span class="history-stage-mark" aria-hidden="true"></span>
    <span>Pasó a <strong>${e(h.stage)}</strong></span>
    <span class="badge">${e(fmtDateTime(h.at))}</span>
  </div>`;

/** Historial unificado: actividades, tareas cerradas y movimientos de etapa en una sola línea de tiempo. */
function renderHistory(lead, acts) {
  const entries = [
    ...acts.map((a) => ({ at: a.date, html: activityItem(a, lead) })),
    ...(lead.stageHistory || []).map((h) => ({ at: h.at, html: stageItem(h) }))
  ].sort((x, y) => String(y.at).localeCompare(String(x.at)));

  return entries.length
    ? `<div class="activity-list">${entries.map((x) => x.html).join('')}</div>`
    : '<p class="muted">Sin movimientos registrados.</p>';
}

export function renderLeadDetail(id) {
  const l = getLead(id);
  if (!l) return empty('Oportunidad no encontrada', 'Puede haber sido eliminada.');
  const d = getDiscovery(id) || {};
  const acts = activitiesOf(id);
  const contacts = contactsOf(l);
  const sendable = contacts.filter((c) => c.email || c.phone);
  const today = todayISO();

  const row = detailRow;

  // Una única tarea abierta por prospecto. Si pasó su fecha se marca vencida, sin salir de acá.
  const task = taskOf(l);
  const taskOverdue = Boolean(task && (!task.date || task.date < today));

  const nextTaskBody = task
    ? `<div class="next-highlight ${taskOverdue ? 'overdue-box' : ''}">
        <strong>${e(task.title)}</strong>
        <span class="badge ${taskOverdue ? 'danger' : ''}">${e(task.date ? fmtDate(task.date) : 'Sin fecha')}</span>
        ${taskOverdue ? '<span class="badge danger">Vencida</span>' : ''}
      </div>
      <div class="actions">${taskActions(l.id, { includeFicha: false })}</div>`
    : `<p class="muted">Sin tarea agendada para este prospecto.</p>
       <div class="actions"><button class="small-btn" data-action="reschedule-task" data-id="${l.id}">Agendar tarea</button></div>`;

  return `
    <div class="detail-grid">
      ${section('Próxima tarea', nextTaskBody, { open: true })}

      ${section(
        'Datos comerciales',
        `
        <div class="detail-row">
          <span>Etapa</span>
          <strong class="stage-cell">${stageBadge(l.stage)}<button class="small-btn" data-action="move-stage" data-id="${l.id}">Cambiar etapa</button></strong>
        </div>
        ${row('Motivo de pérdida', l.lossReason)}
        ${row('Valor', fmtMoney(l.value))}
        ${row('Probabilidad', `${l.probability || 0}%`)}
        ${row('Cierre estimado', fmtDate(l.expectedCloseDate))}
        ${row('Contacto', [l.contact, l.role].filter(Boolean).join(' · '))}
        ${row('Email', l.email)}
        ${row('Teléfono', l.phone)}
        ${row('Rubro', l.industry)}
        ${row('Origen', l.source)}
        ${row('Responsable', l.owner)}
        ${l.notes ? `<p class="detail-notes">${e(l.notes)}</p>` : ''}
        <button class="small-btn" data-action="edit-lead" data-id="${l.id}">Editar datos de la empresa</button>`,
        { open: true }
      )}

      ${section(
        'Contactos',
        `${
          contacts.length
            ? `<div class="list">${contacts
                .map(
                  (c) => `<div class="list-item">
                    <div>
                      <strong>${e(c.name || 'Sin nombre')}</strong>${c.role ? `<span class="muted"> · ${e(c.role)}</span>` : ''}
                      <div class="muted">${e(c.email || '—')}${c.phone ? ` · ${e(c.phone)}` : ''}</div>
                    </div>
                    <div class="list-side">
                      <div class="actions">
                        ${c.phone ? `<button class="small-btn" data-action="call-contact" data-id="${l.id}" data-contact="${c.key}">Llamar</button>` : ''}
                        ${c.phone ? `<button class="small-btn" data-action="open-whatsapp" data-id="${l.id}" data-contact="${c.key}">WhatsApp</button>` : ''}
                        ${c.email ? `<button class="small-btn" data-action="open-email" data-id="${l.id}" data-contact="${c.key}">Correo</button>` : ''}
                        ${c.primary ? '' : `<button class="small-btn danger" data-action="delete-contact" data-id="${l.id}" data-contact="${c.key}">Eliminar</button>`}
                      </div>
                    </div>
                  </div>`
                )
                .join('')}</div>`
            : '<p class="muted">Sin contactos registrados.</p>'
        }
        ${sendable.length ? '' : '<p class="muted">Agrega un email o teléfono a algún contacto para poder escribirle o llamarlo.</p>'}
        <button class="small-btn" data-action="add-contact" data-id="${l.id}">+ Agregar contacto</button>`,
        { open: true, count: contacts.length }
      )}

      ${section(
        'Levantamiento',
        `${
          d.pain
            ? `${row('Dolor principal', d.pain)}
               ${row('Gestión actual', d.currentManagement)}
               ${row('Técnicos', d.technicians)}
               ${row('Sucursales', d.locations)}
               ${row('Gatillo', d.buyTrigger)}
               ${row('Módulos', (d.modules || []).join(', '))}
               ${row('Integraciones', d.integrations)}
               ${row('Criterio de éxito', d.successCriteria)}`
            : '<p class="muted">Sin levantamiento registrado.</p>'
        }
        <button class="small-btn" data-action="open-discovery" data-id="${l.id}">${d.pain ? 'Editar levantamiento' : 'Completar levantamiento'}</button>`
      )}

      ${section(
        'Historial',
        `${renderHistory(l, acts)}
        <button class="small-btn" data-action="new-activity" data-id="${l.id}">Registrar actividad</button>`,
        { count: acts.length + (l.stageHistory || []).length }
      )}

      ${section(
        'Otros',
        `<p class="muted">Eliminar borra la empresa con su levantamiento y todo su historial. No se puede deshacer.</p>
         <button class="small-btn danger" data-action="delete-lead" data-id="${l.id}">Eliminar oportunidad</button>`
      )}
    </div>`;
}
