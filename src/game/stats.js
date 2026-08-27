// Recordes locais por música (localStorage): melhor score, melhor combo, maior
// progresso, nº de partidas e conclusões. Lógica pura e testável; a leitura e a
// escrita do storage ficam aqui mesmo, com storage injetável para testes.

const STORAGE_KEY = 'rhythm-dash-stats-v1';
const MAX_TRACKS = 60; // limpa as mais antigas se passar disso

/** Chave estável da música a partir dos metadados. */
export function trackKey(meta) {
  const title = String(meta?.title || 'Música').trim().toLowerCase();
  const artist = String(meta?.artist || '').trim().toLowerCase();
  return `${title}•${artist}`;
}

export function loadStats(storage = globalThis.localStorage) {
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

export function saveStats(stats, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {
    /* noop */
  }
  return stats;
}

const emptyEntry = () => ({
  bestScore: 0,
  bestCombo: 0,
  bestProgressPct: 0,
  plays: 0,
  finishes: 0,
  lastPlayedAt: 0,
});

/**
 * Aplica o resultado de uma partida aos recordes da música.
 * Retorna { stats, records } — records marca o que virou NOVO RECORDE agora.
 */
export function applyRunToStats(stats, key, run, now = Date.now()) {
  const entry = { ...emptyEntry(), ...(stats[key] || {}) };
  const progress = Math.max(0, Math.min(100, Math.round(run.progressPct || 0)));
  const records = {
    score: run.score > entry.bestScore,
    combo: run.bestCombo > entry.bestCombo,
    progress: progress > entry.bestProgressPct,
    firstPlay: entry.plays === 0,
  };
  entry.bestScore = Math.max(entry.bestScore, run.score || 0);
  entry.bestCombo = Math.max(entry.bestCombo, run.bestCombo || 0);
  entry.bestProgressPct = Math.max(entry.bestProgressPct, progress);
  entry.plays += 1;
  if (run.finished) entry.finishes += 1;
  entry.lastPlayedAt = now;
  const next = { ...stats, [key]: entry };
  return { stats: pruneStats(next), records };
}

/** As N mais tocadas recentemente (evita crescer sem limite). */
export function pruneStats(stats, max = MAX_TRACKS) {
  const keys = Object.keys(stats);
  if (keys.length <= max) return stats;
  const sorted = keys.sort((a, b) => (stats[b].lastPlayedAt || 0) - (stats[a].lastPlayedAt || 0));
  const keep = {};
  for (const k of sorted.slice(0, max)) keep[k] = stats[k];
  return keep;
}

/** Top entradas para a seção "Seus recordes" da home. */
export function topPlayed(stats, limit = 5) {
  return Object.entries(stats)
    .sort((a, b) => (b[1].lastPlayedAt || 0) - (a[1].lastPlayedAt || 0))
    .slice(0, limit);
}
