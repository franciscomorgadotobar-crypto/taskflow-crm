/**
 * OBSOLETO — TaskFlow CRM migró su backend a Supabase (Postgres + Auth + RLS).
 * Este script de Google Sheets/Apps Script ya no se usa y se mantiene solo
 * como referencia histórica. No requiere despliegue ni mantención.
 *
 * TaskFlow CRM — backend Google Sheets + Apps Script.
 *
 * Las cabeceras usan exactamente las mismas claves que el frontend (js/store.js),
 * por lo que no hay traducción de campos en ningún punto del flujo.
 *
 * Despliegue:
 *   1. Extensiones > Apps Script en una Google Sheet nueva.
 *   2. Pegar este archivo y ejecutar setupTaskFlowCRM() una vez.
 *   3. Implementar > Nueva implementación > Aplicación web.
 *      - Ejecutar como: yo
 *      - Con acceso: cualquier persona (la URL actúa como credencial)
 *   4. Copiar la URL /exec en apiUrl dentro de config.js.
 */

const TFCRM = {
  SHEETS: {
    LEADS: 'Leads',
    DISCOVERY: 'Levantamientos',
    ACTIVITIES: 'Actividades',
    FILES: 'Archivos'
  },
  HEADERS: {
    Leads: ['id', 'company', 'rut', 'industry', 'source', 'contact', 'role', 'email', 'phone', 'stage', 'priority',
      'value', 'probability', 'expectedCloseDate', 'nextAction', 'nextDate', 'owner', 'lossReason', 'notes',
      'stageHistory', 'createdAt', 'updatedAt'],
    Levantamientos: ['leadId', 'pain', 'currentManagement', 'technicians', 'locations', 'buyTrigger', 'modules',
      'integrations', 'successCriteria', 'technicalNotes', 'updatedAt'],
    Actividades: ['id', 'leadId', 'type', 'date', 'owner', 'detail', 'commitment'],
    Archivos: ['id', 'leadId', 'type', 'name', 'url', 'date']
  },
  // Campos que viajan como JSON dentro de una celda.
  JSON_FIELDS: ['stageHistory'],
  // Campos de lista separados por "|" para que sigan siendo legibles en la planilla.
  LIST_FIELDS: ['modules'],
  NUMBER_FIELDS: ['value', 'probability']
};

function setupTaskFlowCRM() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(TFCRM.HEADERS).forEach(function (name) {
    ensureSheet_(ss, name, TFCRM.HEADERS[name]);
  });
  return 'TaskFlow CRM configurado';
}

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'health';
  try {
    if (action === 'health') return json_({ ok: true, app: 'TaskFlow CRM', at: new Date().toISOString() });
    if (action === 'list') return json_({ ok: true, data: listAll_() });
    throw new Error('Acción GET no soportada: ' + action);
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action === 'replaceAll') {
      replaceAll_(body.data || {});
      return json_({ ok: true, at: new Date().toISOString() });
    }
    if (body.action === 'upsertLead') {
      upsertLead_(body.lead || {});
      return json_({ ok: true });
    }
    throw new Error('Acción POST no soportada: ' + body.action);
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function listAll_() {
  return {
    leads: readSheet_(TFCRM.SHEETS.LEADS),
    discoveries: discoveryMap_(),
    activities: readSheet_(TFCRM.SHEETS.ACTIVITIES),
    files: readSheet_(TFCRM.SHEETS.FILES)
  };
}

function replaceAll_(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    writeSheet_(TFCRM.SHEETS.LEADS, data.leads || []);
    const discoveries = data.discoveries || {};
    writeSheet_(
      TFCRM.SHEETS.DISCOVERY,
      Object.keys(discoveries).map(function (leadId) {
        const row = { leadId: leadId };
        Object.keys(discoveries[leadId]).forEach(function (k) { row[k] = discoveries[leadId][k]; });
        return row;
      })
    );
    writeSheet_(TFCRM.SHEETS.ACTIVITIES, data.activities || []);
    writeSheet_(TFCRM.SHEETS.FILES, data.files || []);
  } finally {
    lock.releaseLock();
  }
}

function upsertLead_(lead) {
  if (!lead.id) throw new Error('El lead no trae id');
  const leads = readSheet_(TFCRM.SHEETS.LEADS);
  const idx = leads.findIndex(function (l) { return String(l.id) === String(lead.id); });
  if (idx >= 0) leads[idx] = lead; else leads.push(lead);
  writeSheet_(TFCRM.SHEETS.LEADS, leads);
}

/* ---------- Utilidades de planilla ---------- */

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}

function sheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Falta la hoja ' + name + '. Ejecuta setupTaskFlowCRM().');
  return sh;
}

function readSheet_(name) {
  const sh = sheet_(name);
  if (sh.getLastRow() < 2) return [];
  const values = sh.getDataRange().getValues();
  const headers = values.shift().map(String);
  return values
    .filter(function (row) { return row.some(function (v) { return v !== '' && v !== null; }); })
    .map(function (row) {
      const obj = {};
      headers.forEach(function (h, i) { obj[h] = parseCell_(h, row[i]); });
      return obj;
    });
}

function writeSheet_(name, objects) {
  const sh = sheet_(name);
  const headers = TFCRM.HEADERS[name];
  ensureSheet_(SpreadsheetApp.getActive(), name, headers);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).clearContent();
  if (!objects.length) return;
  const rows = objects.map(function (obj) {
    return headers.map(function (h) { return serializeCell_(h, obj[h]); });
  });
  sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

function serializeCell_(header, value) {
  if (value === undefined || value === null) return '';
  if (TFCRM.JSON_FIELDS.indexOf(header) >= 0) return JSON.stringify(value || []);
  if (TFCRM.LIST_FIELDS.indexOf(header) >= 0) return Array.isArray(value) ? value.join('|') : String(value);
  if (value instanceof Date) return value.toISOString();
  return value;
}

function parseCell_(header, value) {
  if (TFCRM.JSON_FIELDS.indexOf(header) >= 0) {
    if (!value) return [];
    try { return JSON.parse(value); } catch (err) { return []; }
  }
  if (TFCRM.LIST_FIELDS.indexOf(header) >= 0) {
    if (!value) return [];
    return String(value).split('|').filter(String);
  }
  if (TFCRM.NUMBER_FIELDS.indexOf(header) >= 0) return value === '' ? 0 : Number(value);
  if (value instanceof Date) return value.toISOString();
  return value === null ? '' : value;
}

function discoveryMap_() {
  const rows = readSheet_(TFCRM.SHEETS.DISCOVERY);
  const out = {};
  rows.forEach(function (row) {
    const id = String(row.leadId || '');
    if (!id) return;
    const copy = {};
    Object.keys(row).forEach(function (k) { if (k !== 'leadId') copy[k] = row[k]; });
    out[id] = copy;
  });
  return out;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
