import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapFromLevel,
  applyMapToLevel,
  encodeMap,
  decodeMap,
  snapToGrid,
  saveMapFor,
  loadMapFor,
  deleteMapFor,
  applyThemeToSections,
  THEMES,
  THEME_NAMES,
} from '../src/game/mapstore.js';
import { generateLevel } from '../src/game/levelgen.js';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

function sampleLevel(bpm = 120, durationSec = 12) {
  const analysis = {
    bpm,
    durationSec,
    sections: [
      { label: 'intro', start: 0, end: 4, color: '#111111', glow: '#222222' },
      { label: 'drop', start: 4, end: 12, color: '#333333', glow: '#444444' },
    ],
  };
  return generateLevel(analysis, { title: 'T', artist: 'A' });
}

test('snapToGrid encaixa na meia-batida', () => {
  // 120 BPM → batida = 0.5s → meia batida = 0.25s
  assert.equal(snapToGrid(0.26, 120), 0.25);
  assert.equal(snapToGrid(0.39, 120), 0.5);
  assert.equal(snapToGrid(0, 120), 0);
});

test('mapFromLevel converte obstáculos para índices de meia-batida', () => {
  const level = sampleLevel();
  const map = mapFromLevel(level);
  assert.equal(map.bpm, 120);
  // ids do mapa batem com os tempos originais (dentro da meia-batida)
  const h = 0.25;
  for (const [idx] of map.obstacles) {
    assert.ok(Math.abs(idx * h - nearestTime(level, idx * h)) <= h / 2 + 1e-9);
  }
  function nearestTime(lvl, t) {
    return lvl.obstacles.reduce((best, o) => (Math.abs(o.time - t) < Math.abs(best - t) ? o.time : best), Infinity);
  }
});

test('applyMapToLevel reconstrói obstáculos com ids novos e cores da seção', () => {
  const level = sampleLevel();
  const custom = {
    bpm: 120,
    theme: 'auto',
    obstacles: [
      [4, 'spike'], // 1.0s (seção intro)
      [20, 'block'], // 5.0s (seção drop)
      [100, 'orb'], // 25s > durationSec → descartado
    ],
    collectibles: [10],
  };
  const out = applyMapToLevel(level, custom);
  assert.equal(out.obstacles.length, 2);
  assert.equal(out.obstacles[0].time, 1);
  assert.equal(out.obstacles[0].section, 'intro');
  assert.equal(out.obstacles[0].color, '#111111');
  assert.equal(out.obstacles[1].section, 'drop');
  assert.notEqual(out.obstacles[0].id, level.obstacles[0]?.id); // ids novos
  assert.equal(out.collectibles.length, 1);
  assert.equal(out.bpm, 120); // resto do nível preservado
  assert.equal(out.beats, level.beats);
});

test('encodeMap/decodeMap fazem o round-trip do link', () => {
  const data = {
    bpm: 128,
    theme: 'neon',
    obstacles: [
      [4, 'spike'],
      [9, 'pad'],
      [12, 'shield'],
    ],
    collectibles: [6, 7],
  };
  const enc = encodeMap(data);
  assert.doesNotMatch(enc, /[+/=]/); // seguro para URL
  assert.deepEqual(decodeMap(enc), data);
  assert.equal(decodeMap('lixo!!!'), null);
  assert.equal(decodeMap(''), null);
});

test('mapa persiste por música e pode ser apagado', () => {
  const storage = fakeStorage();
  const data = { bpm: 100, theme: 'ocean', obstacles: [[2, 'block']], collectibles: [] };
  assert.equal(saveMapFor('k1', data, storage, 123), true);
  assert.deepEqual(loadMapFor('k1', storage), data);
  assert.equal(loadMapFor('outra', storage), null);
  assert.equal(deleteMapFor('k1', storage), true);
  assert.equal(loadMapFor('k1', storage), null);
});

test('temas recolorem as seções mantendo o resto', () => {
  const level = sampleLevel();
  const sunset = applyThemeToSections(level.sections, 'sunset');
  assert.equal(sunset.length, 2);
  assert.equal(sunset[0].color, THEMES.sunset.intro[0]);
  assert.equal(sunset[1].color, THEMES.sunset.drop[0]);
  assert.equal(sunset[0].label, 'intro'); // estrutura intacta
  // 'auto' (sem paleta) devolve as seções originais
  assert.equal(applyThemeToSections(level.sections, 'auto'), level.sections);
  assert.ok(THEME_NAMES.includes('auto'));
});
