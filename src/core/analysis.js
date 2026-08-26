// Analisador de áudio: onsets (spectral flux) -> BPM (autocorrelação) -> seções -> tema visual.
// Tudo em JS puro (usa fft.js), roda no dispositivo (sem servidor) e é testável no Node.

import { magnitudeSpectrum, hannWindow, nextPowerOfTwo } from './fft.js';

const FFT_SIZE = 2048;
const HOP_SIZE = 512; // 75% overlap
const MIN_BPM = 70;
const MAX_BPM = 190;

/**
 * Extrai um canal mono de samples a partir de um AudioBuffer (ou objeto compatível
 * { numberOfChannels, sampleRate, getChannelData(ch) }).
 */
export function toMono(audioBuffer) {
  const { numberOfChannels, length } = audioBuffer;
  const mono = new Float32Array(length);
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      mono[i] += data[i] / numberOfChannels;
    }
  }
  return mono;
}

/**
 * Calcula o spectral flux quadro a quadro (energia de subida no espectro = proxy de onset).
 * Também retorna o centróide espectral por quadro (para o tema de cor) e o RMS (energia).
 */
export function computeFrames(mono, sampleRate) {
  const window = hannWindow(FFT_SIZE);
  const frameCount = Math.max(0, Math.floor((mono.length - FFT_SIZE) / HOP_SIZE) + 1);
  const flux = new Float64Array(frameCount);
  const centroid = new Float64Array(frameCount);
  const rms = new Float64Array(frameCount);
  const times = new Float64Array(frameCount);

  let prevMags = null;
  const buf = new Float64Array(FFT_SIZE);

  for (let f = 0; f < frameCount; f++) {
    const start = f * HOP_SIZE;
    for (let i = 0; i < FFT_SIZE; i++) buf[i] = mono[start + i] || 0;

    const mags = magnitudeSpectrum(buf, window);

    // Spectral flux: soma das subidas positivas de magnitude entre quadros consecutivos.
    let fluxSum = 0;
    let centSum = 0;
    let magSum = 0;
    let energy = 0;
    for (let i = 0; i < mags.length; i++) {
      const m = mags[i];
      energy += m * m;
      centSum += i * m;
      magSum += m;
      if (prevMags) {
        const diff = m - prevMags[i];
        if (diff > 0) fluxSum += diff;
      }
    }
    flux[f] = fluxSum;
    centroid[f] = magSum > 0 ? centSum / magSum / mags.length : 0; // normalizado 0..1
    rms[f] = Math.sqrt(energy / mags.length);
    times[f] = start / sampleRate;
    prevMags = mags;
  }

  return { flux, centroid, rms, times, hopSize: HOP_SIZE, fftSize: FFT_SIZE };
}

/** Normaliza um array para [0,1]. */
function normalize(arr) {
  let max = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i];
  if (max <= 0) return new Float64Array(arr.length);
  const out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i] / max;
  return out;
}

/**
 * Detecta picos (onsets) no envelope de flux usando um limiar adaptativo local
 * (média móvel + margem), evitando detectar ruído de fundo constante.
 */
export function detectOnsets(flux, times, { windowFrames = 20, threshold = 1.4, minGapSec = 0.08 } = {}) {
  const norm = normalize(flux);
  const onsets = [];
  let lastOnsetTime = -Infinity;

  for (let i = 0; i < norm.length; i++) {
    const start = Math.max(0, i - windowFrames);
    const end = Math.min(norm.length, i + windowFrames);
    let sum = 0;
    for (let j = start; j < end; j++) sum += norm[j];
    const mean = sum / (end - start);
    const isPeak =
      norm[i] > mean * threshold &&
      norm[i] > (norm[i - 1] ?? 0) &&
      norm[i] >= (norm[i + 1] ?? 0);

    if (isPeak && times[i] - lastOnsetTime >= minGapSec) {
      onsets.push({ time: times[i], strength: norm[i] });
      lastOnsetTime = times[i];
    }
  }
  return onsets;
}

/**
 * Estima o BPM a partir dos intervalos entre onsets usando autocorrelação simples
 * sobre um histograma de intervalos, restrito a uma faixa musicalmente plausível.
 */
export function estimateBpm(onsets, { minBpm = MIN_BPM, maxBpm = MAX_BPM } = {}) {
  if (onsets.length < 4) return { bpm: 120, confidence: 0 };

  const minInterval = 60 / maxBpm;
  const maxInterval = 60 / minBpm;
  const bucketSize = 0.01; // 10ms
  const buckets = new Map();

  for (let i = 0; i < onsets.length; i++) {
    for (let j = i + 1; j < onsets.length; j++) {
      const dt = onsets[j].time - onsets[i].time;
      if (dt > maxInterval) break;
      if (dt < minInterval) continue;
      // considera também múltiplos/submúltiplos dobrando para a faixa alvo
      let candidate = dt;
      while (candidate > maxInterval) candidate /= 2;
      while (candidate < minInterval) candidate *= 2;
      const bucket = Math.round(candidate / bucketSize);
      buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
    }
  }

  let bestBucket = 0;
  let bestScore = 0;
  for (const [bucket, score] of buckets) {
    if (score > bestScore) {
      bestScore = score;
      bestBucket = bucket;
    }
  }

  if (bestScore === 0) return { bpm: 120, confidence: 0 };

  const interval = bestBucket * bucketSize;
  const bpm = 60 / interval;
  const totalPairs = onsets.length * (onsets.length - 1) / 2;
  const confidence = Math.min(1, bestScore / Math.max(1, totalPairs * 0.05));

  return { bpm: Math.round(bpm * 10) / 10, confidence };
}

/**
 * Divide a faixa em seções (intro, build, drop, break, flow, outro) com base na
 * energia (RMS) e na densidade de onsets ao longo do tempo, usando uma janela deslizante.
 */
export function detectSections(frames, onsets, durationSec) {
  const { rms, times } = frames;
  const normRms = normalize(rms);

  const sectionWindowSec = 4;
  const numWindows = Math.max(1, Math.ceil(durationSec / sectionWindowSec));
  const windowEnergy = new Float64Array(numWindows);
  const windowOnsetDensity = new Float64Array(numWindows);
  const windowCounts = new Float64Array(numWindows);

  for (let i = 0; i < times.length; i++) {
    const w = Math.min(numWindows - 1, Math.floor(times[i] / sectionWindowSec));
    windowEnergy[w] += normRms[i];
    windowCounts[w] += 1;
  }
  for (let w = 0; w < numWindows; w++) {
    if (windowCounts[w] > 0) windowEnergy[w] /= windowCounts[w];
  }
  for (const onset of onsets) {
    const w = Math.min(numWindows - 1, Math.floor(onset.time / sectionWindowSec));
    windowOnsetDensity[w] += 1;
  }

  const maxDensity = Math.max(1, ...windowOnsetDensity);

  const sections = [];
  let prevLabel = null;
  let sectionStart = 0;

  const labelFor = (energy, density, index, total) => {
    const relPos = index / total;
    if (relPos < 0.06) return 'intro';
    if (relPos > 0.94) return 'outro';
    if (energy < 0.25 && density < 0.3) return 'break';
    if (energy > 0.7 && density > 0.55) return 'drop';
    if (energy > 0.45) return 'build';
    return 'flow';
  };

  for (let w = 0; w < numWindows; w++) {
    const energy = windowEnergy[w];
    const density = windowOnsetDensity[w] / maxDensity;
    const label = labelFor(energy, density, w, numWindows);
    const time = w * sectionWindowSec;

    if (label !== prevLabel) {
      if (prevLabel !== null) {
        sections.push({ label: prevLabel, start: sectionStart, end: time });
      }
      sectionStart = time;
      prevLabel = label;
    }
  }
  sections.push({ label: prevLabel || 'flow', start: sectionStart, end: durationSec });

  // Funde seções minúsculas (<2s) com a vizinha anterior para evitar ruído.
  const merged = [];
  for (const s of sections) {
    if (merged.length && s.end - s.start < 2) {
      merged[merged.length - 1].end = s.end;
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

/** Paleta HSL por seção derivada do centróide espectral médio (sinestesia visual). */
export function deriveTheme(frames, sections) {
  const { centroid, times } = frames;
  return sections.map((section) => {
    let sum = 0, count = 0;
    for (let i = 0; i < times.length; i++) {
      if (times[i] >= section.start && times[i] < section.end) {
        sum += centroid[i];
        count++;
      }
    }
    const avgCentroid = count > 0 ? sum / count : 0.3;
    // Centróide baixo -> tons quentes (graves/calmo); alto -> tons frios/vibrantes.
    const hue = Math.round(260 - avgCentroid * 260); // 260 (roxo) .. 0 (vermelho/laranja)
    const sectionBoost = { drop: 15, build: 5, break: -10, intro: -15, outro: -15, flow: 0 };
    const saturation = Math.min(100, Math.max(40, 70 + (sectionBoost[section.label] || 0)));
    const lightness = section.label === 'drop' ? 55 : 45;
    return {
      ...section,
      hue,
      color: `hsl(${hue}, ${saturation}%, ${lightness}%)`,
      glow: `hsl(${hue}, ${saturation}%, ${Math.min(80, lightness + 20)}%)`,
    };
  });
}

/**
 * Pipeline completo: recebe um AudioBuffer (ou compatível) e devolve onsets, BPM,
 * seções com tema, e metadados de energia — pronto para o gerador de nível.
 */
export function analyzeAudioBuffer(audioBuffer, options = {}) {
  const sampleRate = audioBuffer.sampleRate;
  const durationSec = audioBuffer.length / sampleRate;
  const mono = toMono(audioBuffer);
  const frames = computeFrames(mono, sampleRate);
  const onsets = detectOnsets(frames.flux, frames.times, options.onsetOptions);
  const { bpm, confidence } = estimateBpm(onsets, options.bpmOptions);
  const rawSections = detectSections(frames, onsets, durationSec);
  const sections = deriveTheme(frames, rawSections);

  return {
    durationSec,
    sampleRate,
    bpm,
    bpmConfidence: confidence,
    onsets,
    sections,
    frames: { times: frames.times, rms: normalize(frames.rms), centroid: frames.centroid },
  };
}
