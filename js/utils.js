export const $ = (id) => document.getElementById(id);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const escapeHtml = (str) =>
  String(str ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

export const fmtMoney = (n) =>
  new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(n || 0));

export const fmtNumber = (n) => new Intl.NumberFormat('es-CL').format(Number(n || 0));

/** Montos del cotizador: UF con 2 decimales (hasta 4 si el precio los trae) o CLP sin decimales. */
export const fmtAmount = (n, currency = 'UF') =>
  currency === 'CLP'
    ? fmtMoney(n)
    : new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(n || 0));

export const todayISO = () => new Date().toISOString().slice(0, 10);

/** Suma días a una fecha ISO (YYYY-MM-DD). */
export function addDaysISO(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// UUID v4: los registros viven en columnas `uuid` de Postgres, así que el id se
// genera en el cliente con el mismo formato que usará la base (permite mostrar el
// registro al instante sin esperar la respuesta de red — ver js/store.js).
export const uid = () => crypto.randomUUID();

export const nowISO = () => new Date().toISOString();

export function daysBetween(fromISO, toISO = nowISO()) {
  const a = new Date(fromISO).getTime();
  const b = new Date(toISO).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

export function fmtDate(value) {
  if (!value) return '';
  const d = new Date(String(value).length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function localDateTimeInput(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/**
 * Abre un enlace de sistema (mailto:, tel:) sin sacar al usuario del CRM.
 * Con `location.href` el navegador navega la propia pestaña; con un enlace
 * temporal a _blank el handler del sistema recibe la orden y la pantalla queda igual.
 */
export function openExternal(url) {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

let toastTimer = null;
export function toast(message, kind = 'info') {
  const el = $('toast');
  if (!el) return;
  // Un <dialog> modal se dibuja en la capa superior del navegador, así que un aviso
  // que vive en <body> queda tapado por el diálogo: el usuario aprieta un botón, la
  // acción falla y no ve nada. Por eso el aviso se muda al diálogo que esté abierto.
  const host = [...document.querySelectorAll('dialog[open]')].pop() || document.body;
  if (el.parentElement !== host) host.appendChild(el);
  el.textContent = message;
  el.dataset.kind = kind;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 3200);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function debounce(fn, ms = 600) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
