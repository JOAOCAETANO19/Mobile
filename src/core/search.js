// Busca de músicas: Spotify (catálogo completo) + Deezer/iTunes como fontes
// adicionais de prévia de 30s e capas, mais fontes "música completa" abertas/CC.

import { fetchJsonWithFallback } from './http.js';
import { searchSpotify, parseSpotifyTrackId, getTrackById } from './spotify.js';

const DEEZER_SEARCH = 'https://api.deezer.com/search?q=';
const ITUNES_SEARCH = 'https://itunes.apple.com/search?entity=song&limit=12&term=';
const JAMENDO_SEARCH = 'https://api.jamendo.com/v3.0/tracks/?client_id={CLIENT_ID}&format=json&limit=10&namesearch=';
const AUDIUS_DISCOVERY = 'https://discoveryprovider.audius.co/v1/tracks/search?query=';
const ARCHIVE_SEARCH = 'https://archive.org/advancedsearch.php?output=json&rows=10&q=';

function mapDeezer(item) {
  return {
    source: 'deezer',
    id: String(item.id),
    title: item.title,
    artist: item.artist?.name || '',
    album: item.album?.title || '',
    duration: item.duration || 30,
    cover: item.album?.cover_medium || item.album?.cover || null,
    previewUrl: item.preview || null,
    fullTrackAvailable: false,
  };
}

function mapItunes(item) {
  return {
    source: 'itunes',
    id: String(item.trackId),
    title: item.trackName,
    artist: item.artistName,
    album: item.collectionName || '',
    duration: Math.round((item.trackTimeMillis || 30000) / 1000),
    cover: item.artworkUrl100 || null,
    previewUrl: item.previewUrl || null,
    fullTrackAvailable: false,
  };
}

function mapAudius(item) {
  return {
    source: 'audius',
    id: item.id,
    title: item.title,
    artist: item.user?.name || '',
    album: '',
    duration: item.duration || 0,
    cover: item.artwork?.['480x480'] || null,
    previewUrl: null,
    streamUrl: `https://discoveryprovider.audius.co/v1/tracks/${item.id}/stream`,
    fullTrackAvailable: true,
    license: 'Aberta (Audius)',
  };
}

function mapArchiveDoc(doc) {
  return {
    source: 'archive',
    id: doc.identifier,
    title: doc.title || doc.identifier,
    artist: doc.creator || 'Internet Archive',
    album: '',
    duration: 0,
    cover: `https://archive.org/services/img/${doc.identifier}`,
    previewUrl: null,
    streamUrl: `https://archive.org/download/${doc.identifier}/${doc.identifier}.mp3`,
    fullTrackAvailable: true,
    license: 'Abertas / CC (Internet Archive)',
  };
}

async function searchDeezer(query) {
  const data = await fetchJsonWithFallback(DEEZER_SEARCH + encodeURIComponent(query));
  return (data?.data || []).map(mapDeezer);
}

async function searchItunes(query) {
  const data = await fetchJsonWithFallback(ITUNES_SEARCH + encodeURIComponent(query));
  return (data?.results || []).map(mapItunes);
}

async function searchAudius(query) {
  try {
    const data = await fetchJsonWithFallback(AUDIUS_DISCOVERY + encodeURIComponent(query) + '&app_name=RhythmDash');
    return (data?.data || []).slice(0, 8).map(mapAudius);
  } catch {
    return [];
  }
}

async function searchArchive(query) {
  try {
    const data = await fetchJsonWithFallback(
      `${ARCHIVE_SEARCH}${encodeURIComponent(`title:(${query}) AND mediatype:(audio)`)}&fl[]=identifier&fl[]=title&fl[]=creator`
    );
    return (data?.response?.docs || []).map(mapArchiveDoc);
  } catch {
    return [];
  }
}

/**
 * Busca agregada: roda todas as fontes em paralelo e nunca deixa uma falha derrubar
 * as demais. Resultado ordenado com Spotify primeiro (metadata mais completa).
 */
export async function searchAllSources(query) {
  if (!query || !query.trim()) return { spotify: [], deezer: [], itunes: [], fullTrack: [] };

  const spotifyId = parseSpotifyTrackId(query);
  const [spotify, deezer, itunes, audius, archive] = await Promise.all([
    spotifyId ? getTrackById(spotifyId).then((t) => [t]).catch(() => []) : searchSpotify(query),
    searchDeezer(query).catch(() => []),
    searchItunes(query).catch(() => []),
    searchAudius(query),
    searchArchive(query),
  ]);

  return {
    spotify,
    deezer,
    itunes,
    fullTrack: [...audius, ...archive],
  };
}

export { searchSpotify, parseSpotifyTrackId, getTrackById };
