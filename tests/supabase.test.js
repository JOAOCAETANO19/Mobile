import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  describeSupabaseError,
  fetchPlayerRecords,
  getSession,
  resendSignupConfirmation,
  signIn,
  signOut,
  signUp,
  submitPlayerRecord,
} from '../src/core/supabase.js';

function installMemoryStorage() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const data = new Map();
  const memoryStorage = {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
    clear() { data.clear(); },
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage });
  return {
    storage: memoryStorage,
    restore() {
      if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
      else delete globalThis.localStorage;
    },
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return body == null ? '' : JSON.stringify(body); },
  };
}

test('signup posts to Auth with the public API key and does not invent a session', async () => {
  const restoreFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse({ id: 'user-1', email: 'player@example.com' });
  };
  try {
    const result = await signUp('player@example.com', 'long-password');
    assert.equal(result.confirmationRequired, true);
    assert.equal(result.user.id, 'user-1');
    assert.ok(calls[0].url.endsWith('/auth/v1/signup'));
    assert.equal(calls[0].init.headers.apikey, DEFAULT_CONFIG.key);
  } finally {
    globalThis.fetch = restoreFetch;
  }
});

test('signup only requests redirects from the configured Pages/local origins', async () => {
  const restoreFetch = globalThis.fetch;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(new URL(String(url)));
    return jsonResponse({ id: 'user-1', email: 'player@example.com' });
  };
  try {
    globalThis.window = { location: { origin: 'http://localhost:5173', pathname: '/' } };
    await signUp('player@example.com', 'long-password');
    assert.equal(urls[0].searchParams.get('redirect_to'), 'http://localhost:5173/');

    globalThis.window = { location: { origin: 'https://joaocaetano19.github.io', pathname: '/Mobile/' } };
    await signUp('player@example.com', 'long-password');
    assert.equal(urls[1].searchParams.get('redirect_to'), 'https://joaocaetano19.github.io/Mobile/');

    globalThis.window = { location: { origin: 'https://arena-preview.example', pathname: '/' } };
    await signUp('player@example.com', 'long-password');
    assert.equal(urls[2].searchParams.has('redirect_to'), false);
  } finally {
    globalThis.fetch = restoreFetch;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('resend sends a signup confirmation request with the public API key', async () => {
  const restoreFetch = globalThis.fetch;
  let call = null;
  globalThis.fetch = async (url, init) => {
    call = { url: String(url), init };
    return jsonResponse({ message_id: 'mail-1' });
  };
  try {
    await resendSignupConfirmation(' player@example.com ');
    assert.ok(call.url.endsWith('/auth/v1/resend'));
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.headers.apikey, DEFAULT_CONFIG.key);
    assert.deepEqual(JSON.parse(call.init.body), { type: 'signup', email: 'player@example.com' });
  } finally {
    globalThis.fetch = restoreFetch;
  }
});

test('login persists its session and REST record calls use the user access token', async () => {
  const restoreStorage = installMemoryStorage();
  const restoreFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const value = String(url);
    calls.push({ url: value, init });
    if (value.includes('/auth/v1/token?grant_type=password')) {
      return jsonResponse({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        user: { id: 'user-1', email: 'player@example.com' },
      });
    }
    if (value.includes('/rest/v1/rpc/submit_player_record')) {
      return jsonResponse({ track_id: 'demo:1', score: 20, best_combo: 4 });
    }
    if (value.includes('/rest/v1/player_records')) {
      return jsonResponse([{ track_id: 'demo:1', score: 20 }]);
    }
    return jsonResponse({ message: 'not found' }, 404);
  };

  try {
    const session = await signIn('player@example.com', 'long-password');
    assert.equal(session.user.id, 'user-1');
    assert.equal((await getSession()).access_token, 'access-token');
    const records = await fetchPlayerRecords();
    assert.equal(records[0].track_id, 'demo:1');
    const saved = await submitPlayerRecord({
      track_id: 'demo:1', track_title: 'Demo', track_artist: 'Rhythm Dash',
      score: 20, best_combo: 4, completed: false,
    });
    assert.equal(saved.score, 20);

    const restCalls = calls.filter((call) => call.url.includes('/rest/v1/'));
    assert.equal(restCalls.length, 2);
    for (const call of restCalls) {
      assert.equal(call.init.headers.apikey, DEFAULT_CONFIG.key);
      assert.equal(call.init.headers.Authorization, 'Bearer access-token');
    }
  } finally {
    globalThis.fetch = restoreFetch;
    restoreStorage.restore();
  }
});

test('expired sessions are refreshed before an authenticated request', async () => {
  const { storage, restore } = installMemoryStorage();
  const restoreFetch = globalThis.fetch;
  storage.setItem('rhythm-dash.supabase.session.v1', JSON.stringify({
    access_token: 'expired-access',
    refresh_token: 'refresh-token',
    expires_at_ms: Date.now() - 1_000,
    user: { id: 'user-1', email: 'player@example.com' },
  }));
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse({
      access_token: 'renewed-access',
      refresh_token: 'rotated-refresh-token',
      expires_in: 3600,
      user: { id: 'user-1', email: 'player@example.com' },
    });
  };
  try {
    const session = await getSession();
    assert.equal(session.access_token, 'renewed-access');
    assert.equal(session.refresh_token, 'rotated-refresh-token');
    assert.match(calls[0].url, /grant_type=refresh_token/);
  } finally {
    globalThis.fetch = restoreFetch;
    restore();
  }
});

test('sign out always removes the local session even when the Auth request fails', async () => {
  const restoreStorage = installMemoryStorage();
  const restoreFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600, user: { id: 'user-1' } });
  try {
    await signIn('player@example.com', 'long-password');
    globalThis.fetch = async () => { throw new TypeError('offline'); };
    const result = await signOut();
    assert.equal(result.remoteSignedOut, false);
    assert.equal(await getSession(), null);
  } finally {
    globalThis.fetch = restoreFetch;
    restoreStorage.restore();
  }
});

test('common Supabase authentication errors are translated to Portuguese', () => {
  assert.equal(describeSupabaseError(new Error('Invalid login credentials')), 'E-mail ou senha incorretos.');
  assert.match(describeSupabaseError({ code: 'email_not_confirmed', message: 'Email not confirmed' }), /Reenvie o link/);
  assert.match(describeSupabaseError({ code: 'signup_disabled', message: 'Signups not allowed' }), /desativado/);
  assert.match(describeSupabaseError(new Error('Error sending confirmation email')), /SMTP/);
  assert.match(describeSupabaseError(new Error('Could not find the table player_records')), /schema\.sql/);
});
