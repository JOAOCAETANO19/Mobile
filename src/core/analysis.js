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
 * Calcula o spectral flux geral e o flux grave (até 180 Hz) para localizar kicks/batidas de baixo.
 * Também retorna o centróide espectral por quadro (tema) e o RMS (energia).
 */
export function computeFrames(mono, sampleRate) {
  const window = hannWindow(FFT_SIZE);
  const frameCount = Math.max(0, Math.floor((mono.length - FFT_SIZE) / HOP_SIZE) + 1);
  const flux = new Float64Array(frameCount);
  const bassFlux = new Float64Array(frameCount);
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
    let bassFluxSum = 0;
    let centSum = 0;
    let magSum = 0;
    let energy = 0;
    const bassMaxBin = Math.min(mags.length - 1, Math.floor((180 * FFT_SIZE) / sampleRate));
    for (let i = 0; i < mags.length; i++) {
      const m = mags[i];
      energy += m * m;
      centSum += i * m;
      magSum += m;
      if (prevMags) {
        const diff = m - prevMags[i];
        if (diff > 0) {
          fluxSum += diff;
          if (i > 0 && i <= bassMaxBin) bassFluxSum += diff;
        }
      }
    }
    flux[f] = fluxSum;
    bassFlux[f] = bassFluxSum;
    centroid[f] = magSum > 0 ? centSum / magSum / mags.length : 0; // normalizado 0..1
    rms[f] = Math.sqrt(energy / mags.length);
    // Cada espectro representa a janela no seu centro, o que reduz o atraso de fase
    // ao comparar o onset detectado com o instante real do kick.
    times[f] = (start + FFT_SIZE / 2) / sampleRate;
    prevMags = mags;
  }

  return { flux, bassFlux, centroid, rms, times, hopSize: HOP_SIZE, fftSize: FFT_SIZE };
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

/** Refina o BPM perto da estimativa geral usando a recorrência dos ataques graves. */
export function refineBpmFromOnsets(initialBpm, onsets, {
  rangeFraction = 0.08,
  minConfidence = 0.28,
  stepBpm = 0.1,
  phaseBins = 48,
} = {}) {
  if (!Number.isFinite(initialBpm) || initialBpm <= 0 || !Array.isArray(onsets)) {
    return { bpm: initialBpm, confidence: 0, refined: false };
  }
  const events = onsets
    .filter((onset) => Number.isFinite(onset?.time))
    .map((onset) => ({
      time: onset.time,
      weight: Number.isFinite(Number(onset.strength))
        ? Math.max(0.05, Math.min(1, Number(onset.strength)))
        : 0.5,
    }));
  if (events.length < 5) return { bpm: initialBpm, confidence: 0, refined: false };

  const minBpm = Math.max(MIN_BPM, initialBpm * (1 - rangeFraction));
  const maxBpm = Math.min(MAX_BPM, initialBpm * (1 + rangeFraction));
  const step = Math.max(0.05, stepBpm);
  const totalWeight = events.reduce((sum, event) => sum + event.weight, 0);
  const initialScoreBpm = initialBpm;
  let bestBpm = initialBpm;
  let bestScore = -Infinity;

  for (let candidate = minBpm; candidate <= maxBpm + step / 2; candidate += step) {
    const period = 60 / candidate;
    const sigma = period * 0.075;
    const phases = events.map((event) => ((event.time % period) + period) % period);
    let phaseScore = 0;
    for (let bin = 0; bin < phaseBins; bin++) {
      const phase = (bin / phaseBins) * period;
      let score = 0;
      for (let i = 0; i < events.length; i++) {
        const rawDistance = Math.abs(phases[i] - phase);
        const distance = Math.min(rawDistance, period - rawDistance);
        score += events[i].weight * Math.exp(-0.5 * (distance / sigma) ** 2);
      }
      phaseScore = Math.max(phaseScore, score / totalWeight);
    }
    // Em empates, prefere não deslocar o BPM mais do que o necessário.
    if (phaseScore > bestScore + 1e-9
      || (Math.abs(phaseScore - bestScore) <= 1e-9
        && Math.abs(candidate - initialScoreBpm) < Math.abs(bestBpm - initialScoreBpm))) {
      bestScore = phaseScore;
      bestBpm = candidate;
    }
  }

  if (bestScore < minConfidence) return { bpm: initialBpm, confidence: bestScore, refined: false };
  return { bpm: Math.round(bestBpm * 10) / 10, confidence: bestScore, refined: true };
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

  // Anota a personalidade musical de cada seção para o levelgen usar energia e densidade,
  // em vez de depender apenas de rótulos rígidos como "drop" ou "flow".
  const withMetrics = [];
  for (const section of sections) {
    const firstWindow = Math.floor(section.start / sectionWindowSec);
    const lastWindow = Math.min(numWindows, Math.ceil(section.end / sectionWindowSec));
    let energy = 0;
    let onsetDensity = 0;
    let count = 0;
    for (let w = firstWindow; w < lastWindow; w++) {
      energy += windowEnergy[w];
      onsetDensity += windowOnsetDensity[w] / maxDensity;
      count++;
    }
    const avgEnergy = count ? energy / count : 0;
    const avgOnsetDensity = count ? onsetDensity / count : 0;
    withMetrics.push({
      ...section,
      energy: avgEnergy,
      onsetDensity: avgOnsetDensity,
      intensity: Math.max(0, Math.min(1, avgEnergy * 0.65 + avgOnsetDensity * 0.35)),
    });
  }

  // Funde seções minúsculas (<2s) com a vizinha anterior para evitar ruído,
  // mantendo a média ponderada dos dados musicais para a geração do mapa.
  const merged = [];
  for (const section of withMetrics) {
    if (merged.length && section.end - section.start < 2) {
      const previous = merged[merged.length - 1];
      const previousDuration = previous.end - previous.start;
      const sectionDuration = section.end - section.start;
      const totalDuration = previousDuration + sectionDuration;
      for (const metric of ['energy', 'onsetDensity', 'intensity']) {
        previous[metric] = totalDuration > 0
          ? (previous[metric] * previousDuration + section[metric] * sectionDuration) / totalDuration
          : previous[metric];
      }
      previous.end = section.end;
    } else {
      merged.push({ ...section });
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
  const bassOnsets = detectOnsets(
    frames.bassFlux,
    frames.times,
    options.bassOnsetOptions || options.onsetOptions,
  );
  const generalTempo = estimateBpm(onsets, options.bpmOptions);
  const bassTempo = refineBpmFromOnsets(generalTempo.bpm, bassOnsets, options.bassBpmOptions);
  const bpm = bassTempo.refined ? bassTempo.bpm : generalTempo.bpm;
  const bpmConfidence = bassTempo.refined ? bassTempo.confidence : generalTempo.confidence;
  const rawSections = detectSections(frames, onsets, durationSec);
  const sections = deriveTheme(frames, rawSections);

  return {
    durationSec,
    sampleRate,
    bpm,
    bpmConfidence,
    bpmSource: bassTempo.refined ? 'bass' : 'general',
    bassBpmConfidence: bassTempo.confidence,
    onsets,
    bassOnsets,
    sections,
    frames: { times: frames.times, rms: normalize(frames.rms), centroid: frames.centroid },
  };
}
