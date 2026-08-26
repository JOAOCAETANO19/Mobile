import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, MODE, JUDGE, SCORE, multiplierForCombo } from '../src/game/engine.js';
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

test('marco de combo: multiplicador em degraus (1x→2x→3x→4x), onComboMilestone ao cruzar a tier, pontos com o multiplicador', () => {
  // Degráus do multiplicador de pontuação por combo.
  assert.equal(multiplierForCombo(0), 1);
  assert.equal(multiplierForCombo(9), 1);
  assert.equal(multiplierForCombo(10), 2);
  assert.equal(multiplierForCombo(24), 2);
  assert.equal(multiplierForCombo(25), 3);
  assert.equal(multiplierForCombo(49), 3);
  assert.equal(multiplierForCombo(50), 4);
  assert.equal(multiplierForCombo(200), 4);

  const level = levelWithDrop(); // 120 BPM -> T = 0.5s
  const milestones = [];
  const engine = new GameEngine(level, { onComboMilestone: (m) => milestones.push(m) }, MODE.BEAT);

  // 9 toques BOM (90ms de atraso: dentro do BOM, fora do PERFEITO) -> combo 9, pontos 9*50*1
  for (let i = 0; i < 9; i++) {
    const beatTime = (i + 3) * 0.5;
    engine.updatePlayer(beatTime, 0.016); // garante que o pulo anterior aterrissou
    engine.tap(beatTime + 0.09);
  }
  assert.equal(engine.combo, 9);
  assert.equal(engine.score, 450);
  assert.equal(milestones.length, 0);

  // 10º toque PERFEITO (na batida) -> combo 10, marco ×2, pontos 100*2 = 200
  engine.updatePlayer(6.0, 0.016);
  engine.tap(6.0);
  assert.equal(engine.combo, 10);
  assert.deepEqual(milestones, [{ combo: 10, mult: 2 }]);
  assert.equal(engine.score, 650);
});

test('near-miss soma combo e pontos via registerHit (sem matar, sem contagem dupla)', () => {
  const level = levelWithDrop();
  level.collectibles.length = 0; // isola o near-miss da coleta
  const engine = new GameEngine(level, { onNearMiss: () => { engine.nearMissCount = (engine.nearMissCount || 0) + 1; } }, MODE.BEAT);
  const ob = level.obstacles[0]; // espinho (abertura previsível), em beat 0 + T/2
  const speed = 6; // células/segundo a 120 BPM (3 células/batida * 2 batidas/s)

  // O cubo "raspou" no espinho: por cima dele (dx < 0.35) com folga mínima
  // (0.55 > 0.5, altura necessária para não morrer) -> near-miss.
  engine.player.y = 0.55;
  const tNear = ob.time - 0.2 / speed;
  engine.checkCollisions(tNear, 20);

  assert.equal(engine.player.dead, false);
  assert.equal(engine.combo, 1);
  assert.equal(engine.bestCombo, 1);
  assert.equal(engine.score, SCORE.NEAR_MISS); // 25 * 1x
  assert.equal(engine.nearMissCount, 1);

  // Passar novamente pela mesma região do espinho não conta de novo.
  engine.player.y = 0.55;
  engine.checkCollisions(ob.time - 0.25 / speed, 20);
  assert.equal(engine.combo, 1);
  assert.equal(engine.score, SCORE.NEAR_MISS);
});

test('escudo: absorve uma colisão fatal e desaparece (a segunda colisão mata)', () => {
  const level = levelWithDrop();
  level.collectibles.length = 0;
  const events = { pickup: 0, brk: 0, death: 0 };
  const engine = new GameEngine(
    level,
    {
      onShieldPickup: () => events.pickup++,
      onShieldBreak: () => events.brk++,
      onDeath: () => events.death++,
    },
    MODE.BEAT
  );

  // Planta um escudo no chão antes do primeiro espinho (que está em 0.25s).
  level.obstacles.push({ id: 'ob_shield_test', type: 'shield', time: 0.1, beatIndex: 0, section: 'drop', color: '#4dff88', glow: '#4dff88' });

  // 1) Coleta o escudo passando por cima dele.
  engine.checkCollisions(0.1, 20);
  assert.equal(engine.shieldActive, true);
  assert.equal(events.pickup, 1);
  assert.equal(engine.score, 0); // escudo não dá pontos

  // 2) A colisão fatal com o primeiro espinho (cubo no chão) é ABSORVIDA.
  engine.checkCollisions(level.obstacles[0].time, 20);
  assert.equal(engine.player.dead, false);
  assert.equal(engine.shieldActive, false); // o escudo some
  assert.equal(events.brk, 1);
  assert.equal(events.death, 0);

  // 3) Sem escudo, o próximo espinho mata de verdade.
  engine.checkCollisions(level.obstacles[1].time, 20);
  assert.equal(engine.player.dead, true);
  assert.equal(events.death, 1);
});
