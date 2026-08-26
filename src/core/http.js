// fetch JSON compartilhado com cadeia de proxies CORS, usado por search.js/spotify.js/youtube.js
// quando a API alvo não libera CORS para chamadas direto do navegador.

const CORS_PROXIES = [
  (url) => url, // tenta direto primeiro (funciona para APIs com CORS liberado)
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
];

const DEFAULT_TIMEOUT_MS = 9000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

/**
 * Faz fetch de JSON tentando direto e, em caso de falha (rede/CORS), passando por
 * proxies públicos em sequência. Retorna null se tudo falhar (o chamador decide o fallback).
 */
export async function fetchJsonWithFallback(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {} } = {}) {
  let lastError = null;
  for (const buildUrl of CORS_PROXIES) {
    try {
      const target = buildUrl(url);
      const res = await withTimeout(fetch(target, { headers }), timeoutMs);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }
  console.warn('fetchJsonWithFallback: todas as fontes falharam para', url, lastError);
  return null;
}

export async function fetchTextWithFallback(url, opts = {}) {
  const json = await fetchJsonWithFallback(url, opts).catch(() => null);
  if (json) return json;
  for (const buildUrl of CORS_PROXIES) {
    try {
      const res = await withTimeout(fetch(buildUrl(url)), opts.timeoutMs || DEFAULT_TIMEOUT_MS);
      if (res.ok) return await res.text();
    } catch (e) { /* tenta próxima */ }
  }
  return null;
}
