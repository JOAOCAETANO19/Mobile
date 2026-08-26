import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fft, isPowerOfTwo, nextPowerOfTwo, hannWindow, magnitudeSpectrum } from '../src/core/fft.js';

test('isPowerOfTwo identifica corretamente', () => {
  assert.equal(isPowerOfTwo(1), true);
  assert.equal(isPowerOfTwo(2), true);
  assert.equal(isPowerOfTwo(1024), true);
  assert.equal(isPowerOfTwo(0), false);
  assert.equal(isPowerOfTwo(3), false);
  assert.equal(isPowerOfTwo(1023), false);
});

test('nextPowerOfTwo arredonda para cima', () => {
  assert.equal(nextPowerOfTwo(1), 1);
  assert.equal(nextPowerOfTwo(5), 8);
  assert.equal(nextPowerOfTwo(1024), 1024);
  assert.equal(nextPowerOfTwo(1025), 2048);
});

test('fft rejeita tamanhos que não são potência de 2', () => {
  assert.throws(() => fft(new Float64Array(3), new Float64Array(3)));
});

test('fft de um sinal DC constante concentra energia no bin 0', () => {
  const n = 64;
  const re = new Float64Array(n).fill(1);
  const im = new Float64Array(n);
  fft(re, im);
  assert.ok(Math.abs(re[0] - n) < 1e-9);
  for (let i = 1; i < n; i++) {
    assert.ok(Math.abs(re[i]) < 1e-9);
    assert.ok(Math.abs(im[i]) < 1e-9);
  }
});

test('fft detecta a frequência correta de uma senoide pura', () => {
  const n = 256;
  const k = 10; // bin alvo
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    re[i] = Math.sin((2 * Math.PI * k * i) / n);
  }
  fft(re, im);
  const mags = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) mags[i] = Math.hypot(re[i], im[i]);

  let peakBin = 0, peakVal = 0;
  for (let i = 0; i < mags.length; i++) {
    if (mags[i] > peakVal) { peakVal = mags[i]; peakBin = i; }
  }
  assert.equal(peakBin, k);
});

test('hannWindow tem valores entre 0 e 1 e é simétrica', () => {
  const w = hannWindow(128);
  assert.ok(w[0] < 1e-9);
  for (const v of w) assert.ok(v >= -1e-9 && v <= 1 + 1e-9);
  assert.ok(Math.abs(w[10] - w[w.length - 1 - 10]) < 1e-9);
});

test('magnitudeSpectrum retorna metade do tamanho da entrada', () => {
  const n = 512;
  const samples = new Float64Array(n).map((_, i) => Math.sin((2 * Math.PI * 5 * i) / n));
  const window = hannWindow(n);
  const mags = magnitudeSpectrum(samples, window);
  assert.equal(mags.length, n / 2);
});
