import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, hashString, seedFromTrack, createRng } from '../src/core/rng.js';

test('mulberry32 é determinístico para a mesma seed', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const seqA = Array.from({ length: 5 }, () => a());
  const seqB = Array.from({ length: 5 }, () => b());
  assert.deepEqual(seqA, seqB);
});

test('mulberry32 produz sequências diferentes para seeds diferentes', () => {
  const a = mulberry32(1);
  const b = mulberry32(2);
  assert.notEqual(a(), b());
});

test('mulberry32 gera valores no intervalo [0,1)', () => {
  const rand = mulberry32(7);
  for (let i = 0; i < 1000; i++) {
    const v = rand();
    assert.ok(v >= 0 && v < 1);
  }
});

test('hashString é determinístico e sensível ao conteúdo', () => {
  assert.equal(hashString('abc'), hashString('abc'));
  assert.notEqual(hashString('abc'), hashString('abd'));
});

test('seedFromTrack gera a mesma seed para os mesmos metadados', () => {
  const track = { title: 'Song', artist: 'Artist', duration: 180.4 };
  assert.equal(seedFromTrack(track), seedFromTrack({ ...track }));
});

test('createRng aceita string ou número como seed', () => {
  const r1 = createRng('hello');
  const r2 = createRng('hello');
  assert.equal(r1(), r2());
});
