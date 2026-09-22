const CACHE = 'punto-shell-v1';
const APP_FILES = ['/', '/index.html', '/style.css', '/app.js', '/manifest.webmanifest', '/assets/icon.svg', '/assets/leaflet.css', '/assets/leaflet.js', '/assets/qrcode.js', '/mockup.png', '/qr.svg'];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html')));
  } else {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
  }
});
