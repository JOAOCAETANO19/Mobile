// Service worker mínimo: cacheia o app shell para permitir abrir offline (a análise de
// áudio roda 100% no dispositivo, só a busca online precisa de rede).
const CACHE_NAME = 'rhythm-dash-v3';
// Caminhos relativos: o app pode rodar em qualquer subcaminho (ex.: GitHub Pages).
const APP_SHELL = ['./', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  // Network-first para tudo que não é o app shell básico, com fallback pro cache offline.
  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(request))
  );
});
