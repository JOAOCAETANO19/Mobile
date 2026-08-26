// Token anônimo do player web do Spotify + metadata via API pública, para busca com
// duração exata, capa e prévia de 30s (sem precisar de credenciais de desenvolvedor).

import { fetchJsonWithFallback } from './http.js';

const TOKEN_URL = 'https://open.spotify.com/get_access_token?reason=transport&productType=web_player';
const SEARCH_URL = 'https://api.spotify.com/v1/search';

let cachedToken = null;
let cachedTokenExpiry = 0;

export async function getAnonymousToken() {
  if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;
  const data = await fetchJsonWithFallback(TOKEN_URL);
  if (!data?.accessToken) throw new Error('Não consegui obter token anônimo do Spotify');
  cachedToken = data.accessToken;
  cachedTokenExpiry = Date.now() + (data.accessTokenExpirationTimestampMs
    ? data.accessTokenExpirationTimestampMs - Date.now() - 5000
    : 55 * 60 * 1000);
  return cachedToken;
}

function mapTrack(item) {
  return {
    source: 'spotify',
    id: item.id,
    title: item.name,
    artist: (item.artists || []).map((a) => a.name).join(', '),
    album: item.album?.name || '',
    duration: Math.round((item.duration_ms || 0) / 1000),
    cover: item.album?.images?.[0]?.url || null,
    previewUrl: item.preview_url || null,
    spotifyUrl: item.external_urls?.spotify || null,
    fullTrackAvailable: false, // requer extração (Piped/etc.), ver backend.js
  };
}

/** Busca faixas no catálogo completo do Spotify (duração exata, capa, prévia). */
export async function searchSpotify(query, limit = 12) {
  try {
    const token = await getAnonymousToken();
    const url = `${SEARCH_URL}?q=${encodeURIComponent(query)}&type=track&limit=${limit}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.tracks?.items || []).map(mapTrack);
  } catch (err) {
    console.warn('searchSpotify falhou:', err);
    return [];
  }
}

/** Extrai o ID de faixa de uma URL do Spotify (open.spotify.com/track/<id> ou spotify:track:<id>). */
export function parseSpotifyTrackId(input) {
  const urlMatch = /open\.spotify\.com\/track\/([a-zA-Z0-9]+)/.exec(input);
  if (urlMatch) return urlMatch[1];
  const uriMatch = /spotify:track:([a-zA-Z0-9]+)/.exec(input);
  if (uriMatch) return uriMatch[1];
  return null;
}

/** Busca metadata de uma faixa específica pelo ID (usado quando o usuário cola um link). */
export async function getTrackById(id) {
  const token = await getAnonymousToken();
  const res = await fetch(`https://api.spotify.com/v1/tracks/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const item = await res.json();
  return mapTrack(item);
}
