// Extração de áudio do YouTube no cliente, com cadeia de fallback de instâncias públicas.
// Aviso do README: desde 2026 muitas instâncias públicas estão bloqueadas/instáveis —
// por isso existe o backend próprio (server/) como caminho recomendado para faixa completa.

import { fetchJsonWithFallback } from './http.js';

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://piped-api.privacy.com.de',
  'https://api.piped.yt',
];

const INVIDIOUS_INSTANCES = [
  'https://invidious.fdn.fr',
  'https://yewtu.be',
  'https://invidious.slipfox.xyz',
];

export function extractYoutubeId(input) {
  const patterns = [
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /music\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const re of patterns) {
    const m = re.exec(input);
    if (m) return m[1];
  }
  return null;
}

async function tryPiped(videoId) {
  for (const base of PIPED_INSTANCES) {
    try {
      const data = await fetchJsonWithFallback(`${base}/streams/${videoId}`);
      const audio = (data?.audioStreams || []).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      if (audio?.url) {
        return {
          streamUrl: audio.url,
          title: data.title,
          artist: data.uploader,
          duration: data.duration,
          cover: data.thumbnailUrl,
          via: `Piped (${base})`,
        };
      }
    } catch (e) { /* tenta próxima instância */ }
  }
  return null;
}

async function tryInvidious(videoId) {
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const data = await fetchJsonWithFallback(`${base}/api/v1/videos/${videoId}`);
      const audio = (data?.adaptiveFormats || [])
        .filter((f) => f.type?.startsWith('audio'))
        .sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0))[0];
      if (audio?.url) {
        return {
          streamUrl: audio.url,
          title: data.title,
          artist: data.author,
          duration: data.lengthSeconds,
          cover: data.videoThumbnails?.[0]?.url,
          via: `Invidious (${base})`,
        };
      }
    } catch (e) { /* tenta próxima instância */ }
  }
  return null;
}

async function tryCobalt(videoUrl) {
  try {
    const res = await fetch('https://api.cobalt.tools/api/json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ url: videoUrl, isAudioOnly: true, aFormat: 'mp3' }),
    });
    const data = await res.json();
    if (data?.url) return { streamUrl: data.url, via: 'Cobalt' };
  } catch (e) { /* fallback abaixo */ }
  return null;
}

/**
 * Tenta extrair uma URL de áudio jogável a partir de um link/ID do YouTube, percorrendo
 * a cadeia Piped → Invidious → Cobalt. Se tudo falhar, o chamador deve cair para a
 * busca legal (Spotify/Deezer/iTunes) ou orientar o uso do backend próprio.
 */
export async function resolveYoutubeAudio(input) {
  const videoId = extractYoutubeId(input);
  if (!videoId) throw new Error('Link do YouTube inválido');

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const piped = await tryPiped(videoId);
  if (piped) return { ...piped, videoId };

  const invidious = await tryInvidious(videoId);
  if (invidious) return { ...invidious, videoId };

  const cobalt = await tryCobalt(videoUrl);
  if (cobalt) return { ...cobalt, videoId };

  throw new Error(
    'Não consegui extrair o áudio do YouTube pelas fontes públicas (podem estar bloqueadas). ' +
    'Use o backend próprio (yt-dlp) ou a busca por Spotify/Deezer/iTunes.'
  );
}
