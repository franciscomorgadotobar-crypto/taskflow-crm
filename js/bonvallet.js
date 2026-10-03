const AVATARS = {
  neutral: 'https://www.chilevision.cl/chilevision/site/artic/20140206/imag/foto_0000000120140206172849.jpg',
  serious: 'https://media.pauta.cl/2023/10/A_UNO_120316-1024x683.jpg',
  ironic: 'https://img.soy-chile.cl/Fotos/2016/12/26/file_20161226184555.jpg'
};

const STARTUP_QUOTES = {
  neutral: 'Créete el cuento chileno',
  good: 'Ya te creíste el cuento chileno',
  overdue: '¡Levántate chileno!',
  stale: 'Avíspate reweón, avíspate, ¡grita!'
};

let hideTimer = null;
let snapshot = null;
let lastShownAt = 0;

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
    <img class="bonvallet-message__avatar" alt="" />
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
  if (s.overdue >= 5) return { mood: 'serious', text: STARTUP_QUOTES.overdue };
  if (s.stale >= 3) return { mood: 'serious', text: STARTUP_QUOTES.stale };
  if (s.won > 0 && s.overdue === 0 && s.stale === 0) return { mood: 'neutral', text: STARTUP_QUOTES.good };
  return { mood: 'neutral', text: STARTUP_QUOTES.neutral };
}

export function showBonvalletMessage({ text, mood = 'neutral', duration = 7000, force = false }) {
  if (!text) return;
  const now = Date.now();
  if (!force && now - lastShownAt < 8000) return;

  const host = ensureHost();
  const avatar = host.querySelector('.bonvallet-message__avatar');
  const message = host.querySelector('.bonvallet-message__text');

  avatar.src = AVATARS[mood] || AVATARS.neutral;
  avatar.dataset.mood = mood;
  message.textContent = text;

  clearTimeout(hideTimer);
  host.hidden = false;
  host.dataset.mood = mood;
  requestAnimationFrame(() => host.classList.add('is-visible'));
  lastShownAt = now;

  hideTimer = setTimeout(() => {
    host.classList.remove('is-visible');
    setTimeout(() => {
      if (!host.classList.contains('is-visible')) host.hidden = true;
    }, 260);
  }, duration);
}

export function startBonvallet(metrics) {
  snapshot = capture(metrics);
  showBonvalletMessage({ ...startupMessage(metrics), duration: 7600, force: true });
}

export function syncBonvallet(metrics) {
  const next = capture(metrics);
  if (!snapshot) {
    snapshot = next;
    return;
  }

  let message = null;
  if (next.won > snapshot.won) {
    message = { mood: 'neutral', text: STARTUP_QUOTES.good };
  } else if (next.lost > snapshot.lost) {
    message = { mood: 'serious', text: 'Es bueno conocer la derrota' };
  } else if (next.overdue > snapshot.overdue && next.overdue >= 3) {
    message = { mood: 'serious', text: STARTUP_QUOTES.overdue };
  } else if (next.stale > snapshot.stale && next.stale >= 2) {
    message = { mood: 'ironic', text: STARTUP_QUOTES.stale };
  }

  snapshot = next;
  if (message) showBonvalletMessage(message);
}

export function resetBonvallet() {
  snapshot = null;
  lastShownAt = 0;
  clearTimeout(hideTimer);
  const host = document.getElementById('bonvalletMessage');
  if (host) {
    host.classList.remove('is-visible');
    host.hidden = true;
  }
}
