import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFrames, detectOnsets, estimateBpm, detectSections, deriveTheme, analyzeAudioBuffer, toMono } from '../src/core/analysis.js';

const SAMPLE_RATE = 22050;

/** Cria um "AudioBuffer" mínimo compatível com o pipeline, a partir de um Float32Array mono. */
function fakeAudioBuffer(mono, sampleRate = SAMPLE_RATE) {
  return {
    sampleRate,
    length: mono.length,
    numberOfChannels: 1,
    getChannelData: () => mono,
  };
}

/** Sintetiza um sinal com "kicks" (pulsos de energia) a um BPM alvo. */
function synthKicks(bpm, durationSec, sampleRate = SAMPLE_RATE) {
  const mono = new Float32Array(Math.floor(durationSec * sampleRate));
  const beatInterval = 60 / bpm;
  for (let t = 0; t < durationSec; t += beatInterval) {
    const startSample = Math.floor(t * sampleRate);
    const len = Math.floor(0.05 * sampleRate);
    for (let i = 0; i < len && startSample + i < mono.length; i++) {
      const decay = Math.exp(-i / (len * 0.3));
      mono[startSample + i] += Math.sin((2 * Math.PI * 90 * i) / sampleRate) * decay;
    }
  }
  return mono;
}

test('toMono faz a média dos canais', () => {
  const buffer = {
    numberOfChannels: 2,
    length: 4,
    getChannelData: (ch) => (ch === 0 ? new Float32Array([1, 1, 1, 1]) : new Float32Array([-1, -1, -1, -1])),
  };
  const mono = toMono(buffer);
  assert.deepEqual(Array.from(mono), [0, 0, 0, 0]);
});

test('computeFrames produz flux/centroid/rms do mesmo tamanho', () => {
  const mono = synthKicks(120, 2);
  const frames = computeFrames(mono, SAMPLE_RATE);
  assert.equal(frames.flux.length, frames.centroid.length);
  assert.equal(frames.flux.length, frames.rms.length);
  assert.ok(frames.flux.length > 0);
});

test('detectOnsets encontra picos correspondentes aos kicks sintéticos', () => {
  const bpm = 120;
  const mono = synthKicks(bpm, 4);
  const frames = computeFrames(mono, SAMPLE_RATE);
  const onsets = detectOnsets(frames.flux, frames.times);
  // 4s a 120 BPM = 8 batidas; aceita alguma folga de detecção.
  assert.ok(onsets.length >= 5 && onsets.length <= 10, `esperado ~8 onsets, veio ${onsets.length}`);
});

test('estimateBpm recupera o BPM aproximado de um sinal sintético a 128 BPM', () => {
  const bpm = 128;
  const mono = synthKicks(bpm, 8);
  const frames = computeFrames(mono, SAMPLE_RATE);
  const onsets = detectOnsets(frames.flux, frames.times);
  const { bpm: estimated } = estimateBpm(onsets);
  assert.ok(Math.abs(estimated - bpm) <= 3, `esperado ~${bpm} BPM, veio ${estimated}`);
});

test('estimateBpm com poucos onsets retorna fallback com confiança 0', () => {
  const { bpm, confidence } = estimateBpm([{ time: 0 }, { time: 0.5 }]);
  assert.equal(bpm, 120);
  assert.equal(confidence, 0);
});

test('detectSections cobre toda a duração sem buracos', () => {
  const mono = synthKicks(120, 6);
  const frames = computeFrames(mono, SAMPLE_RATE);
  const onsets = detectOnsets(frames.flux, frames.times);
  const sections = detectSections(frames, onsets, 6);
  assert.ok(sections.length >= 1);
  assert.equal(sections[0].start, 0);
  assert.ok(Math.abs(sections[sections.length - 1].end - 6) < 1e-6);
  for (let i = 1; i < sections.length; i++) {
    assert.equal(sections[i].start, sections[i - 1].end);
  }
});

test('deriveTheme atribui uma cor válida a cada seção', () => {
  const mono = synthKicks(120, 4);
  const frames = computeFrames(mono, SAMPLE_RATE);
  const onsets = detectOnsets(frames.flux, frames.times);
  const sections = detectSections(frames, onsets, 4);
  const themed = deriveTheme(frames, sections);
  for (const s of themed) {
    assert.match(s.color, /^hsl\(/);
    assert.match(s.glow, /^hsl\(/);
  }
});

test('analyzeAudioBuffer pipeline completo retorna estrutura esperada', () => {
  const mono = synthKicks(128, 8);
  const buffer = fakeAudioBuffer(mono);
  const analysis = analyzeAudioBuffer(buffer);
  assert.ok(analysis.bpm > 0);
  assert.ok(analysis.sections.length >= 1);
  assert.ok(Array.isArray(analysis.onsets));
  assert.ok(analysis.durationSec > 0);
});
