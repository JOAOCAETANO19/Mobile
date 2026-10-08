// Service worker mínimo: cacheia o app shell para permitir abrir offline (a análise de
// áudio roda 100% no dispositivo, só a busca online precisa de rede).
const CACHE_NAME = 'rhythm-dash-v26';
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
  // Não armazena respostas de APIs externas/authenticated no CacheStorage. Além de
  // privados, GETs do Supabase variam por usuário e nunca podem cair no cache offline.
  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin || request.headers.has('authorization')) return;
  // Network-first para o app no mesmo domínio, com fallback pro cache offline.
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
