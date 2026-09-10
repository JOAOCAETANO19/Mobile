import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMood, tuningFor, getArchetype, MOOD_TUNING, IDENTITY_TUNING } from '../src/game/archetypes.js';
import { generateLevel } from '../src/game/levelgen.js';

function frames(rms, centroid, n = 24) {
  return {
    rms: Array(n).fill(rms),
    centroid: Array(n).fill(centroid),
    times: Array.from({ length: n }, (_, i) => i * 0.5),
  };
}
function onsets(rate, durationSec, strength = 0.5) {
  const n = Math.round(rate * durationSec);
  return Array.from({ length: n }, (_, i) => ({ time: (i + 0.5) / rate, strength }));
}

const DUR = 12;

// canções sintéticas por quadrante
const FURIA = { durationSec: DUR, frames: frames(0.9, 0.3), onsets: onsets(7.5, DUR) }; // trap/metal
const GLITCH = { durationSec: DUR, frames: frames(0.85, 0.7), onsets: onsets(7, DUR) }; // drum&bass
const NOTURNO = { durationSec: DUR, frames: frames(0.55, 0.3), onsets: onsets(1.2, DUR) }; // lo-fi
const LUNA = { durationSec: DUR, frames: frames(0.55, 0.7), onsets: onsets(1.4, DUR) }; // balada
const DEMO_LIMPA = { durationSec: DUR, frames: frames(0.1, 0.3), onsets: onsets(8, DUR) }; // mix "limpa"

test('classifica quadrantes por agitação × brilho', () => {
  assert.equal(classifyMood(FURIA), 'furia');
  assert.equal(classifyMood(GLITCH), 'glitch');
  assert.equal(classifyMood(NOTURNO), 'noturno');
  assert.equal(classifyMood(LUNA), 'luna');
});

test('mix muito limpa/sintética nunca vira fúria (piso de energia)', () => {
  assert.equal(classifyMood(DEMO_LIMPA), 'luna');
});

test('classificação é determinística (mesmo áudio, mesmo arquétipo)', () => {
  assert.equal(classifyMood(FURIA), classifyMood(FURIA));
  assert.equal(classifyMood(GLITCH), classifyMood(GLITCH));
});

test('getArchetype devolve personalidade + tunagem + visuais', () => {
  const a = getArchetype(FURIA);
  assert.equal(a.key, 'furia');
  assert.ok(a.label);
  assert.ok(a.emoji);
  assert.equal(a.tuning, MOOD_TUNING.furia);
  assert.equal(a.visuals.particle, 'ember');
});

test('tuningFor: sem dados de sinal → tunagem neutra (comportamento clássico)', () => {
  const empty = { bpm: 120, durationSec: DUR, sections: [], onsets: [], frames: { rms: [], centroid: [], times: [] } };
  assert.deepEqual(tuningFor(empty), IDENTITY_TUNING);
  assert.equal(tuningFor(FURIA).densityMul, MOOD_TUNING.furia.densityMul);
  assert.equal(tuningFor(NOTURNO).silenceChance, MOOD_TUNING.noturno.silenceChance);
});

function musicalAnalysis(mood) {
  const { T } = { T: 0.5 };
  return {
    bpm: 120,
    durationSec: DUR,
    sections: [{ label: 'flow', start: 0, end: DUR, color: '#000' }],
    onsets: mood === 'furia' ? onsets(7.5, DUR, 0.5) : onsets(7.5, DUR, 0.5), // mesmas batidas!
    frames: mood === 'furia' ? frames(0.95, 0.3) : frames(0.45, 0.35), // furia mais "cheia"
  };
}

test('a personalidade muda o mapa gerado (mesma música, mesma seed)', () => {
  const aF = { ...musicalAnalysis('furia'), frames: frames(0.95, 0.3) };
  const aN = { ...musicalAnalysis('noturno'), frames: frames(0.45, 0.35) };
  aN.onsets = onsets(1.2, DUR, 0.5); // fuera muda a agitação → noturno
  const f = generateLevel(aF, { title: 'X', artist: 'Y' });
  const n = generateLevel(aN, { title: 'X', artist: 'Y' });
  assert.equal(f.mood, 'furia');
  assert.equal(n.mood, 'noturno');
  assert.ok(f.obstacles.length >= n.obstacles.length, 'fúria ≥ noturno em obstáculos');
});

test('geração permanece determinística com arquétipo', () => {
  const m = { ...musicalAnalysis('furia') };
  m.frames = frames(0.95, 0.3);
  m.onsets = onsets(7.5, DUR, 0.5);
  const l1 = generateLevel(m, { title: 'Q', artist: 'W' });
  const l2 = generateLevel(m, { title: 'Q', artist: 'W' });
  assert.deepEqual(l1.obstacles, l2.obstacles);
  assert.deepEqual(l1.collectibles, l2.collectibles);
  assert.equal(l1.mood, l2.mood);
});

test('dinâmica da fase respeita o arquétipo entre duas músicas iguais em grid', () => {
  const base = { bpm: 120, durationSec: DUR, sections: [{ label: 'flow', start: 0, end: DUR, color: '#000' }] };
  const track = { title: 'Z', artist: 'A' };
  // Fúria: mesma Grade + sinais de intensidade; Noturno: mesma grade acalmada.
  const f = generateLevel({ ...base, frames: frames(0.95, 0.3), onsets: onsets(7.5, DUR, 0.5) }, track);
  const n = generateLevel({ ...base, frames: frames(0.45, 0.35), onsets: onsets(1.2, DUR, 0.4) }, track);
  assert.equal(f.mood, 'furia');
  assert.equal(n.mood, 'noturno');
  assert.ok(f.obstacles.length > n.obstacles.length, 'mesma grade, fúria segura muito mais obstáculos');
});
