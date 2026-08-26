import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYtDlpJsonLines, rankByDuration, buildSearchArgs, buildStreamArgs } from '../server/ytdlp.js';

test('parseYtDlpJsonLines faz parse de múltiplas linhas JSON', () => {
  const stdout = [
    JSON.stringify({ id: 'a1', title: 'Song A', uploader: 'Artist A', duration: 200, thumbnail: 'x' }),
    JSON.stringify({ id: 'a2', title: 'Song B', channel: 'Artist B', duration: 180 }),
    'linha inválida que não é JSON',
  ].join('\n');

  const results = parseYtDlpJsonLines(stdout);
  assert.equal(results.length, 2);
  assert.equal(results[0].id, 'a1');
  assert.equal(results[0].artist, 'Artist A');
  assert.equal(results[1].artist, 'Artist B');
});

test('rankByDuration ordena pela proximidade da duração alvo', () => {
  const results = [
    { id: '1', duration: 300 },
    { id: '2', duration: 198 },
    { id: '3', duration: 207 },
  ];
  const ranked = rankByDuration(results, 205);
  assert.deepEqual(ranked.map((r) => r.id), ['3', '2', '1']);
});

test('rankByDuration sem duração alvo mantém a ordem original', () => {
  const results = [{ id: '1', duration: 300 }, { id: '2', duration: 100 }];
  const ranked = rankByDuration(results, null);
  assert.deepEqual(ranked, results);
});

test('buildSearchArgs monta o comando ytsearchN corretamente', () => {
  const args = buildSearchArgs('minha musica', 5);
  assert.equal(args[0], 'ytsearch5:minha musica');
  assert.ok(args.includes('--dump-json'));
});

test('buildStreamArgs aceita ID puro e URL completa', () => {
  const argsFromId = buildStreamArgs('abc12345678');
  assert.equal(argsFromId[0], 'https://www.youtube.com/watch?v=abc12345678');

  const argsFromUrl = buildStreamArgs('https://youtu.be/abc12345678');
  assert.equal(argsFromUrl[0], 'https://youtu.be/abc12345678');
});
