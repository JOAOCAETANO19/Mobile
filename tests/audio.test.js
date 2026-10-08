import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SyncedPlayer } from '../src/core/audio.js';

class FakeBufferSource {
  buffer = null;
  onended = null;
  disconnected = false;
  connect() {}
  start() {}
  stop() {}
  disconnect() { this.disconnected = true; }
}

class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  sources = [];
  createGain() {
    return { gain: { value: 1 }, connect() {} };
  }
  createBufferSource() {
    const source = new FakeBufferSource();
    this.sources.push(source);
    return source;
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
}

test('SyncedPlayer avança o relógio até a duração quando o áudio termina naturalmente', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { AudioContext: FakeAudioContext };
  try {
    const player = new SyncedPlayer({ duration: 12 });
    player.play(2);
    const context = player.ctx;
    context.currentTime = 0.5;
    assert.equal(player.getCurrentTime(), 2.5);

    const endedSource = player.source;
    endedSource.onended();
    assert.equal(player.getCurrentTime(), 12);
    assert.equal(player.playing, false);
    assert.equal(player.source, null);
    assert.equal(endedSource.disconnected, true);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('SyncedPlayer preserva a posição ao parar e ignora o onended da fonte parada', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { AudioContext: FakeAudioContext };
  try {
    const player = new SyncedPlayer({ duration: 12 });
    player.play(1);
    player.ctx.currentTime += 2;
    const stoppedSource = player.source;
    player.stop();
    stoppedSource.onended();
    assert.equal(player.getCurrentTime(), 3);
    assert.equal(player.playing, false);
    assert.equal(player.source, null);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('SyncedPlayer ignora onended tardio de uma fonte substituída', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { AudioContext: FakeAudioContext };
  try {
    const player = new SyncedPlayer({ duration: 12 });
    player.play(1);
    const previousSource = player.source;
    player.play(4);
    const currentSource = player.source;

    previousSource.onended();
    assert.equal(player.source, currentSource);
    assert.equal(player.playing, true);
    assert.equal(player.getCurrentTime(), 4);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
