// Faixa demo sintetizada offline (128 BPM) — usada quando o jogador quer testar sem
// buscar nada, ou como fallback quando não há internet. Gera um AudioBuffer sintético
// com bumbo (kick) marcando cada batida, um pad harmônico e uma seção de "drop" mais
// energética, para exercitar a detecção de onsets/BPM/seções de ponta a ponta.

export const DEMO_BPM = 128;
export const DEMO_DURATION_SEC = 32;

function kick(buffer, sampleRate, startTime, gain = 0.9) {
  const startSample = Math.floor(startTime * sampleRate);
  const len = Math.floor(0.18 * sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const idx = startSample + i;
      if (idx >= data.length) break;
      const t = i / sampleRate;
      const freq = 150 * Math.exp(-t * 18) + 40;
      const envelope = Math.exp(-t * 14);
      data[idx] += Math.sin(2 * Math.PI * freq * t) * envelope * gain;
    }
  }
}

function hat(buffer, sampleRate, startTime, gain = 0.15) {
  const startSample = Math.floor(startTime * sampleRate);
  const len = Math.floor(0.04 * sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const idx = startSample + i;
      if (idx >= data.length) break;
      const envelope = Math.exp(-(i / sampleRate) * 60);
      data[idx] += (Math.random() * 2 - 1) * envelope * gain;
    }
  }
}

function pad(buffer, sampleRate, startTime, duration, freqs, gain = 0.06) {
  const startSample = Math.floor(startTime * sampleRate);
  const len = Math.floor(duration * sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const idx = startSample + i;
      if (idx >= data.length) break;
      const t = i / sampleRate;
      const envelope = Math.min(1, t * 4) * Math.min(1, (len - i) / sampleRate * 4);
      let sample = 0;
      for (const f of freqs) sample += Math.sin(2 * Math.PI * f * t);
      data[idx] += (sample / freqs.length) * envelope * gain;
    }
  }
}

/**
 * Sintetiza uma faixa demo usando um AudioContext (ou OfflineAudioContext) real, para
 * que passe pelo mesmo pipeline de análise que uma música de verdade.
 */
export function createDemoTrackBuffer(ctx) {
  const sampleRate = ctx.sampleRate || 44100;
  const duration = DEMO_DURATION_SEC;
  const buffer = ctx.createBuffer(2, Math.floor(duration * sampleRate), sampleRate);
  const beatDuration = 60 / DEMO_BPM;

  const chordProgressions = [
    [220, 277.18, 329.63], // intro suave (Am)
    [246.94, 293.66, 369.99], // build (Bm)
    [261.63, 329.63, 392.0], // drop (C)
    [220, 277.18, 329.63], // break/outro
  ];

  let beatIndex = 0;
  for (let t = 0; t < duration; t += beatDuration) {
    const progress = t / duration;
    const section = progress < 0.15 ? 0 : progress < 0.35 ? 1 : progress < 0.85 ? 2 : 3;

    if (section !== 0) {
      kick(buffer, sampleRate, t, section === 2 ? 1.0 : 0.7);
    }
    if (section === 2 && beatIndex % 2 === 1) {
      hat(buffer, sampleRate, t + beatDuration / 2, 0.12);
    }
    if (beatIndex % 4 === 0) {
      pad(buffer, sampleRate, t, beatDuration * 4, chordProgressions[section], section === 2 ? 0.09 : 0.05);
    }
    beatIndex++;
  }

  return buffer;
}

export const DEMO_TRACK_META = {
  id: 'demo-track',
  title: 'Faixa Demo (offline)',
  artist: 'Rhythm Dash',
  duration: DEMO_DURATION_SEC,
  source: 'demo',
  fullTrackAvailable: true,
};
