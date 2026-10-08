import test from 'node:test';
import assert from 'node:assert/strict';
import { getLocalRecords, makeTrackRecordId, mergeRecordSets, saveGameRecord } from '../src/core/records.js';

function installMemoryStorage() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const data = new Map();
  const memoryStorage = {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
    clear() { data.clear(); },
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage });
  return () => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  };
}

test('mergeRecordSets keeps the highest score/combo and completion flag', () => {
  const records = mergeRecordSets(
    [{ track_id: 'spotify:abc', track_title: 'Faixa', score: 120, best_combo: 8, completed: false, updated_at: '2025-01-01T00:00:00Z' }],
    [{ track_id: 'spotify:abc', track_title: 'Faixa', score: 95, best_combo: 12, completed: true, updated_at: '2025-02-01T00:00:00Z' }],
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].score, 120);
  assert.equal(records[0].best_combo, 12);
  assert.equal(records[0].completed, true);
});

test('track IDs are stable and do not expose a direct stream URL', async () => {
  const metadata = {
    source: 'direct',
    id: 'https://music.example/track.mp3?signature=private-token',
    title: 'Link direto',
    artist: 'Link direto',
  };
  const first = await makeTrackRecordId(metadata);
  const second = await makeTrackRecordId(metadata);
  assert.equal(first, second);
  assert.match(first, /^direct:[a-f0-9]+$/);
  assert.equal(first.includes('private-token'), false);
  assert.notEqual(first, await makeTrackRecordId({ ...metadata, source: 'audius' }));
});

test('local records are isolated between guest and user namespaces', async () => {
  const restoreStorage = installMemoryStorage();
  try {
    const trackMeta = { source: 'demo', id: 'demo-track', title: 'Demo', artist: 'Rhythm Dash', duration: 32 };
    await saveGameRecord({ trackMeta, score: 42, bestCombo: 5, userId: null });
    await saveGameRecord({ trackMeta, score: 90, bestCombo: 8, userId: 'user-1' });

    assert.equal(getLocalRecords().length, 1);
    assert.equal(getLocalRecords()[0].score, 42);
    assert.equal(getLocalRecords('user-1').length, 1);
    assert.equal(getLocalRecords('user-1')[0].score, 90);
    assert.equal(getLocalRecords('user-2').length, 0);
  } finally {
    restoreStorage();
  }
});
