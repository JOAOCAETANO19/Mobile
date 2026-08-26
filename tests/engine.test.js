import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, MODE, JUDGE } from '../src/game/engine.js';
import { generateLevel, physicsForBpm } from '../src/game/levelgen.js';

function levelWithDrop(bpm = 120, durationSec = 8) {
  const analysis = { bpm, durationSec, sections: [{ label: 'drop', start: 0, end: durationSec, color: '#111', glow: '#222' }] };
  return generateLevel(analysis, { title: 'Test', artist: 'X' });
}

test('tap no modo batida, exatamente na batida, gera PERFEITO', () => {
  const level = levelWithDrop();
  let judged = null;
  const engine = new GameEngine(level, { onJudge: (j, c) => { judged = { j, c }; } }, MODE.BEAT);
  const beat = engine.level.beats[2];
  engine.tap(beat.time);
  assert.equal(judged.j, 'PERFECT');
  assert.equal(engine.player.jumping, true);
  assert.equal(engine.player.jumpStart, beat.time);
});

test('tap fora da tolerância não pula nem julga', () => {
  const level = levelWithDrop();
  let judged = null;
  const engine = new GameEngine(level, { onJudge: (j) => { judged = j; } }, MODE.BEAT);
  const beat = engine.level.beats[2];
  const { T } = physicsForBpm(level.bpm);
  engine.tap(beat.time + T * 0.5); // bem fora da janela de ~0.3 batida
  assert.equal(judged, null);
  assert.equal(engine.player.jumping, false);
});

test('tap dentro da janela GOOD mas fora do PERFECT gera BOM', () => {
  const level = levelWithDrop();
  let judged = null;
  const engine = new GameEngine(level, { onJudge: (j) => { judged = j; } }, MODE.BEAT);
  const beat = engine.level.beats[2];
  const deltaSec = (JUDGE.PERFECT_MS + 30) / 1000;
  engine.tap(beat.time + deltaSec);
  assert.equal(judged, 'GOOD');
});

test('updatePlayer: jogador aterrissa e reseta jumping após a duração de 1 batida', () => {
  const level = levelWithDrop();
  const engine = new GameEngine(level, {}, MODE.BEAT);
  const beat = engine.level.beats[0];
  engine.tap(beat.time);
  const { T } = physicsForBpm(level.bpm);
  engine.updatePlayer(beat.time + T * 0.999, 0.016);
  assert.ok(engine.player.y >= 0);
  engine.updatePlayer(beat.time + T * 1.01, 0.016);
  assert.equal(engine.player.jumping, false);
});

test('colisão com espinho mata o jogador quando ele está no chão', () => {
  const level = levelWithDrop();
  let died = false;
  const engine = new GameEngine(level, { onDeath: () => { died = true; } }, MODE.BEAT);
  const ob = engine.level.obstacles[0];
  // Sem pular, o jogador está sempre no chão -> deve colidir quando o espinho estiver na posição do jogador.
  engine.checkCollisions(ob.time, 20);
  assert.equal(died, true);
  assert.equal(engine.player.dead, true);
});

test('combo incrementa a cada julgamento e reseta na morte', () => {
  const level = levelWithDrop();
  const engine = new GameEngine(level, {}, MODE.BEAT);
  const beat0 = engine.level.beats[0];
  engine.tap(beat0.time);
  assert.equal(engine.combo, 1);
  engine.die(1);
  assert.equal(engine.combo, 0);
});
