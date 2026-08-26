import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Countdown, COUNTDOWN_TOTAL_MS, COUNTDOWN_STEP_MS } from '../src/game/countdown.js';

test('contagem 3-2-1: um número por segundo, na ordem, onNumber a cada mudança e onDone ao final', () => {
  assert.equal(COUNTDOWN_TOTAL_MS, COUNTDOWN_STEP_MS * 3);

  const events = [];
  const cd = new Countdown({
    onNumber: (n) => events.push(`num:${n}`),
    onDone: () => events.push('done'),
  });

  cd.start(0); // agora = 0ms
  assert.equal(cd.update(0), 3); // 3 já visível na largada
  assert.equal(cd.update(999), 3);
  assert.equal(cd.update(1000), 2); // 2 ao completar 1s
  assert.equal(cd.update(1999), 2);
  assert.equal(cd.update(2000), 1); // 1 ao completar 2s
  assert.equal(cd.update(2999), 1);
  assert.equal(cd.update(COUNTDOWN_TOTAL_MS), null); // fim em 3s
  assert.equal(cd.update(COUNTDOWN_TOTAL_MS + 500), null); // segue "done", sem onDone duplicado
  assert.equal(cd.done, true);

  assert.deepEqual(events, ['num:3', 'num:2', 'num:1', 'done']);
});
