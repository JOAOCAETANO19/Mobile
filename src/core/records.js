// Persistência local por conta + sincronização dos maiores recordes com Supabase.
import { fetchPlayerRecords, submitPlayerRecord } from './supabase.js';

const STORAGE_PREFIX = 'rhythm-dash.records.v1';
const MAX_LOCAL_RECORDS = 100;

function storageKey(userId) {
  const namespace = userId ? `user:${encodeURIComponent(String(userId))}` : 'guest';
  return `${STORAGE_PREFIX}:${namespace}`;
}

function getStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

function numberAtLeastZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function fromCloudRow(row = {}) {
  return {
    track_id: String(row.track_id || ''),
    track_title: String(row.track_title || 'Faixa sem título'),
    track_artist: String(row.track_artist || ''),
    score: numberAtLeastZero(row.score),
    best_combo: numberAtLeastZero(row.best_combo),
    completed: Boolean(row.completed),
    updated_at: row.updated_at || new Date(0).toISOString(),
  };
}

function readRecords(userId) {
  const store = getStorage();
  if (!store) return [];
  try {
    const records = JSON.parse(store.getItem(storageKey(userId)) || '[]');
    return Array.isArray(records) ? records.map(fromCloudRow).filter((record) => record.track_id) : [];
  } catch {
    return [];
  }
}

function writeRecords(userId, records) {
  const store = getStorage();
  if (!store) return;
  try {
    store.setItem(storageKey(userId), JSON.stringify(records.slice(0, MAX_LOCAL_RECORDS)));
  } catch {
    // Recordes continuam disponíveis na nuvem; storage local pode estar desabilitado.
  }
}

function timestamp(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Mescla listas sempre preservando a maior pontuação e o maior combo por faixa. */
export function mergeRecordSets(...sets) {
  const recordsByTrack = new Map();
  for (const records of sets) {
    for (const input of records || []) {
      const next = fromCloudRow(input);
      if (!next.track_id) continue;
      const previous = recordsByTrack.get(next.track_id);
      if (!previous) {
        recordsByTrack.set(next.track_id, next);
        continue;
      }
      const newest = timestamp(next.updated_at) >= timestamp(previous.updated_at) ? next : previous;
      recordsByTrack.set(next.track_id, {
        ...newest,
        track_title: newest.track_title || previous.track_title || next.track_title,
        track_artist: newest.track_artist || previous.track_artist || next.track_artist,
        score: Math.max(previous.score, next.score),
        best_combo: Math.max(previous.best_combo, next.best_combo),
        completed: previous.completed || next.completed,
        updated_at: new Date(Math.max(timestamp(previous.updated_at), timestamp(next.updated_at))).toISOString(),
      });
    }
  }
  return [...recordsByTrack.values()]
    .sort((a, b) => b.score - a.score || timestamp(b.updated_at) - timestamp(a.updated_at))
    .slice(0, MAX_LOCAL_RECORDS);
}

/** Cria um ID estável e não reversível; URLs de streams nunca são salvas no banco. */
export async function makeTrackRecordId(trackMeta = {}) {
  const source = String(trackMeta.source || 'track').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) || 'track';
  const id = trackMeta.id == null ? '' : String(trackMeta.id).trim();
  const title = String(trackMeta.title || '').trim().toLowerCase();
  const artist = String(trackMeta.artist || '').trim().toLowerCase();
  const duration = numberAtLeastZero(trackMeta.duration);
  const identity = id
    ? `${source}\u0000id\u0000${id}`
    : `${source}\u0000meta\u0000${title}\u0000${artist}\u0000${Math.round(duration / 5) * 5}`;

  if (globalThis.crypto?.subtle && typeof TextEncoder === 'function') {
    try {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
      const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      return `${source}:${hex}`;
    } catch {
      // Fallback para navegadores/contextos sem WebCrypto.
    }
  }

  // Hash de fallback estável de 64 bits para contextos sem WebCrypto (não é credencial).
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < identity.length; i++) {
    const code = identity.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ (code + i), 0x85ebca6b);
  }
  const hash = `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
  return `${source}:${hash}`;
}

export function getLocalRecords(userId = null) {
  return readRecords(userId);
}

/** Salva primeiro localmente e depois tenta o RPC; erro de rede não perde o recorde. */
export async function saveGameRecord({ trackMeta, score, bestCombo, completed = false, userId = null }) {
  const candidate = fromCloudRow({
    track_id: await makeTrackRecordId(trackMeta),
    track_title: String(trackMeta?.title || 'Faixa sem título').slice(0, 160),
    track_artist: String(trackMeta?.artist || '').slice(0, 120),
    score: numberAtLeastZero(score),
    best_combo: numberAtLeastZero(bestCombo),
    completed,
    updated_at: new Date().toISOString(),
  });

  let records = mergeRecordSets(readRecords(userId), [candidate]);
  writeRecords(userId, records);
  if (!userId) return { record: candidate, records, synced: false, error: null };

  try {
    const response = await submitPlayerRecord(candidate);
    const cloudRecord = Array.isArray(response) ? response[0] : response;
    if (cloudRecord?.track_id) records = mergeRecordSets(records, [cloudRecord]);
    writeRecords(userId, records);
    return {
      record: records.find((record) => record.track_id === candidate.track_id) || candidate,
      records,
      synced: true,
      error: null,
    };
  } catch (error) {
    return {
      record: candidate,
      records,
      synced: false,
      error,
    };
  }
}

/** Envia os registros locais da conta, baixa os remotos e mescla sem reduzir recordes. */
export async function syncRecords(userId) {
  if (!userId) throw new Error('Entre na sua conta para sincronizar os recordes.');
  const localRecords = readRecords(userId);

  // Limita concorrência para não disparar dezenas de requisições ao reconectar.
  for (let start = 0; start < localRecords.length; start += 4) {
    await Promise.all(localRecords.slice(start, start + 4).map((record) => submitPlayerRecord(record)));
  }

  const cloudRecords = await fetchPlayerRecords();
  const records = mergeRecordSets(localRecords, Array.isArray(cloudRecords) ? cloudRecords : []);
  writeRecords(userId, records);
  return records;
}

/** Importação explícita evita atribuir automaticamente dados de um aparelho compartilhado. */
export async function importGuestRecords(userId) {
  if (!userId) throw new Error('Entre na sua conta antes de importar recordes.');
  const guestRecords = readRecords(null);
  if (!guestRecords.length) return syncRecords(userId);

  const userRecords = readRecords(userId);
  const toUpload = mergeRecordSets(userRecords, guestRecords);
  for (let start = 0; start < toUpload.length; start += 4) {
    await Promise.all(toUpload.slice(start, start + 4).map((record) => submitPlayerRecord(record)));
  }

  const cloudRecords = await fetchPlayerRecords();
  const records = mergeRecordSets(userRecords, guestRecords, Array.isArray(cloudRecords) ? cloudRecords : []);
  writeRecords(userId, records);
  try { getStorage()?.removeItem(storageKey(null)); } catch { /* a cópia na nuvem já foi confirmada */ }
  return records;
}
