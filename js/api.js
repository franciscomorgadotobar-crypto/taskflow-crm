import { state, replaceState, persist } from './store.js';
import { debounce, nowISO } from './utils.js';

const CFG = window.TASKFLOW_CRM_CONFIG;
const AUTO_KEY = 'taskflow-crm-autosync';

export const isConfigured = () => Boolean(CFG.apiUrl);
export const autoSyncEnabled = () => isConfigured() && localStorage.getItem(AUTO_KEY) === 'on';
export const setAutoSync = (on) => localStorage.setItem(AUTO_KEY, on ? 'on' : 'off');

const statusListeners = new Set();
export const onStatus = (fn) => (statusListeners.add(fn), () => statusListeners.delete(fn));
let status = { state: 'idle', message: 'Solo local' };
export const getStatus = () => status;

function setStatus(next) {
  status = next;
  statusListeners.forEach((fn) => fn(status));
}

async function request(payload, method = 'POST') {
  if (!isConfigured()) throw new Error('Falta apiUrl en config.js');
  const url = method === 'GET' ? `${CFG.apiUrl}?action=${encodeURIComponent(payload.action)}` : CFG.apiUrl;
  const init =
    method === 'GET'
      ? { method: 'GET' }
      : {
          method: 'POST',
          // text/plain evita el preflight CORS que Apps Script no responde.
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        };

  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (!body.ok) throw new Error(body.error || 'Error del backend');
  return body;
}

export async function health() {
  setStatus({ state: 'syncing', message: 'Verificando conexión…' });
  try {
    await request({ action: 'health' }, 'GET');
    setStatus({ state: 'ok', message: 'Backend conectado' });
    return true;
  } catch (err) {
    setStatus({ state: 'error', message: `Sin conexión: ${err.message}` });
    return false;
  }
}

/** Trae la planilla y reemplaza el estado local. */
export async function pull() {
  setStatus({ state: 'syncing', message: 'Descargando…' });
  const body = await request({ action: 'list' }, 'GET');
  replaceState({ ...body.data, templates: state.templates, meta: { ...state.meta, lastSyncAt: nowISO() } });
  setStatus({ state: 'ok', message: 'Datos descargados' });
  return body.data;
}

/** Envía el estado local completo a la planilla. */
export async function push() {
  setStatus({ state: 'syncing', message: 'Subiendo…' });
  await request({
    action: 'replaceAll',
    data: { leads: state.leads, discoveries: state.discoveries, activities: state.activities, files: state.files }
  });
  state.meta.lastSyncAt = nowISO();
  persist({ silent: true });
  setStatus({ state: 'ok', message: 'Sincronizado' });
}

export const queuePush = debounce(async () => {
  if (!autoSyncEnabled()) return;
  try {
    await push();
  } catch (err) {
    setStatus({ state: 'error', message: `No se pudo sincronizar: ${err.message}` });
  }
}, 1500);
