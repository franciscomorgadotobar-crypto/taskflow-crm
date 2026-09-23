import { isAdmin } from './auth.js';
import { getLead } from './store.js';
import { supabase } from './supabase.js';
import { escapeHtml as e, fmtDateTime } from './utils.js';

export const auditState = {
  entries: [],
  loading: false,
  schemaReady: true,
  filters: { query: '', entity: '', action: '' }
};

const listeners = new Set();
export const onAuditChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const notify = () => listeners.forEach((fn) => fn(auditState));

const ENTITY_LABEL = {
  leads: 'Oportunidad',
  activities: 'Actividad',
  discoveries: 'Levantamiento',
  quotes: 'Cotización',
  hyperfocus_campaigns: 'Campaña Híper Foco',
  profiles: 'Usuario'
};

const ACTION_LABEL = {
  insert: 'Creó',
  update: 'Modificó',
  delete: 'Eliminó'
};

function schemaMissing(error) {
  const msg = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return msg.includes('42p01') || msg.includes('pgrst205') || msg.includes('audit_log');
}

export async function hydrateAudit() {
  if (!isAdmin()) {
    auditState.entries = [];
    auditState.loading = false;
    notify();
    return;
  }

  auditState.loading = true;
  notify();

  const { data, error } = await supabase
    .from('audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);

  auditState.loading = false;

  if (error) {
    if (schemaMissing(error)) {
      auditState.schemaReady = false;
      auditState.entries = [];
      notify();
      return;
    }
    console.error('No se pudo cargar la auditoría', error);
    notify();
    return;
  }

  auditState.schemaReady = true;
  auditState.entries = data || [];
  notify();
}

export function clearAudit() {
  auditState.entries = [];
  auditState.loading = false;
  auditState.filters = { query: '', entity: '', action: '' };
  notify();
}

export function setAuditFilter(field, value) {
  if (!(field in auditState.filters)) return;
  auditState.filters[field] = value;
}

function entityName(row) {
  if (row.lead_id) {
    const lead = getLead(row.lead_id);
    if (lead?.company) return lead.company;
  }
  const data = row.after_data && Object.keys(row.after_data).length ? row.after_data : row.before_data || {};
  return data.company || data.name || data.email || data.client_snapshot?.company || '';
}

function changedSummary(row) {
  if (row.action !== 'update') return '';
  const fields = row.changed_fields || [];
  if (!fields.length) return 'Sin campos visibles';
  return fields.slice(0, 6).join(', ') + (fields.length > 6 ? ` +${fields.length - 6}` : '');
}

function filteredEntries() {
  const f = auditState.filters;
  const q = String(f.query || '').trim().toLocaleLowerCase('es');
  return auditState.entries.filter((row) => {
    if (f.entity && row.entity_type !== f.entity) return false;
    if (f.action && row.action !== f.action) return false;
    if (!q) return true;
    const haystack = [
      row.actor_name,
      ENTITY_LABEL[row.entity_type] || row.entity_type,
      ACTION_LABEL[row.action] || row.action,
      entityName(row),
      ...(row.changed_fields || [])
    ].join(' ').toLocaleLowerCase('es');
    return haystack.includes(q);
  });
}

export function renderAudit() {
  if (!isAdmin()) {
    return '<div class="card"><div class="card-body"><div class="empty"><strong>Acceso restringido</strong><p>La auditoría está disponible para administradores.</p></div></div></div>';
  }

  if (!auditState.schemaReady) {
    return '<div class="card"><div class="card-body"><div class="notice warn">Falta aplicar la migración <strong>supabase/0027_audit_log.sql</strong>.</div></div></div>';
  }

  const rows = filteredEntries();
  const entityOptions = Object.entries(ENTITY_LABEL)
    .map(([value, label]) => `<option value="${e(value)}" ${auditState.filters.entity === value ? 'selected' : ''}>${e(label)}</option>`)
    .join('');

  return `
    <div class="card">
      <div class="card-head">
        <div><h3>Auditoría de cambios</h3><div class="muted">Quién cambió qué, cuándo y sobre qué registro.</div></div>
        <button class="small-btn" data-action="refresh-audit">Actualizar</button>
      </div>
      <div class="card-body">
        <div class="toolbar">
          <input id="auditQuery" placeholder="Buscar empresa, usuario o campo…" value="${e(auditState.filters.query)}" />
          <select id="auditEntity"><option value="">Todas las entidades</option>${entityOptions}</select>
          <select id="auditAction">
            <option value="">Todas las acciones</option>
            <option value="insert" ${auditState.filters.action === 'insert' ? 'selected' : ''}>Creó</option>
            <option value="update" ${auditState.filters.action === 'update' ? 'selected' : ''}>Modificó</option>
            <option value="delete" ${auditState.filters.action === 'delete' ? 'selected' : ''}>Eliminó</option>
          </select>
          <span class="toolbar-summary">${rows.length} de ${auditState.entries.length}</span>
        </div>

        ${auditState.loading
          ? '<div class="empty"><strong>Cargando auditoría…</strong></div>'
          : rows.length
            ? `<div class="table-wrap"><table class="data-table audit-table">
                <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Registro</th><th>Cambios</th></tr></thead>
                <tbody>
                  ${rows.map((row) => `<tr>
                    <td>${e(fmtDateTime(row.created_at))}</td>
                    <td>${e(row.actor_name || 'Sistema')}</td>
                    <td><span class="badge ${row.action === 'delete' ? 'danger' : row.action === 'insert' ? 'success' : ''}">${e(ACTION_LABEL[row.action] || row.action)}</span></td>
                    <td>${e(ENTITY_LABEL[row.entity_type] || row.entity_type)}</td>
                    <td>${e(entityName(row) || row.entity_id || '—')}</td>
                    <td><span class="muted">${e(changedSummary(row) || '—')}</span></td>
                  </tr>`).join('')}
                </tbody>
              </table></div>`
            : '<div class="empty"><strong>Sin resultados</strong><p>No hay movimientos que coincidan con los filtros.</p></div>'}
      </div>
    </div>`;
}
