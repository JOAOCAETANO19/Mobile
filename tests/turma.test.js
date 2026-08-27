import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sortTurmaResults,
  medalFor,
  emptyTurma,
  normalizePlayerName,
  restartRound,
} from '../src/game/turma.js';

test('pódio da turma ordena por progresso, com desempate por score e combo', () => {
  const rows = [
    { name: 'Bia', score: 900, bestCombo: 9, progressPct: 80 },
    { name: 'Zé', score: 500, bestCombo: 5, progressPct: 100 }, // terminou -> 1º
    { name: 'Ana', score: 950, bestCombo: 12, progressPct: 80 }, // empate no %, ganha no score
    { name: 'Cid', score: 950, bestCombo: 15, progressPct: 80 }, // empate no % e score, ganha no combo
  ];
  const sorted = sortTurmaResults(rows);
  assert.deepEqual(sorted.map((r) => r.name), ['Zé', 'Cid', 'Ana', 'Bia']);
  // não muta o array original
  assert.equal(rows[0].name, 'Bia');
});

test('medalha do pódio: 🥇🥈🥉 e ordinal a partir do 4º', () => {
  assert.equal(medalFor(0), '🥇');
  assert.equal(medalFor(1), '🥈');
  assert.equal(medalFor(2), '🥉');
  assert.equal(medalFor(3), '4º');
  assert.equal(medalFor(9), '10º');
});

test('estado inicial da turma vem desativado e vazio', () => {
  const t = emptyTurma();
  assert.equal(t.active, false);
  assert.deepEqual(t.players, []);
  assert.equal(t.current, 0);
  assert.deepEqual(t.results, []);
});

test('nome de jogador é aparado e limitado a 16 caracteres', () => {
  assert.equal(normalizePlayerName('  João  '), 'João');
  assert.equal(normalizePlayerName('UmNomeMuitoMuitoLongoMesmo'), 'UmNomeMuitoMuito');
  assert.equal(normalizePlayerName('   '), '');
  assert.equal(normalizePlayerName(null), '');
});

test('revanche zera a rodada mas mantém os jogadores', () => {
  const t = {
    active: true,
    players: ['Ana', 'Bia'],
    current: 2,
    results: [{ name: 'Ana', score: 1, bestCombo: 1, progressPct: 10 }],
  };
  const r = restartRound(t);
  assert.equal(r.current, 0);
  assert.deepEqual(r.results, []);
  assert.deepEqual(r.players, ['Ana', 'Bia']);
  assert.equal(r.active, true);
});
