import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackKey, applyRunToStats, topPlayed, pruneStats } from '../src/game/stats.js';
import { sampleGhost, ghostYAt, saveGhostFor, loadGhostFor } from '../src/game/ghost.js';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

test('trackKey é estável e normaliza maiúsculas/espaços', () => {
  assert.equal(trackKey({ title: ' Song X ', artist: 'DJ' }), 'song x•dj');
  assert.equal(trackKey({ title: 'Song X' }), 'song x•');
});

test('applyRunToStats guarda os melhores valores e marca recordes', () => {
  let stats = {};
  const r1 = applyRunToStats(stats, 'k', { score: 100, bestCombo: 5, progressPct: 40, finished: false });
  assert.deepEqual(r1.records, { score: true, combo: true, progress: true, firstPlay: true });
  stats = r1.stats;
  assert.equal(stats.k.plays, 1);
  assert.equal(stats.k.finishes, 0);

  // corrida PIOR: nenhum recorde novo, mas plays aumenta
  const r2 = applyRunToStats(stats, 'k', { score: 50, bestCombo: 2, progressPct: 10, finished: false });
  assert.deepEqual(r2.records, { score: false, combo: false, progress: false, firstPlay: false });
  assert.equal(r2.stats.k.plays, 2);
  assert.equal(r2.stats.k.bestScore, 100);

  // corrida MELHOR: recorde de score e progresso, finish conta
  const r3 = applyRunToStats(stats, 'k', { score: 250, bestCombo: 4, progressPct: 100, finished: true });
  assert.equal(r3.records.score, true);
  assert.equal(r3.records.combo, false); // combo 4 < 5
  assert.equal(r3.stats.k.finishes, 1);
  assert.equal(r3.stats.k.bestProgressPct, 100);
});

test('topPlayed ordena pelos mais recentes e poda o excesso', () => {
  let stats = {};
  for (let i = 0; i < 5; i++) {
    stats = applyRunToStats(stats, `m${i}`, { score: i, bestCombo: 0, progressPct: i }, 1000 + i).stats;
  }
  const top = topPlayed(stats, 3);
  assert.deepEqual(top.map(([k]) => k), ['m4', 'm3', 'm2']);

  const many = {};
  for (let i = 0; i < 70; i++) many[`x${i}`] = { lastPlayedAt: i };
  assert.equal(Object.keys(pruneStats(many, 60)).length, 60);
});

test('sampleGhost respeita o espaçamento mínimo entre amostras', () => {
  const rec = [];
  assert.equal(sampleGhost(rec, 0, 0), true);
  assert.equal(sampleGhost(rec, 0.01, 0.1), false); // perto demais
  assert.equal(sampleGhost(rec, 0.06, 0.2), true);
  assert.equal(rec.length, 2);
});

test('ghostYAt interpola a altura entre amostras', () => {
  const rec = [
    [0, 0],
    [0.5, 1],
    [1.0, 0],
  ];
  assert.equal(ghostYAt(rec, 0), 0);
  assert.equal(ghostYAt(rec, 0.25), 0.5); // meio do arco de subida
  assert.equal(ghostYAt(rec, 0.5), 1);
  assert.equal(ghostYAt(rec, 0.75), 0.5);
  assert.equal(ghostYAt(rec, -1), null); // fora do intervalo
  assert.equal(ghostYAt(rec, 2), null);
  assert.equal(ghostYAt([], 0.5), null);
});

test('fantasma persiste e volta por música', () => {
  const storage = fakeStorage();
  const rec = [
    [0, 0],
    [0.5, 1],
  ];
  assert.equal(saveGhostFor('musica', rec, storage), true);
  assert.deepEqual(loadGhostFor('musica', storage), rec);
  assert.equal(loadGhostFor('outra', storage), null);
});
