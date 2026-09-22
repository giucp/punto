// Guarda la app para que abra sin conexión. Los mosaicos del mapa y las búsquedas
// siempre van a la red; el código Punto se decodifica en el teléfono.
const CACHE = 'punto-v5';
const APP_FILES = [
  './', 'index.html', 'style.css', 'app.js', 'code.js', 'config.js', 'manifest.webmanifest',
  'assets/avila.png', 'assets/firma.png', 'assets/icon.svg', 'assets/icon-180.png', 'assets/icon-192.png', 'assets/icon-512.png',
  'assets/leaflet.css', 'assets/leaflet.js', 'assets/qrcode.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Red primero para que las actualizaciones lleguen enseguida; caché si no hay conexión.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })
        .then((hit) => hit || (request.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});
