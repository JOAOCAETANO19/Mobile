// Desafios diários + XP: rotação de data, contagem, recompensa única e nível.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_TASKS,
  todayKey,
  loadDaily,
  saveDaily,
  applyRunToDaily,
  tasksWithProgress,
  loadXp,
  addXp,
  levelForXp,
  xpIntoLevel,
} from '../src/game/daily.js';

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

test('tarefas do dia: contadores sobem com cada partida', () => {
  let s0 = { date: '2026-09-20', plays: 0, notes: 0, finishes: 0, claimed: [] };
  const g1 = applyRunToDaily({ notesHit: 320, finished: false }, s0);
  assert.equal(g1.state.plays, 1);
  assert.equal(g1.state.notes, 320);
  assert.equal(g1.xpGained, 0);
  const g2 = applyRunToDaily({ notesHit: 220, finished: true }, g1.state);
  assert.equal(g2.state.notes, 540, '500/500 notas atinge a meta');
  assert.ok(g2.completedIds.includes('notes'));
  assert.ok(g2.completedIds.includes('finish'));
  assert.equal(g2.xpGained, 350, 'bonificação das duas tarefas');
});

test('recompensa só sai uma vez por dia', () => {
  let s0 = { date: '2026-09-20', plays: 0, notes: 0, finishes: 0, claimed: [] };
  const a = applyRunToDaily({ notesHit: 600, finished: true }, s0);
  const b = applyRunToDaily({ notesHit: 600, finished: true }, a.state);
  assert.equal(b.xpGained, 0, 'segunda partida não re-compensa');
  assert.equal(b.state.claimed.sort().join(','), 'finish,notes');
});

test('tasksWithProgress formata barra e done', () => {
  const s = { date: 'x', plays: 2, notes: 340, finishes: 0, claimed: [] };
  const p = tasksWithProgress(s);
  assert.equal(p[0].label, 'Jogue 3 músicas');
  assert.equal(p[0].cur, 2);
  assert.equal(p[0].pct, 67, 'barra em %');
  assert.equal(p[0].done, false);
  assert.equal(p[1].done, false);
  assert.equal(p[2].done, false);
});

test('dia novo zera contadores e claimed, XP total sobrevive', () => {
  const st = memStorage();
  const diaVelho = { date: '2026-09-19', plays: 3, notes: 999, finishes: 2, claimed: ['plays'] };
  saveDaily(diaVelho, st, '@cleber');
  addXp(250, st, '@cleber');
  const novo = loadDaily(st, '@cleber', new Date('2026-09-20T10:00:00'));
  assert.equal(novo.plays, 0);
  assert.deepEqual(novo.claimed, []);
  assert.equal(novo.date, '2026-09-20');
  const mesmo = loadDaily(st, '@cleber', new Date('2026-09-19T23:00:00'));
  assert.equal(mesmo.plays, 3, 'mesmo dia preserva');
  assert.equal(loadXp(st, '@cleber'), 250, 'XP não zera');
});

test('escopo separa jogadores', () => {
  const st = memStorage();
  addXp(100, st, '@a');
  addXp(500, st, '@b');
  assert.equal(loadXp(st, '@a'), 100);
  assert.equal(loadXp(st, '@b'), 500);
  assert.equal(loadXp(st), 0, 'geral separado');
});

test('nível: a cada 100 XP sobe um', () => {
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(99), 1);
  assert.equal(levelForXp(100), 2);
  assert.equal(levelForXp(1150), 12); // "BeatMaster · Nível 12"
  assert.equal(xpIntoLevel(1150), 50);
});

test('todayKey formata YYYY-MM-DD com zeros', () => {
  assert.equal(todayKey(new Date('2026-03-04T12:00:00')), '2026-03-04');
  assert.ok(Array.isArray(DAILY_TASKS) && DAILY_TASKS.length === 3);
});
