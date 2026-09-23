// Calibração de latência de áudio: em fones Bluetooth (e alguns aparelhos) o som
// chega atrasado — o jogador toca no que OUVIU, e o julgamento sai "atrasado".
// Medimos o atraso médio tocando no ritmo de bipes e compensamos as janelas de
// julgamento (PERFEITO/BOM). As janelas visuais NÃO mudam — só a comparação
// tempo-do-toque ↔ tempo-da-batida.

const STORAGE_KEY = 'rhythm-dash-audio-offset-ms';
const MIN_OFFSET_MS = -400;
const MAX_OFFSET_MS = 400;
const OUTLIER_MS = 250; // taps a mais disso do bipe são ignorados (errou o ritmo)

/** Lê o offset salvo (ms). Positivo = áudio chega atrasado (típico de Bluetooth). */
export function getAudioOffsetMs(storage = globalThis.localStorage) {
  try {
    const v = Number(storage?.getItem(STORAGE_KEY));
    if (Number.isFinite(v)) return clampOffset(v);
  } catch {
    /* sem storage — offset zero */
  }
  return 0;
}

/** Salva o offset (com clamp de segurança). Retorna o valor efetivamente salvo. */
export function setAudioOffsetMs(ms, storage = globalThis.localStorage) {
  const v = clampOffset(ms);
  try {
    storage?.setItem(STORAGE_KEY, String(Math.round(v)));
  } catch {
    /* noop */
  }
  return Math.round(v);
}

export function clampOffset(ms) {
  if (!Number.isFinite(ms)) return 0;
  return Math.min(MAX_OFFSET_MS, Math.max(MIN_OFFSET_MS, ms));
}

/**
 * Média dos desvios (toque - bipe) em ms, descartando foras-da-janela (> ±250ms,
 * tap fora do ritmo) e limitada ao clamp. Retorna 0 se não sobrou amostra —
 * prefere "sem compensação" a um valor errado.
 */
export function averageOffset(samplesMs) {
  const ok = samplesMs.filter((s) => Number.isFinite(s) && Math.abs(s) <= OUTLIER_MS);
  if (!ok.length) return 0;
  const mean = ok.reduce((a, b) => a + b, 0) / ok.length;
  return clampOffset(Math.round(mean));
}

/** Para cada toque, casa com o bipe mais próximo (se houver a até OUTLIER_MS). */
export function matchTapsToTicks(tapTimesSec, tickTimesSec) {
  const offsets = [];
  for (const tap of tapTimesSec) {
    let best = null;
    let bestDist = Infinity;
    for (const tick of tickTimesSec) {
      const d = Math.abs(tap - tick);
      if (d < bestDist) { bestDist = d; best = tick; }
    }
    if (best != null && bestDist <= OUTLIER_MS / 1000) {
      offsets.push((tap - best) * 1000);
    }
  }
  return offsets;
}
