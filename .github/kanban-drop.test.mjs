import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

// Simula el mismo drag/drop del Kanban en vez de probar únicamente el texto.
// No utiliza Supabase ni toca oportunidades reales.
const source = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
const start = source.indexOf('function bindKanbanDrag() {');
const end = source.indexOf('/* ---------- Tipo de tarea ---------- */', start);
assert.ok(start !== -1 && end > start, 'No se encontró el controlador Kanban.');

async function simulate({ origin = 'Contactado', target = 'Perdido', allowed = true,
                          readonly = false, exists = true, success = true } = {}) {
  const eventsCard = new Map();
  const eventsColumn = new Map();
  const lead = exists ? { id: 'lead-test', company: 'Empresa de prueba', stage: origin } : null;
  const changes = [];
  const messages = [];
  let modalCalls = 0;
  let prevented = false;

  const card = {
    dataset: { id: 'lead-test' },
    classList: { add() {}, remove() {} },
    addEventListener: (event, callback) => eventsCard.set(event, callback)
  };
  const column = {
    dataset: { stage: target },
    classList: { add() {}, remove() {} },
    addEventListener: (event, callback) => eventsColumn.set(event, callback)
  };
  const ctx = {
    $$: (selector) => selector === '.deal-card' ? [card]
      : selector === '.kanban-list' ? [column] : [],
    isReadOnly: () => readonly,
    canEditLeadLocally: () => allowed,
    getLead: () => lead,
    openStage: () => { modalCalls++; },
    setStage: async (id, newStage) => {
      changes.push([id, newStage]);
      if (!success) return null;
      lead.stage = newStage;
      return lead;
    },
    toast: (message, type) => messages.push({ message, type })
  };

  runInNewContext(source.slice(start, end) + '\nbindKanbanDrag();', ctx);
  eventsCard.get('dragstart')({ dataTransfer: { effectAllowed: '' } });
  await eventsColumn.get('drop')({ preventDefault: () => { prevented = true; } });
  return { lead, changes, messages, modalCalls, prevented };
}

const lost = await simulate({ origin: 'Contactado', target: 'Perdido' });
assert.equal(lost.prevented, true);
assert.equal(lost.modalCalls, 0, 'Arrastrar a Perdido no debe abrir el diálogo.');
assert.equal(lost.lead.stage, 'Perdido');
assert.deepEqual(lost.changes, [['lead-test','Perdido']]);
assert.match(lost.messages[0].message, /Empresa de prueba → Perdido/);

// El resto de las etapas siguen actualizándose directamente.
for (const stage of ['Reunión / Demo', 'Propuesta', 'Ganado', 'Remarketing']) {
  const outcome = await simulate({ target: stage });
  assert.equal(outcome.modalCalls, 0);
  assert.equal(outcome.lead.stage, stage);
  assert.equal(outcome.changes.length, 1);
}
// Mismo destino: no guardar ni notificar un movimiento inexistente.
assert.equal((await simulate({ origin: 'Perdido', target: 'Perdido' })).changes.length, 0);
// Respeta permisos, modo lectura y errores de persistencia.
assert.equal((await simulate({ allowed: false })).changes.length, 0);
assert.equal((await simulate({ readonly: true })).changes.length, 0);
assert.equal((await simulate({ exists: false })).changes.length, 0);
const error = await simulate({ success: false });
assert.equal(error.changes.length, 1);
assert.equal(error.messages.length, 0, 'No confirmar movimiento que no se guardó.');

// El botón «Mover» sigue abriendo el editor para cambio manual con motivo.
assert.match(source, /'move-stage':\s*\(id\)\s*=>\s*openStage\(id\)/);
console.log('KANBAN DIRECT DROP PASS: Perdido sin diálogo y botón Mover conservado');
