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
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.gainNode);
    this.source.start(0, fromSeconds);
    this.startedAtCtxTime = this.ctx.currentTime;
    this.offset = fromSeconds;
    this.playing = true;
    this.source.onended = () => {
      if (this.playing) this.playing = false;
    };
  }

  stop() {
    if (this.source) {
      try { this.source.stop(); } catch (e) { /* já parado */ }
      this.source.disconnect();
      this.source = null;
    }
    this.playing = false;
  }

  setVolume(v) {
    this.gainNode.gain.value = v;
  }

  /** Tempo atual da faixa em segundos, derivado do relógio do AudioContext. */
  getCurrentTime() {
    if (!this.playing) return this.offset;
    return this.offset + (this.ctx.currentTime - this.startedAtCtxTime);
  }
}
