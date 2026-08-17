import { PIPELINE_STAGES, TEMPLATE_CHANNELS, TEMPLATE_VARIABLES } from './catalog.js';
import { activitiesOf, avgDaysPerStage, contactsOf, findContact, getDiscovery, getLead, leadsByIndustry, metrics, state } from './store.js';
import { daysBetween, escapeHtml as e, fmtDate, fmtDateTime, fmtMoney, fmtNumber, todayISO } from './utils.js';

const stageBadge = (stage) =>
  `<span class="badge ${stage === 'Ganado' ? 'success' : stage === 'Perdido' ? 'danger' : stage === 'Remarketing' ? 'warning' : ''}">${e(stage)}</span>`;

const kpi = (label, value, sub, tone = '') =>
  `<div class="kpi ${tone}"><div class="label">${e(label)}</div><div class="value">${e(value)}</div><div class="sub">${e(sub)}</div></div>`;

const empty = (title, hint) => `<div class="empty"><strong>${e(title)}</strong><p>${e(hint)}</p></div>`;

/* ---------------- Resumen ---------------- */

export function renderDashboard() {
  const m = metrics();
  const stageDays = avgDaysPerStage();
  const maxStage = Math.max(1, ...m.stageCounts.map((x) => x.count));
  const next = [...m.open]
    .filter((l) => l.nextDate)
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate))
    .slice(0, 8);
  const industries = leadsByIndustry();
  const maxIndustry = Math.max(1, ...industries.map((x) => x.total));

  return `
    <div class="kpi-grid">
      ${kpi('Oportunidades abiertas', fmtNumber(m.open.length), 'Sin ganadas ni perdidas')}
      ${kpi('Pipeline', fmtMoney(m.pipelineValue), `Ponderado ${fmtMoney(m.weighted)}`)}
      ${kpi('Tasa de cierre', `${m.winRate.toFixed(0)}%`, `${m.won.length} ganadas · ${m.lost.length} perdidas`)}
      ${kpi('Ticket promedio', fmtMoney(m.avgTicket), m.avgCycleDays ? `Ciclo ${m.avgCycleDays} días` : 'Sin cierres aún')}
      ${kpi('Seguimientos vencidos', fmtNumber(m.overdue.length), m.overdue.length ? 'Requieren acción hoy' : 'Al día', m.overdue.length ? 'alert' : '')}
    </div>

    ${m.stale.length ? `<div class="notice warn">${m.stale.length} oportunidad(es) sin próxima acción y sin movimiento hace más de 14 días.</div>` : ''}

    <div class="grid-2">
      <div class="card">
        <div class="card-head">
          <h3>Próximas acciones</h3>
          <div class="actions"><span class="muted">${next.length} programadas</span><button class="small-btn" data-action="open-manage">Gestionar</button></div>
        </div>
        <div class="card-body">
          ${
            next.length
              ? `<div class="list">${next
                  .map(
                    (l) => `<div class="list-item">
                      <div>
                        <button class="link-btn" data-action="open-detail" data-id="${l.id}">${e(l.company)}</button>
                        <div class="muted">${e(l.nextAction || 'Sin detalle')} · ${e(l.stage)}</div>
                      </div>
                      <span class="badge ${l.nextDate < todayISO() ? 'danger' : ''}">${e(fmtDate(l.nextDate))}</span>
                    </div>`
                  )
                  .join('')}</div>`
              : empty('Sin acciones programadas', 'Agenda un siguiente paso desde la ficha de cada oportunidad.')
          }
        </div>
      </div>

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
    }`;
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
                pool.length ? 'Ajusta la búsqueda o limpia los filtros.' : 'Crea el primero con “Nuevo lead” o carga el ejemplo.'
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
                (l) => `<article class="deal-card" draggable="true" data-id="${l.id}">
                  <button class="link-btn" data-action="open-detail" data-id="${l.id}">${e(l.company)}</button>
                  <div class="meta">${e(l.contact || 'Sin contacto')}</div>
                  <div class="money">${fmtMoney(l.value)}</div>
                  <div class="meta ${l.nextDate && l.nextDate < todayISO() ? 'overdue' : ''}">${e(l.nextAction || 'Sin próxima acción')}</div>
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

/* ---------------- Actividades ---------------- */

export function renderActivities(ui) {
  const rows = state.activities
    .filter((a) => (!ui.activityLead || a.leadId === ui.activityLead) && (!ui.activityType || a.type === ui.activityType))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return `
    <div class="card">
      <div class="card-head"><h3>Historial comercial</h3><button class="primary-btn" data-action="new-activity">+ Nueva actividad</button></div>
      <div class="card-body">
        <div class="toolbar">
          <select id="activityLeadFilter">
            <option value="">Todas las empresas</option>
            ${state.leads.map((l) => `<option value="${l.id}" ${ui.activityLead === l.id ? 'selected' : ''}>${e(l.company)}</option>`).join('')}
          </select>
          <select id="activityTypeFilter">
            <option value="">Todos los tipos</option>
            ${[...new Set(state.activities.map((a) => a.type))]
              .map((t) => `<option ${ui.activityType === t ? 'selected' : ''}>${e(t)}</option>`)
              .join('')}
          </select>
          <span class="toolbar-summary">${rows.length} registro(s)</span>
        </div>
        ${
          rows.length
            ? `<div class="list">${rows
                .map((a) => {
                  const l = getLead(a.leadId);
                  const contactName = a.contactId ? findContact(l, a.contactId)?.name : '';
                  return `<div class="list-item">
                    <div>
                      <strong>${e(a.type)} · ${e(l?.company || 'Empresa eliminada')}${contactName ? ' · ' + e(contactName) : ''}</strong>
                      <div class="muted">${e(a.detail)}</div>
                      ${a.commitment ? `<div class="muted"><strong>Siguiente:</strong> ${e(a.commitment)}</div>` : ''}
                    </div>
                    <div class="list-side">
                      <span class="badge">${e(fmtDateTime(a.date))}</span>
                      <div class="muted">${e(a.owner || '')}</div>
                      <button class="small-btn danger" data-action="delete-activity" data-id="${a.id}">Eliminar</button>
                    </div>
                  </div>`;
                })
                .join('')}</div>`
            : empty('Sin actividades', 'Registra llamadas, demos y compromisos para no perder el hilo.')
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

export function renderTemplates(ui) {
  const leadId = ui.templateLead;
  const channelFilter = ui.templateChannel || '';
  const rows = state.templates.filter((t) => !channelFilter || t.channel === channelFilter || t.channel === 'both');

  return `
    <div class="card">
      <div class="card-head">
        <h3>Plantillas comerciales</h3>
        <button class="primary-btn" data-action="new-template">+ Nueva plantilla</button>
      </div>
      <div class="card-body">
        <div class="toolbar">
          <select id="templateChannel">
            <option value="">Todos los canales</option>
            ${TEMPLATE_CHANNELS.filter((c) => c.id !== 'both')
              .map((c) => `<option value="${c.id}" ${channelFilter === c.id ? 'selected' : ''}>${e(c.label)}</option>`)
              .join('')}
          </select>
          <select id="templateLead">
            <option value="">Sin empresa (mostrar variables)</option>
            ${state.leads.map((l) => `<option value="${l.id}" ${leadId === l.id ? 'selected' : ''}>${e(l.company)}</option>`).join('')}
          </select>
          <span class="toolbar-summary">Variables: ${TEMPLATE_VARIABLES.map((v) => e(v)).join(' · ')}</span>
        </div>
        ${
          rows.length
            ? `<div class="template-grid">
                ${rows
                  .map((t) => {
                    const subject = leadId ? fillTemplate(t.subject, leadId) : t.subject;
                    const body = leadId ? fillTemplate(t.body, leadId) : t.body;
                    const showSubject = t.channel !== 'whatsapp';
                    if (leadId) {
                      return `<article class="template-card">
                        <div class="template-card-head"><h3>${e(t.name)}</h3><span class="badge">${e(channelLabel(t.channel))}</span></div>
                        ${showSubject ? `<p class="subject"><strong>Asunto:</strong> ${e(subject)}</p>` : ''}
                        <textarea data-template-body="${t.id}" rows="10" readonly>${e(body)}</textarea>
                        <div class="template-actions">
                          <button class="small-btn" data-action="copy-template" data-id="${t.id}">Copiar</button>
                          ${t.channel !== 'email' ? `<button class="small-btn" data-action="whatsapp-template" data-id="${t.id}">Abrir WhatsApp</button>` : ''}
                          ${t.channel !== 'whatsapp' ? `<button class="small-btn" data-action="mail-template" data-id="${t.id}">Abrir en correo</button>` : ''}
                        </div>
                      </article>`;
                    }
                    return `<article class="template-card">
                      <div class="template-card-head">
                        <input class="template-name" data-template-name="${t.id}" value="${e(t.name)}" placeholder="Nombre de la plantilla" />
                        <select class="template-channel" data-template-channel="${t.id}">
                          ${TEMPLATE_CHANNELS.map((c) => `<option value="${c.id}" ${t.channel === c.id ? 'selected' : ''}>${e(c.label)}</option>`).join('')}
                        </select>
                      </div>
                      <input class="template-subject" data-template-subject="${t.id}" value="${e(t.subject)}" placeholder="Asunto (solo correo, se ignora en WhatsApp)" />
                      <textarea data-template-body="${t.id}" rows="9">${e(body)}</textarea>
                      <div class="template-actions">
                        <button class="small-btn" data-action="save-template" data-id="${t.id}">Guardar cambios</button>
                        <button class="small-btn" data-action="copy-template" data-id="${t.id}">Copiar</button>
                        <button class="small-btn danger" data-action="delete-template" data-id="${t.id}">Eliminar</button>
                      </div>
                    </article>`;
                  })
                  .join('')}
              </div>`
            : empty('Sin plantillas para este canal', 'Cambia el filtro o crea una nueva plantilla.')
        }
      </div>
    </div>`;
}

/* ---------------- Ficha de la oportunidad ---------------- */

export function renderLeadDetail(id) {
  const l = getLead(id);
  if (!l) return empty('Oportunidad no encontrada', 'Puede haber sido eliminada.');
  const d = getDiscovery(id) || {};
  const acts = activitiesOf(id);
  const contacts = contactsOf(l);
  const sendable = contacts.filter((c) => c.email || c.phone);

  const row = (label, value) => (value ? `<div class="detail-row"><span>${e(label)}</span><strong>${e(value)}</strong></div>` : '');

  return `
    <div class="detail-grid">
      <section>
        <h4>Datos comerciales</h4>
        ${row('Etapa', l.stage)}
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
        ${row('Próxima acción', [l.nextAction, fmtDate(l.nextDate)].filter(Boolean).join(' · '))}
        ${l.notes ? `<p class="detail-notes">${e(l.notes)}</p>` : ''}
      </section>

      <section>
        <h4>Levantamiento</h4>
        ${
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
        <button class="small-btn" data-action="open-discovery" data-id="${l.id}">${d.pain ? 'Editar levantamiento' : 'Completar levantamiento'}</button>
      </section>

      <section>
        <h4>Recorrido por etapas</h4>
        <ol class="timeline">
          ${(l.stageHistory || [])
            .map((h, i, arr) => {
              const end = arr[i + 1]?.at;
              return `<li><strong>${e(h.stage)}</strong><span class="muted">${e(fmtDate(h.at))}${end ? ` · ${daysBetween(h.at, end)} días` : ''}</span></li>`;
            })
            .join('')}
        </ol>
      </section>

      <section>
        <h4>Actividades (${acts.length})</h4>
        ${
          acts.length
            ? `<div class="list">${acts
                .slice(0, 8)
                .map((a) => {
                  const contactName = a.contactId ? findContact(l, a.contactId)?.name : '';
                  return `<div class="list-item"><div><strong>${e(a.type)}${contactName ? ' · ' + e(contactName) : ''}</strong><div class="muted">${e(a.detail)}</div></div><span class="badge">${e(fmtDateTime(a.date))}</span></div>`;
                })
                .join('')}</div>`
            : '<p class="muted">Sin actividades registradas.</p>'
        }
        <button class="small-btn" data-action="new-activity" data-id="${l.id}">Registrar actividad</button>
      </section>

      <section>
        <h4>Contactos (${contacts.length})</h4>
        ${
          contacts.length
            ? `<div class="list">${contacts
                .map(
                  (c) => `<div class="list-item">
                    <div>
                      <strong>${e(c.name || 'Sin nombre')}</strong>${c.role ? `<span class="muted"> · ${e(c.role)}</span>` : ''}
                      <div class="muted">${e(c.email || '—')}${c.phone ? ` · ${e(c.phone)}` : ''}</div>
                    </div>
                    ${c.primary ? '<span class="badge">Principal</span>' : `<button class="small-btn danger" data-action="delete-contact" data-id="${l.id}" data-contact="${c.key}">Eliminar</button>`}
                  </div>`
                )
                .join('')}</div>`
            : '<p class="muted">Sin contactos registrados.</p>'
        }
        <button class="small-btn" data-action="add-contact" data-id="${l.id}">+ Agregar contacto</button>
      </section>

      <section>
        <h4>Comunicación</h4>
        ${
          sendable.length
            ? `<div class="comm-list">${sendable
                .map(
                  (c) => `<div class="comm-row">
                    <div class="comm-who"><strong>${e(c.name || 'Sin nombre')}</strong>${c.role ? `<span class="muted"> · ${e(c.role)}</span>` : ''}</div>
                    <div class="actions">
                      ${c.phone ? `<button class="small-btn" data-action="call-contact" data-id="${l.id}" data-contact="${c.key}">Llamar</button>` : ''}
                      ${c.phone ? `<button class="small-btn" data-action="open-whatsapp" data-id="${l.id}" data-contact="${c.key}">WhatsApp</button>` : ''}
                      ${c.email ? `<button class="small-btn" data-action="open-email" data-id="${l.id}" data-contact="${c.key}">Correo</button>` : ''}
                    </div>
                  </div>`
                )
                .join('')}</div>`
            : '<p class="muted">Agrega un email o teléfono a algún contacto para poder escribirle o llamarlo.</p>'
        }
      </section>
    </div>`;
}
