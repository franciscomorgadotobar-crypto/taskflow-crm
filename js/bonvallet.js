import { metrics, onChange } from './store.js';
import { onAuthChange, session } from './auth.js';

const AVATARS = {
  neutral: 'https://s.t13.cl/sites/default/files/styles/manualcrop_1600x800/public/t13/field-imagen/2015-09/1442590410-auno1203211dea4.jpg.jpeg?itok=_CMLOtE2',
  serious: 'https://static.emol.cl/emol50/fotos/2015/09/18/file_20150918122059.jpg',
  ironic: 'https://img.soy-chile.cl/Fotos/2016/12/26/file_20161226184555.jpg'
};

// Frases textuales documentadas de Eduardo Bonvallet.
// No se generan paráfrasis "al estilo de": la mascota rota únicamente citas verificadas.
const QUOTES = {
  arenga: [
    { mood: 'serious', text: '¡Levántate chileno!' },
    { mood: 'neutral', text: 'Créete el cuento chileno.' },
    { mood: 'neutral', text: 'Ya te creíste el cuento chileno.' },
    { mood: 'ironic', text: 'Avíspate reweón, avíspate, ¡grita!' },
    { mood: 'serious', text: 'Sal a la calle a luchar.' },
    { mood: 'serious', text: 'Para ser campeones, para ganar hay que ser guerrero, fakir y monje.' },
    { mood: 'serious', text: 'Ir de frente.' }
  ],
  levantarse: [
    { mood: 'serious', text: 'Es bueno conocer la derrota.' },
    { mood: 'serious', text: 'A los grandes hombres las derrotas los hacen más grandes, pero primero hay que levantarse.' },
    { mood: 'serious', text: 'Nunca se tiene que perder la dignidad, la fortaleza. Hay que luchar contra el dolor.' },
    { mood: 'neutral', text: 'Me tuvo mal, pero me estoy levantando.' }
  ],
  foco: [
    { mood: 'neutral', text: 'Mira el horizonte.' },
    { mood: 'ironic', text: 'Las águilas no cazan moscas.' },
    { mood: 'serious', text: 'Monje, fakir o guerrero, o sencillamente te pierdes.' },
    { mood: 'neutral', text: 'No debe precipitarse, debe tomarse todo el tiempo del mundo.' },
    { mood: 'neutral', text: 'Tiene que aprender a escuchar.' }
  ],
  confianza: [
    { mood: 'neutral', text: 'Créete el cuento chileno.' },
    { mood: 'neutral', text: 'Ya te creíste el cuento chileno.' },
    { mood: 'ironic', text: 'Soy tu sensei, tu Dalai Lama, soy el mejor, soy el Gurú.' }
  ],
  humor: [
    { mood: 'neutral', text: 'Diviértanse, yo sólo pienso.' },
    { mood: 'ironic', text: 'Me llevo toda la audiencia porque soy un genio.' },
    { mood: 'ironic', text: 'Soy un todo.' },
    { mood: 'ironic', text: 'Yo soy el genio de la historia en este país.' }
  ]
};

const ALL_QUOTES = [...new Map(
  Object.values(QUOTES)
    .flat()
    .map((quote) => [quote.text, quote])
).values()];

let hideTimer = null;
let rotationTimer = null;
let snapshot = null;
let lastShownAt = 0;
let startupShownForUser = '';
let recentQuotes = [];

const MASCOT_PREF_PREFIX = 'taskflow.crm.mascot.enabled';

function mascotPreferenceKey() {
  return `${MASCOT_PREF_PREFIX}:${session.user?.id || 'default'}`;
}

export function isBonvalletEnabled() {
  try {
    return localStorage.getItem(mascotPreferenceKey()) !== '0';
  } catch {
    return true;
  }
}

function writeBonvalletPreference(enabled) {
  try {
    localStorage.setItem(mascotPreferenceKey(), enabled ? '1' : '0');
  } catch {
    // La preferencia visual no debe impedir el uso del CRM.
  }
}

function hideBonvallet({ immediate = false } = {}) {
  clearTimeout(hideTimer);
  const host = document.getElementById('bonvalletMessage');
  if (!host) return;

  host.classList.remove('is-visible');
  if (immediate) {
    host.hidden = true;
    return;
  }

  window.setTimeout(() => {
    if (!host.classList.contains('is-visible')) host.hidden = true;
  }, 380);
}

export function setBonvalletEnabled(enabled) {
  const next = Boolean(enabled);
  writeBonvalletPreference(next);

  if (!next) {
    snapshot = null;
    startupShownForUser = '';
    clearRotationTimer();
    hideBonvallet();
    return;
  }

  snapshot = null;
  startupShownForUser = '';
  showStartupOnce();
}

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
    stale: m?.stale?.length || 0,
    open: m?.open?.length || 0
  };
}

function rememberQuote(text) {
  recentQuotes = [text, ...recentQuotes.filter((item) => item !== text)].slice(0, 5);
}

function pickFromQuotes(quotes = []) {
  const candidates = quotes.filter((quote) => !recentQuotes.includes(quote.text));
  const pool = candidates.length ? candidates : quotes;
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickGeneralQuote() {
  const roll = Math.random();
  if (roll < 0.34) return pickFromQuotes(QUOTES.arenga);
  if (roll < 0.58) return pickFromQuotes(QUOTES.confianza);
  if (roll < 0.82) return pickFromQuotes(QUOTES.foco);
  if (roll < 0.94) return pickFromQuotes(QUOTES.levantarse);
  return pickFromQuotes(QUOTES.humor);
}

function rotatingMessage(m = metrics()) {
  const state = capture(m);

  if (state.overdue > 0 && Math.random() < 0.68) {
    return pickFromQuotes([...QUOTES.arenga, ...QUOTES.levantarse]) || pickGeneralQuote();
  }
  if (state.stale > 0 && Math.random() < 0.68) {
    return pickFromQuotes(QUOTES.foco) || pickGeneralQuote();
  }
  if (state.won > 0 && Math.random() < 0.55) {
    return pickFromQuotes(QUOTES.confianza) || pickGeneralQuote();
  }

  return pickGeneralQuote() || ALL_QUOTES[0];
}

function clearRotationTimer() {
  clearTimeout(rotationTimer);
  rotationTimer = null;
}

function scheduleBonvalletRotation({ sooner = false } = {}) {
  clearRotationTimer();
  if (!isBonvalletEnabled() || session.status !== 'signed-in') return;

  const delay = sooner ? 42000 : 76000;
  rotationTimer = window.setTimeout(() => {
    if (document.visibilityState === 'visible' && session.status === 'signed-in' && isBonvalletEnabled()) {
      showBonvalletMessage({ ...rotatingMessage(metrics()), duration: 6200 });
    }
    scheduleBonvalletRotation();
  }, delay);
}

function startupMessage(m) {
  const state = capture(m);
  if (state.overdue > 0) return pickFromQuotes([...QUOTES.arenga, ...QUOTES.levantarse]) || ALL_QUOTES[0];
  if (state.stale > 0) return pickFromQuotes(QUOTES.foco) || ALL_QUOTES[0];
  if (state.won > 0) return pickFromQuotes(QUOTES.confianza) || ALL_QUOTES[0];
  return rotatingMessage(m);
}

export function showBonvalletMessage({ text, mood = 'neutral', duration = 7000, force = false }) {
  if (!text || session.status !== 'signed-in' || !isBonvalletEnabled()) return;

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
  rememberQuote(text);
  hideTimer = setTimeout(() => {
    hideBonvallet();
  }, duration);
}

export function startBonvallet(m = metrics()) {
  snapshot = capture(m);
  showBonvalletMessage({ ...startupMessage(m), duration: 7000, force: true });
  scheduleBonvalletRotation({ sooner: true });
}

export function syncBonvallet(m = metrics()) {
  const next = capture(m);

  if (!snapshot) {
    snapshot = next;
    return;
  }

  let message = null;
  if (next.won > snapshot.won) {
    message = pickFromQuotes(QUOTES.confianza);
  } else if (next.lost > snapshot.lost) {
    message = pickFromQuotes(QUOTES.levantarse);
  } else if (next.overdue > snapshot.overdue) {
    message = pickFromQuotes([...QUOTES.arenga, ...QUOTES.levantarse]);
  } else if (next.stale > snapshot.stale) {
    message = pickFromQuotes(QUOTES.foco);
  }

  snapshot = next;
  if (message) {
    showBonvalletMessage(message);
    scheduleBonvalletRotation();
  }
}

export function resetBonvallet() {
  snapshot = null;
  lastShownAt = 0;
  startupShownForUser = '';
  clearTimeout(hideTimer);
  clearRotationTimer();
  recentQuotes = [];
  hideBonvallet({ immediate: true });
}

function showStartupOnce() {
  const userId = session.user?.id || '';
  if (!isBonvalletEnabled() || session.status !== 'signed-in' || !userId || startupShownForUser === userId) return;

  startupShownForUser = userId;
  window.setTimeout(() => {
    if (session.status !== 'signed-in' || session.user?.id !== userId) return;
    startBonvallet(metrics());
  }, 850);
}

onChange(() => {
  if (session.status !== 'signed-in' || !isBonvalletEnabled()) return;
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


document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && session.status === 'signed-in' && isBonvalletEnabled()) {
    scheduleBonvalletRotation({ sooner: true });
  } else {
    clearRotationTimer();
  }
});

document.addEventListener('taskflow:mascot-preference', (event) => {
  setBonvalletEnabled(Boolean(event.detail?.enabled));
});

window.addEventListener('storage', (event) => {
  if (event.key !== mascotPreferenceKey()) return;
  setBonvalletEnabled(event.newValue !== '0');
});

if (session.status === 'signed-in') showStartupOnce();
