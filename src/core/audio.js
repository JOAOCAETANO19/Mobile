// Download + decode de áudio com cadeia de fallback CORS, e utilitários de reprodução
// sincronizada ao relógio do AudioContext (fonte única de verdade do tempo do jogo).

const CORS_PROXIES = [
  (url) => url,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

let sharedContext = null;
export function getAudioContext() {
  if (!sharedContext) {
    const AC = window.AudioContext || window.webkitAudioContext;
    sharedContext = new AC();
  }
  return sharedContext;
}

/** Baixa um ArrayBuffer de uma URL, tentando direto e depois via proxies CORS. */
export async function fetchArrayBufferWithFallback(url, onProgress) {
  let lastError = null;
  for (const buildUrl of CORS_PROXIES) {
    try {
      const target = buildUrl(url);
      const res = await fetch(target);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length')) || 0;
      if (!res.body || !onProgress) {
        return await res.arrayBuffer();
      }
      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (total) onProgress(received / total);
      }
      const buf = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        buf.set(chunk, offset);
        offset += chunk.length;
      }
      return buf.buffer;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Falha ao baixar áudio de todas as fontes');
}

/** Baixa e decodifica uma URL de áudio em um AudioBuffer, pronto para analysis.js. */
export async function loadAudioBufferFromUrl(url, onProgress) {
  const ctx = getAudioContext();
  const arrayBuffer = await fetchArrayBufferWithFallback(url, onProgress);
  return await ctx.decodeAudioData(arrayBuffer.slice(0));
}

/** Decodifica um File/Blob local (upload do aparelho) em um AudioBuffer. */
export async function loadAudioBufferFromFile(file) {
  const ctx = getAudioContext();
  const arrayBuffer = await file.arrayBuffer();
  return await ctx.decodeAudioData(arrayBuffer);
}

/**
 * Player sincronizado: toca um AudioBuffer e expõe getCurrentTime() baseado no
 * relógio do AudioContext, para que física/render/checkpoints nunca dessincronizem.
 */
export class SyncedPlayer {
  constructor(audioBuffer) {
    this.ctx = getAudioContext();
    this.buffer = audioBuffer;
    this.source = null;
    this.startedAtCtxTime = 0;
    this.offset = 0;
    this.playing = false;
    this.gainNode = this.ctx.createGain();
    this.gainNode.connect(this.ctx.destination);
  }

  play(fromSeconds = 0) {
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.stop();
    const source = this.ctx.createBufferSource();
    this.source = source;
    source.buffer = this.buffer;
    source.connect(this.gainNode);
    source.onended = () => {
      // Ignore o evento atrasado de uma fonte substituída/parada. Ao fim natural,
      // avance o relógio até o final para que o nível conclua mesmo sem outro frame.
      if (this.source !== source) return;
      if (this.playing) this.offset = this.buffer.duration;
      this.playing = false;
      this.source = null;
      try { source.disconnect(); } catch { /* já desconectada */ }
    };
    source.start(0, fromSeconds);
    this.startedAtCtxTime = this.ctx.currentTime;
    this.offset = fromSeconds;
    this.playing = true;
  }

  stop() {
    if (this.playing) this.offset = this.getCurrentTime();
    const source = this.source;
    this.source = null;
    this.playing = false;
    if (source) {
      try { source.stop(); } catch { /* já parada */ }
      try { source.disconnect(); } catch { /* já desconectada */ }
    }
  }

  setVolume(v) {
    this.gainNode.gain.value = Math.max(0, Math.min(1, Number(v) || 0));
  }

  /** Tempo atual da faixa em segundos, derivado do relógio do AudioContext. */
  getCurrentTime() {
    if (!this.playing) return this.offset;
    return this.offset + (this.ctx.currentTime - this.startedAtCtxTime);
  }
}
