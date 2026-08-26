// Cliente do backend próprio (yt-dlp): busca e stream da faixa inteira.
// Ver server/server.mjs para a implementação do servidor (zero dependências).

import { DEFAULT_BACKEND_URL, DEFAULT_BACKEND_KEY } from './config.js';

const STORAGE_KEY = 'rhythm-dash:backend';

export function getBackendConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved?.url) return saved;
  } catch (e) { /* ignora storage corrompido */ }
  return { url: DEFAULT_BACKEND_URL, key: DEFAULT_BACKEND_KEY };
}

export function setBackendConfig(url, key = '') {
  const normalized = url ? url.replace(/\/$/, '') : '';
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ url: normalized, key }));
}

function headersFor(key) {
  const h = { Accept: 'application/json' };
  if (key) h['X-Rhythm-Dash-Key'] = key;
  return h;
}

/** Testa se o backend está online e responde ao /api/health. */
export async function testBackend(url, key) {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/api/health`, { headers: headersFor(key) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

/** Busca no backend próprio — resultados aparecem como "Seu servidor" na UI. */
export async function backendSearch(query) {
  const { url, key } = getBackendConfig();
  if (!url) return [];
  try {
    const res = await fetch(`${url}/api/search?q=${encodeURIComponent(query)}`, { headers: headersFor(key) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map((r) => ({
      source: 'backend',
      id: r.id,
      title: r.title,
      artist: r.artist || '',
      duration: r.duration || 0,
      cover: r.thumbnail || null,
      fullTrackAvailable: true,
      streamUrl: `${url}/api/stream/${encodeURIComponent(r.id)}${key ? `?key=${encodeURIComponent(key)}` : ''}`,
      via: 'Seu servidor',
    }));
  } catch (err) {
    console.warn('backendSearch falhou:', err);
    return [];
  }
}

/** Monta a URL de stream de uma faixa específica pelo ID (usado pelo botão ▶▶). */
export function backendStreamUrl(trackId) {
  const { url, key } = getBackendConfig();
  if (!url) return null;
  return `${url}/api/stream/${encodeURIComponent(trackId)}${key ? `?key=${encodeURIComponent(key)}` : ''}`;
}
