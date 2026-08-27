// Fantasma da melhor tentativa: grava amostras [tempo, altura] durante a corrida
// e, na melhor (maior progresso) daquela música, salva no aparelho. Nas próximas
// corridas o fantasma aparece como um cubo translúcido correndo junto — puro
// dado local, sem backend. Amostragem espaçada para o JSON ficar pequeno.

const STORAGE_KEY = 'rhythm-dash-ghost-v1';
const SAMPLE_EVERY_SEC = 0.05; // ~20 amostras/s → 1 música de 3 min ≈ 3.600 pontos
const MAX_SAMPLES = 6000;
const MAX_TRACKS = 8;

/** Adiciona amostra [t, y] se passou tempo suficiente desde a última. Retorna true se entrou. */
export function sampleGhost(rec, t, y, everySec = SAMPLE_EVERY_SEC) {
  const last = rec[rec.length - 1];
  if (last && t - last[0] < everySec) return false;
  if (rec.length >= MAX_SAMPLES) return false;
  rec.push([Number(t.toFixed(3)), Number(y.toFixed(2))]);
  return true;
}

/**
 * Altura do fantasma no tempo t (interpolação linear entre amostras).
 * Retorna null fora do intervalo gravado.
 */
export function ghostYAt(rec, t) {
  if (!rec?.length || t < rec[0][0] || t > rec[rec.length - 1][0]) return null;
  let lo = 0;
  let hi = rec.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (rec[mid][0] <= t) lo = mid;
    else hi = mid;
  }
  const [t0, y0] = rec[lo];
  const [t1, y1] = rec[hi];
  if (t1 <= t0) return y0;
  const f = (t - t0) / (t1 - t0);
  return y0 + (y1 - y0) * f;
}

export function loadGhosts(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') return obj;
    }
  } catch {
    /* storage indisponível */
  }
  return {};
}

export function saveGhostFor(key, rec, storage = globalThis.localStorage, now = Date.now()) {
  if (!rec?.length) return false;
  try {
    const all = loadGhosts(storage);
    all[key] = { rec, savedAt: now };
    // mantém só os mais recentes
    const keys = Object.keys(all);
    if (keys.length > MAX_TRACKS) {
      keys.sort((a, b) => (all[b].savedAt || 0) - (all[a].savedAt || 0));
      for (const k of keys.slice(MAX_TRACKS)) delete all[k];
    }
    storage?.setItem(STORAGE_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

export function loadGhostFor(key, storage = globalThis.localStorage) {
  return loadGhosts(storage)[key]?.rec || null;
}
