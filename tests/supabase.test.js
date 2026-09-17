// Integração Supabase (REST): config, auth e recordes — com fetch injetado (fake).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadConfig,
  setStorageForTests,
  saveConfig,
  clearConfig,
  clearSession,
  getCloudUser,
  cloudSignUp,
  cloudSignIn,
  cloudTestConfig,
  cloudPushRecord,
  cloudFetchRecords,
  MIN_CLOUD_PASS,
} from '../src/core/supabase.js';

const STORAGE = memStorage();
setStorageForTests(STORAGE);

const CFG = { url: 'https://projeto.supabase.co', key: 'sb_anon_teste' };

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

/** fetch falso: dá pra programar resposta JSON + checar chamadas feitas. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init, body: init?.body ? JSON.parse(init.body) : null });
    const route = routes.find((r) => String(url).includes(r.match));
    const res = route ? route.res : { status: 404, body: { message: 'no route' } };
    return { status: res.status, json: async () => res.body };
  };
  fn.calls = calls;
  return fn;
}

test('config: salva, normaliza barra, valida domínio', () => {
  const s = memStorage();
  clearConfig(s);
  assert.equal(loadConfig(s), null);
  assert.throws(() => saveConfig('http://errado.com', 'k', s), /supabase/);
  saveConfig('https://projeto.supabase.co/', ' abc ', s);
  const c = loadConfig(s);
  assert.equal(c.url, 'https://projeto.supabase.co');
  assert.equal(c.key, 'abc');
});

test('signup: rejeita senha fraca antes de chamar a rede', async () => {
  const s = memStorage();
  const fx = fakeFetch([]);
  const res = await cloudSignUp({ name: 'João', email: 'j@e.com', password: '123', avatar: '🦊' }, CFG, fx);
  assert.ok(res.error?.includes(String(MIN_CLOUD_PASS)));
  assert.equal(fx.calls.length, 0, 'não pode chamar a rede');
});

test('signup: guarda sessão e manda metadata (nome/avatar)', async () => {
  clearSession(STORAGE);
  const fx = fakeFetch([
    {
      match: '/auth/v1/signup',
      res: {
        status: 200,
        body: {
          access_token: 'AT', refresh_token: 'RT', expires_in: 3600,
          user: { id: 'u1', email: 'j@e.com', user_metadata: { name: 'João', avatar: '🦊' } },
        },
      },
    },
  ]);
  const res = await cloudSignUp({ name: 'João', email: 'j@e.com', password: 'segredo6', avatar: '🦊' }, CFG, fx);
  assert.ok(res.session);
  assert.equal(res.session.user.name, 'João');
  assert.equal(res.session.user.avatar, '🦊');
  assert.equal(fx.calls[0].body.data.avatar, '🦊');
  assert.equal(getCloudUser(STORAGE)?.id, 'u1', 'sessão persistida');
});

test('signup: sem session → pede confirmação de email', async () => {
  const fx = fakeFetch([
    { match: '/auth/v1/signup', res: { status: 200, body: { user: { id: 'u1', email: 'j@e.com' } } } },
  ]);
  const res = await cloudSignUp({ name: 'J', email: 'j@e.com', password: 'abc123' }, CFG, fx);
  assert.equal(res.needsEmailConfirm, true);
});

test('signup: traduz erro de email já registrado', async () => {
  const fx = fakeFetch([
    { match: '/auth/v1/signup', res: { status: 400, body: { msg: 'User already registered' } } },
  ]);
  const res = await cloudSignUp({ name: 'J', email: 'j@e.com', password: 'abc123' }, CFG, fx);
  assert.ok(/Já existe/i.test(res.error));
});

test('login: password grant guarda sessão; erro traduzido', async () => {
  const fxBad = fakeFetch([
    { match: 'grant_type=password', res: { status: 400, body: { error_description: 'Invalid login credentials' } } },
  ]);
  const bad = await cloudSignIn('j@e.com', 'x', CFG, fxBad);
  assert.ok(/incorretos/i.test(bad.error));

  const flight = fakeFetch([
    {
      match: 'grant_type=password',
      res: { status: 200, body: { access_token: 'AT', user: { id: 'u2', email: 'j@e.com' } } },
    },
  ]);
  const ok = await cloudSignIn('j@e.com', 'abc123', CFG, flight);
  assert.ok(ok.session);
  assert.equal(ok.session.user.email, 'j@e.com');
});

test('teste de conexão: ok / tabela ausente / chave errada', async () => {
  const okFx = fakeFetch([{ match: '/rest/v1/records', res: { status: 200, body: [] } }]);
  assert.equal((await cloudTestConfig(CFG, okFx)).ok, true);

  const tableFx = fakeFetch([
    { match: '/rest/v1/records', res: { status: 404, body: { message: 'relation "records" does not exist' } } },
  ]);
  assert.ok(/tabela/i.test((await cloudTestConfig(CFG, tableFx)).error));

  const keyFx = fakeFetch([{ match: '/rest/v1/records', res: { status: 401, body: {} } }]);
  assert.ok(/Chave/i.test((await cloudTestConfig(CFG, keyFx)).error));
});

test('recordes: push faz upsert RLS e fetch devolve formato local', async () => {
  const s = memStorage();
  clearSession(s);
  // entra pra ter sessão
  const authFx = fakeFetch([
    { match: 'grant_type=password', res: { status: 200, body: { access_token: 'AT', user: { id: 'u9', email: 'x@y.z' } } } },
  ]);
  await cloudSignIn('x@y.z', 'abc123', CFG, authFx);

  const fx = fakeFetch([
    { match: '/rest/v1/records?select=*', res: { status: 200, body: [
      { user_id: 'u9', track_key: 'a•b', best_score: 900, best_combo: 22, best_progress_pct: 80, plays: 3, finishes: 1 },
    ] } },
    { match: '/rest/v1/records', res: { status: 201, body: [] } },
  ]);
  const push = await cloudPushRecord('a•b', { bestScore: 900, bestCombo: 22, bestProgressPct: 80, plays: 3, finishes: 1 }, CFG, fx);
  assert.equal(push.ok, true);
  assert.equal(fx.calls[0].body.user_id, 'u9');
  assert.equal(fx.calls[0].init.headers.Prefer, 'resolution=merge-duplicates');

  const rows = await cloudFetchRecords(CFG, fx);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].trackKey, 'a•b');
  assert.equal(rows[0].bestScore, 900);
});

test('sem configurar: nada explode, tudo vira no-op', async () => {
  const s = memStorage();
  clearConfig(s);
  clearSession(s);
  assert.equal(getCloudUser(s), null);
  const res = await cloudFetchRecords(null, fakeFetch([]));
  assert.equal(res.length, 0);
  assert.equal((await cloudSignIn('a@a.aa', '123456', null, fakeFetch([]))).error, 'Supabase não configurado.');
});
