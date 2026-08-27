import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  averageOffset,
  clampOffset,
  matchTapsToTicks,
  getAudioOffsetMs,
  setAudioOffsetMs,
} from '../src/core/latency.js';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

test('averageOffset: média descartando taps fora do ritmo (> ±250ms)', () => {
  assert.equal(averageOffset([30, 40, 35]), 35);
  assert.equal(averageOffset([30, 40, 300, -280]), 35); // outliers fora
  assert.equal(averageOffset([]), 0); // sem amostra -> sem compensação
  assert.equal(averageOffset([999, -999]), 0); // tudo outlier -> 0
});

test('averageOffset respeita o clamp de segurança (±400ms)', () => {
  assert.equal(averageOffset([240, 239, 241]), 240);
  assert.equal(clampOffset(9999), 400);
  assert.equal(clampOffset(-9999), -400);
  assert.equal(clampOffset(NaN), 0);
});

test('matchTapsToTicks casa cada toque com o bipe mais próximo', () => {
  const ticks = [0.6, 1.2, 1.8, 2.4];
  // toques ~40ms atrasados (simulando Bluetooth)
  const taps = [0.64, 1.24, 1.84, 2.44];
  const offsets = matchTapsToTicks(taps, ticks);
  assert.equal(offsets.length, 4);
  for (const o of offsets) assert.ok(Math.abs(o - 40) < 1.5, `offset ${o} ~ 40ms`);
  // toque longe de qualquer bipe é ignorado
  assert.equal(matchTapsToTicks([0.0], ticks).length, 0);
});

test('offset persiste no storage e volta com clamp', () => {
  const storage = fakeStorage();
  assert.equal(getAudioOffsetMs(storage), 0); // padrão
  setAudioOffsetMs(87, storage);
  assert.equal(getAudioOffsetMs(storage), 87);
  setAudioOffsetMs(5000, storage); // clamp
  assert.equal(getAudioOffsetMs(storage), 400);
});
