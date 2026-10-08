import { test } from 'node:test';
import assert from 'node:assert/strict';
import { physicsForBpm, generateBeatGrid, estimateBeatOffset, generateLevel, findCheckpoint, JUMP_HEIGHT_CELLS, RHYTHM_PATTERNS } from '../src/game/levelgen.js';

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

test('estimateBeatOffset alinha a grade aos onsets quando a faixa começa fora do zero', () => {
  const offset = estimateBeatOffset([
    { time: 0.12, strength: 0.95 },
    { time: 0.62, strength: 0.8 },
    { time: 1.12, strength: 1 },
    { time: 1.62, strength: 0.75 },
    { time: 1.86, strength: 0.08 },
  ], 120);
  assert.ok(Math.abs(offset - 0.12) < (0.5 / 64), `offset estimado ${offset}`);
});

test('generateLevel ancora a batida grave quando há onsets baixos suficientes', () => {
  const level = generateLevel({
    ...fakeAnalysis(120, 4, [{ label: 'drop', start: 0, end: 4 }]),
    onsets: [0.01, 0.51, 1.01].map((time) => ({ time, strength: 1 })),
    bassOnsets: [0.14, 0.64, 1.14, 1.64].map((time) => ({ time, strength: 1 })),
  }, { title: 'Bass sync', artist: 'Rhythm' });
  assert.equal(level.timingSource, 'bass');
  assert.ok(Math.abs(level.beatOffset - 0.14) < (0.5 / 64));
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
  assert.ok(level1.obstacles.every((obstacle) => obstacle.time < analysis.durationSec));
});

test('energia da seção ajusta a cadência no Modo Livre e onsets marcantes chegam ao mapa', () => {
  const durationSec = 24;
  const calm = generateLevel(fakeAnalysis(120, durationSec, [
    { label: 'flow', start: 0, end: durationSec, intensity: 0.05 },
  ]), { title: 'Energy test', artist: 'X' }, 'free');
  const energetic = generateLevel({
    ...fakeAnalysis(120, durationSec, [{ label: 'flow', start: 0, end: durationSec, intensity: 1 }]),
    onsets: [{ time: 0.2, strength: 0.98 }, { time: 3.2, strength: 0.9 }],
  }, { title: 'Energy test', artist: 'X' }, 'free');
  assert.ok(energetic.obstacles.length > calm.obstacles.length, 'flow intenso deve ganhar cadência');
  assert.ok(energetic.obstacles.some((ob) => ob.accent > 0.9), 'acento da música deve chegar ao mapa');
});

test('generateLevel produz mapas diferentes para faixas diferentes (seeds diferentes)', () => {
  const analysis = fakeAnalysis(128, 8, [{ label: 'drop', start: 0, end: 8, color: '#222' }]);
  const levelA = generateLevel(analysis, { title: 'Song A', artist: 'X' });
  const levelB = generateLevel(analysis, { title: 'Song B', artist: 'X' });
  assert.notEqual(levelA.seed, levelB.seed);
});

test('Modo Batida mantém um salto por beat nos breaks; Modo Livre deixa esses trechos sem hazards', () => {
  const analysis = fakeAnalysis(120, 4, [{ label: 'break', start: 0, end: 4, color: '#000' }]);
  const track = { title: 'Quiet', artist: 'X' };
  const beatLevel = generateLevel(analysis, track, 'beat');
  const freeLevel = generateLevel(analysis, track, 'free');
  assert.equal(beatLevel.mapMode, 'beat');
  assert.equal(beatLevel.obstacles.length, 8);
  assert.ok(beatLevel.obstacles.every((obstacle) => obstacle.section === 'break'));
  assert.equal(freeLevel.mapMode, 'free');
  assert.equal(freeLevel.obstacles.length, 0);
});

test('Modo Batida não omite beats entre seções e usa onsets gerais se faltarem graves', () => {
  const durationSec = 9.9;
  const analysis = {
    ...fakeAnalysis(120, durationSec, [
      { label: 'intro', start: 0, end: 2, color: '#111' },
      { label: 'drop', start: 2, end: 4, color: '#222' },
      { label: 'break', start: 4, end: 6, color: '#333' },
      { label: 'outro', start: 6, end: durationSec, color: '#444' },
    ]),
    onsets: [0.13, 0.63, 1.13, 1.63].map((time) => ({ time, strength: 0.9 })),
    bassOnsets: [{ time: 0.1, strength: 1 }, { time: 0.6, strength: 1 }],
  };
  const level = generateLevel(analysis, { title: 'Every beat', artist: 'X' });
  const expectedBeats = level.beats.filter((beat) => beat.time + level.physics.T / 2 < durationSec);
  assert.equal(level.timingSource, 'general');
  assert.equal(level.obstacles.length, expectedBeats.length);
  assert.deepEqual(
    level.obstacles.map((obstacle) => obstacle.beatIndex),
    expectedBeats.map((beat) => beat.index),
  );
  assert.ok(level.obstacles.some((obstacle) => obstacle.section === 'break'));
});

test('Modo Batida cria exatamente um obstáculo saltável no meio de cada beat', () => {
  const analysis = fakeAnalysis(120, 4, [{ label: 'drop', start: 0, end: 4, color: '#000' }]);
  const level = generateLevel(analysis, { title: 'Drop', artist: 'X' }, 'beat');
  const { T } = physicsForBpm(120);
  const expectedBeats = level.beats.filter((beat) => beat.time + T / 2 < analysis.durationSec);
  assert.equal(level.obstacles.length, expectedBeats.length);
  assert.equal(new Set(level.obstacles.map((obstacle) => obstacle.beatIndex)).size, expectedBeats.length);
  assert.ok(level.obstacles.every((obstacle) => ['spike', 'block'].includes(obstacle.type)));
  for (const ob of level.obstacles) {
    const beat = level.beats[ob.beatIndex];
    assert.ok(Math.abs(ob.time - (beat.time + T / 2)) < 1e-9, `${ob.type} fora do pico do pulo`);
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
  const build = generateLevel(buildAnalysis, { title: 'Variedade', artist: 'Test' }, 'free');
  const types = build.obstacles.map((o) => o.type);
  for (const t of types) assert.ok(allowed.includes(t), `tipo inesperado: ${t}`);
  const blocks = types.filter((t) => t === 'block').length;
  const spikes = types.filter((t) => t === 'spike').length;
  assert.ok(blocks > 0, 'build precisa ter blocos');
  assert.ok(blocks >= spikes * 0.4, `blocos frequentes em build (${blocks} blocos vs ${spikes} espinhos)`);

  // Seção drop longa: deve existir pelo menos um escudo (respiro do jogador).
  const drop = generateLevel(
    fakeAnalysis(140, 40, [{ label: 'drop', start: 0, end: 40, color: '#333' }]),
    { title: 'Escudo', artist: 'Test' },
    'free',
  );
  assert.ok(drop.obstacles.some((o) => o.type === 'shield'), 'drop longo deve ter pelo menos um escudo');

  // Abertura previsível: os 3 primeiros obstáculos do nível são sempre espinhos.
  assert.ok(
    build.obstacles.slice(0, 3).every((o) => o.type === 'spike'),
    'os 3 primeiros obstáculos devem ser espinhos'
  );
});

test('o pad cai no tempo da batida e deixa uma janela justa para retomar o pulo', () => {
  const level = generateLevel(
    fakeAnalysis(120, 50, [{ label: 'drop', start: 0, end: 50, intensity: 0.8 }]),
    { title: 'Pad timing', artist: 'Rhythm' },
    'free',
  );
  const pads = level.obstacles.filter((ob) => ob.type === 'pad');
  assert.ok(pads.length > 0, 'drop longo deve gerar frases com pad');
  for (const pad of pads) {
    const beat = level.beats[pad.beatIndex];
    assert.equal(pad.pattern, 'padSpike');
    assert.ok(Math.abs(pad.time - beat.time) < 1e-9, 'pad precisa chegar quando o jogador está no chão');
    const nextHazard = level.obstacles.find((ob) => ob.phraseId === pad.phraseId && ob.type === 'spike');
    assert.ok(nextHazard, 'frase do pad precisa ter um próximo desafio');
    assert.ok(nextHazard.time - pad.time >= level.physics.T * 2, 'deve haver tempo para pousar e preparar o próximo salto');
  }
});

test('a frase do orb deixa espaço para pousar antes de pedir outro salto', () => {
  const level = generateLevel(
    fakeAnalysis(120, 50, [{ label: 'drop', start: 0, end: 50, intensity: 0.8 }]),
    { title: 'Orb timing', artist: 'Rhythm' },
    'free',
  );
  const bridgeOrbs = level.obstacles.filter((ob) => ob.pattern === 'orbBridge' && ob.type === 'orb');
  assert.ok(bridgeOrbs.length > 0, 'drop longo deve gerar frases com orb');
  for (const orb of bridgeOrbs) {
    const nextHazard = level.obstacles.find((ob) => ob.phraseId === orb.phraseId
      && ob.type === 'spike'
      && ob.time > orb.time);
    assert.ok(nextHazard);
    assert.ok(nextHazard.time - orb.time >= level.physics.T * 2, 'orb não deve levar a um salto impossível');
  }
});

test('o gerador respeita limites entre drop e break ao compor frases', () => {
  const level = generateLevel(fakeAnalysis(128, 20, [
    { label: 'drop', start: 0, end: 2.4, color: '#6633cc' },
    { label: 'break', start: 2.4, end: 6.1, color: '#222244' },
    { label: 'drop', start: 6.1, end: 20, color: '#ff4488' },
  ]), { title: 'Seções', artist: 'Rhythm' }, 'free');
  for (const obstacle of level.obstacles) {
    assert.ok(!(obstacle.time >= 2.4 && obstacle.time < 6.1), `obstáculo ${obstacle.id} invadiu o break`);
  }
});

test('Modo Livre compõe frases variadas sem ocupar duas vezes o mesmo beat', () => {
  // (a) A própria tabela: os slots de cada padrão ocupam batidas distintas, dentro do alcance
  for (const [name, pattern] of Object.entries(RHYTHM_PATTERNS)) {
    const beatUses = pattern.slots.map((s) => Math.floor(s.offset));
    assert.equal(new Set(beatUses).size, beatUses.length, `padrão "${name}" ocupa a mesma batida duas vezes`);
    for (const b of beatUses) {
      assert.ok(b >= 0 && b < pattern.beats, `padrão "${name}" com slot fora do alcance de ${pattern.beats} batidas`);
    }
  }

  // (b) Geração: em um drop longo, nenhuma batida recebe dois obstáculos
  const level = generateLevel(
    fakeAnalysis(128, 32, [{ label: 'drop', start: 0, end: 32, color: '#222' }]),
    { title: 'Patterns', artist: 'Rhythm' },
    'free',
  );
  assert.ok(level.obstacles.length > 10, 'drop longo deveria ter obstáculos de sobra');

  const byBeat = new Map();
  for (const ob of level.obstacles) {
    assert.ok(
      !byBeat.has(ob.beatIndex),
      `beat ${ob.beatIndex} ocupado duas vezes: ${byBeat.get(ob.beatIndex)} e ${ob.id}`
    );
    byBeat.set(ob.beatIndex, ob.id);
  }

  // (c) Os padrões de 2 batidas existem de fato no mapa gerado
  const nextAt = (ob) => level.obstacles.find((o) => o.beatIndex === ob.beatIndex + 1);
  const hasDouble = level.obstacles.some((ob) => ob.type === 'spike' && nextAt(ob)?.type === 'spike');
  const hasBlockSpike = level.obstacles.some((ob) => ob.type === 'block' && nextAt(ob)?.type === 'spike');
  const hasOrbBridge = level.obstacles.some((ob) => ob.pattern === 'orbBridge' && ob.type === 'orb');
  assert.ok(hasDouble, 'drop longo precisa ter "double" (dois pulos em sequência)');
  assert.ok(hasBlockSpike, 'drop longo precisa ter "bloco+espinho"');
  assert.ok(hasOrbBridge, 'drop longo deve aproveitar o orb em uma frase planejada');
});
