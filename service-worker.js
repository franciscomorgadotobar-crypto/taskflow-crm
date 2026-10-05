const STATIC_CACHE = 'crm-personal-static-v9';
const RUNTIME_CACHE = 'crm-personal-runtime-v9';
const ALL_CACHES = [STATIC_CACHE, RUNTIME_CACHE];

const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/pwa-icon.svg',
  './assets/pwa-icon-maskable.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.includes('crm') && !ALL_CACHES.includes(key))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put('./index.html', response.clone());
    }
    return response;
  } catch {
    return (await caches.match('./index.html')) || (await caches.match('./'));
  }
}

async function networkFirstAsset(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && (response.ok || response.type === 'opaque')) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await cache.match(request)) || Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const update = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || (await update) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Nunca cachear APIs, autenticación ni datos comerciales.
  if (
    url.hostname.includes('supabase.co') ||
    url.pathname.includes('/rest/v1/') ||
    url.pathname.includes('/auth/v1/') ||
    url.pathname.includes('/realtime/v1/')
  ) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (url.origin === self.location.origin) {
    const isAppCode =
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.html') ||
      url.pathname.endsWith('.json') ||
      url.pathname.endsWith('.webmanifest');

    // Código y estilos siempre intentan red primero para no dejar una versión vieja
    // de la PWA después de un despliegue. Imágenes y demás recursos sí usan cache-first.
    event.respondWith(isAppCode ? networkFirstAsset(request) : cacheFirst(request));
    return;
  }

  // La única dependencia externa del shell es Supabase JS desde jsDelivr.
  // Se cachea la librería, nunca sus llamadas de datos.
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(staleWhileRevalidate(request));
  }
});
