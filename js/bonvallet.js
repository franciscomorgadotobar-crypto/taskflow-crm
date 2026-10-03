import { metrics, onChange } from './store.js?v=2026-09-28dn';
import { onAuthChange, session } from './auth.js?v=2026-09-28dn';

const AVATARS = {
  neutral: 'https://s.t13.cl/sites/default/files/styles/manualcrop_1600x800/public/t13/field-imagen/2015-09/1442590410-auno1203211dea4.jpg.jpeg?itok=_CMLOtE2',
  serious: 'https://static.emol.cl/emol50/fotos/2015/09/18/file_20150918122059.jpg',
  ironic: 'https://img.soy-chile.cl/Fotos/2016/12/26/file_20161226184555.jpg'
};

const QUOTES = {
  neutral: 'Créete el cuento chileno',
  good: 'Ya te creíste el cuento chileno',
  overdue: '¡Levántate chileno!',
  stale: 'Avíspate reweón, avíspate, ¡grita!',
  lost: 'Es bueno conocer la derrota'
};

let hideTimer = null;
let snapshot = null;
let lastShownAt = 0;
let startupShownForUser = '';

function ensureHost() {
  let host = document.getElementById('bonvalletMessage');
  if (host) return host;

  host = document.createElement('aside');
  host.id = 'bonvalletMessage';
  host.className = 'bonvallet-message';
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');
  host.setAttribute('aria-atomic', 'true');
  host.hidden = true;
  host.innerHTML = `
    <img class="bonvallet-message__avatar" alt="" referrerpolicy="no-referrer" />
    <div class="bonvallet-message__content">
      <div class="bonvallet-message__meta">
        <strong>Eduardo Bonvallet</strong>
        <span>ahora</span>
      </div>
      <p class="bonvallet-message__text"></p>
    </div>
  `;
  document.body.append(host);
  return host;
}

function capture(m) {
  return {
    won: m?.won?.length || 0,
    lost: m?.lost?.length || 0,
    overdue: m?.overdue?.length || 0,
    stale: m?.stale?.length || 0
  };
}

function startupMessage(m) {
  const s = capture(m);
  if (s.overdue >= 5) return { mood: 'serious', text: QUOTES.overdue };
  if (s.stale >= 3) return { mood: 'ironic', text: QUOTES.stale };
  if (s.won > 0 && s.overdue === 0 && s.stale === 0) {
    return { mood: 'neutral', text: QUOTES.good };
  }
  return { mood: 'neutral', text: QUOTES.neutral };
}

export function showBonvalletMessage({ text, mood = 'neutral', duration = 7000, force = false }) {
  if (!text || session.status !== 'signed-in') return;

  const now = Date.now();
  if (!force && now - lastShownAt < 8000) return;

  const host = ensureHost();
  const avatar = host.querySelector('.bonvallet-message__avatar');
  const message = host.querySelector('.bonvallet-message__text');

  avatar.src = AVATARS[mood] || AVATARS.neutral;
  avatar.onerror = () => {
    if (avatar.src !== AVATARS.neutral) avatar.src = AVATARS.neutral;
  };
  message.textContent = text;

  clearTimeout(hideTimer);
  host.dataset.mood = mood;
  host.hidden = false;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => host.classList.add('is-visible'));
  });

  lastShownAt = now;
  hideTimer = setTimeout(() => {
    host.classList.remove('is-visible');
    setTimeout(() => {
      if (!host.classList.contains('is-visible')) host.hidden = true;
    }, 280);
  }, duration);
}

export function startBonvallet(m = metrics()) {
  snapshot = capture(m);
  showBonvalletMessage({ ...startupMessage(m), duration: 7600, force: true });
}

export function syncBonvallet(m = metrics()) {
  const next = capture(m);

  if (!snapshot) {
    snapshot = next;
    return;
  }

  let message = null;
  if (next.won > snapshot.won) {
    message = { mood: 'neutral', text: QUOTES.good };
  } else if (next.lost > snapshot.lost) {
    message = { mood: 'serious', text: QUOTES.lost };
  } else if (next.overdue > snapshot.overdue && next.overdue >= 3) {
    message = { mood: 'serious', text: QUOTES.overdue };
  } else if (next.stale > snapshot.stale && next.stale >= 2) {
    message = { mood: 'ironic', text: QUOTES.stale };
  }

  snapshot = next;
  if (message) showBonvalletMessage(message);
}

export function resetBonvallet() {
  snapshot = null;
  lastShownAt = 0;
  startupShownForUser = '';
  clearTimeout(hideTimer);

  const host = document.getElementById('bonvalletMessage');
  if (host) {
    host.classList.remove('is-visible');
    host.hidden = true;
  }
}

function showStartupOnce() {
  const userId = session.user?.id || '';
  if (session.status !== 'signed-in' || !userId || startupShownForUser === userId) return;

  startupShownForUser = userId;
  window.setTimeout(() => {
    if (session.status !== 'signed-in' || session.user?.id !== userId) return;
    startBonvallet(metrics());
  }, 850);
}

onChange(() => {
  if (session.status !== 'signed-in') return;
  if (!startupShownForUser) {
    showStartupOnce();
    return;
  }
  syncBonvallet(metrics());
});

onAuthChange((auth) => {
  if (auth.status === 'signed-in') {
    showStartupOnce();
  } else if (auth.status === 'signed-out' || auth.status === 'profile-error') {
    resetBonvallet();
  }
});

if (session.status === 'signed-in') showStartupOnce();
