import { test } from 'node:test';
import assert from 'node:assert/strict';
import { physicsForBpm, generateBeatGrid, generateLevel, findCheckpoint, JUMP_HEIGHT_CELLS } from '../src/game/levelgen.js';

function fakeAnalysis(bpm, durationSec, sections) {
  return { bpm, durationSec, sections };
}

test('physicsForBpm: o arco do pulo dura exatamente 1 batida', () => {
  const bpm = 120;
  const { T, v, g } = physicsForBpm(bpm);
  assert.ok(Math.abs(T - 0.5) < 1e-9);
  // Tempo para y voltar a 0 partindo de v com gravidade g é 2v/g == T
  const timeToLand = (2 * v) / g;
  assert.ok(Math.abs(timeToLand - T) < 1e-9);
});

test('physicsForBpm: altura máxima do pulo é JUMP_HEIGHT_CELLS', () => {
  const { v, g } = physicsForBpm(140);
  const peakTime = v / g;
  const peakHeight = v * peakTime - 0.5 * g * peakTime * peakTime;
  assert.ok(Math.abs(peakHeight - JUMP_HEIGHT_CELLS) < 1e-9);
});

test('generateBeatGrid gera o número correto de batidas', () => {
  const beats = generateBeatGrid(120, 4); // 0.5s por batida, 4s -> 8 batidas
  assert.equal(beats.length, 8);
  assert.equal(beats[0].time, 0);
  assert.ok(Math.abs(beats[7].time - 3.5) < 1e-9);
});

test('generateLevel é determinístico para a mesma análise e faixa', () => {
  const analysis = fakeAnalysis(128, 8, [
    { label: 'intro', start: 0, end: 2, color: '#111' },
    { label: 'drop', start: 2, end: 8, color: '#222' },
  ]);
  const track = { title: 'Song', artist: 'Artist' };
  const level1 = generateLevel(analysis, track);
  const level2 = generateLevel(analysis, track);
  assert.deepEqual(
    level1.obstacles.map((o) => ({ type: o.type, time: o.time })),
    level2.obstacles.map((o) => ({ type: o.type, time: o.time }))
  );
  assert.equal(level1.seed, level2.seed);
});

test('generateLevel produz mapas diferentes para faixas diferentes (seeds diferentes)', () => {
  const analysis = fakeAnalysis(128, 8, [{ label: 'drop', start: 0, end: 8, color: '#222' }]);
  const levelA = generateLevel(analysis, { title: 'Song A', artist: 'X' });
  const levelB = generateLevel(analysis, { title: 'Song B', artist: 'X' });
  assert.notEqual(levelA.seed, levelB.seed);
});

test('generateLevel não coloca obstáculos em seções break/intro', () => {
  const analysis = fakeAnalysis(120, 4, [{ label: 'break', start: 0, end: 4, color: '#000' }]);
  const level = generateLevel(analysis, { title: 'Quiet', artist: 'X' });
  assert.equal(level.obstacles.length, 0);
});

test('generateLevel planta espinhos no meio da batida (beat + T/2)', () => {
  const analysis = fakeAnalysis(120, 4, [{ label: 'drop', start: 0, end: 4, color: '#000' }]);
  const level = generateLevel(analysis, { title: 'Drop', artist: 'X' });
  const { T } = physicsForBpm(120);
  for (const ob of level.obstacles) {
    const beat = level.beats[ob.beatIndex];
    assert.ok(Math.abs(ob.time - (beat.time + T / 2)) < 1e-9);
  }
});

test('findCheckpoint retorna o início da seção correta e progresso em %', () => {
  const level = {
    durationSec: 100,
    sections: [
      { label: 'intro', start: 0, end: 10 },
      { label: 'build', start: 10, end: 40 },
      { label: 'drop', start: 40, end: 100 },
    ],
  };
  const checkpoint = findCheckpoint(level, 45);
  assert.equal(checkpoint.label, 'drop');
  assert.equal(checkpoint.time, 40);
  assert.equal(checkpoint.progressPct, 45);
});

test('variedade de obstáculos: blocos frequentes em build, escudo em seções densas, abertura previsível', () => {
  const allowed = ['spike', 'block', 'pad', 'orb', 'shield'];

  // Seção build longa: blocos devem aparecer com frequência (o "build" ganha variedade).
  const buildAnalysis = fakeAnalysis(128, 24, [
    { label: 'intro', start: 0, end: 3, color: '#111' },
    { label: 'build', start: 3, end: 24, color: '#222' },
  ]);
  const build = generateLevel(buildAnalysis, { title: 'Variedade', artist: 'Test' });
  const types = build.obstacles.map((o) => o.type);
  for (const t of types) assert.ok(allowed.includes(t), `tipo inesperado: ${t}`);
  const blocks = types.filter((t) => t === 'block').length;
  const spikes = types.filter((t) => t === 'spike').length;
  assert.ok(blocks > 0, 'build precisa ter blocos');
  assert.ok(blocks >= spikes * 0.4, `blocos frequentes em build (${blocks} blocos vs ${spikes} espinhos)`);

  // Seção drop longa: deve existir pelo menos um escudo (respiro do jogador).
  const drop = generateLevel(
    fakeAnalysis(140, 40, [{ label: 'drop', start: 0, end: 40, color: '#333' }]),
    { title: 'Escudo', artist: 'Test' }
  );
  assert.ok(drop.obstacles.some((o) => o.type === 'shield'), 'drop longo deve ter pelo menos um escudo');

  // Abertura previsível: os 3 primeiros obstáculos do nível são sempre espinhos.
  assert.ok(
    build.obstacles.slice(0, 3).every((o) => o.type === 'spike'),
    'os 3 primeiros obstáculos devem ser espinhos'
  );
});
