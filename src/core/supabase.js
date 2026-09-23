// Integração Supabase (banco em nuvem): autenticação por email/senha (Auth REST)
// e recordes na tabela `records` (PostgREST com RLS). SEM SDK: chamadas REST
// diretas, fetch injetável p/ testes. Se não estiver configurado, tudo vira no-op
// e o jogo segue 100% offline com as contas locais (core/accounts.js).

const CONFIG_KEY = 'rhythm-dash-sb-config-v1';
const SESSION_KEY = 'rhythm-dash-cloud-v1';
const MIN_CLOUD_PASS = 6; // mínimo padrão do Supabase Auth

// Storage padrão injetável para testes (produção = localStorage).
let activeStorage = null;
const defaultStorage = () => activeStorage || globalThis.localStorage;
export function setStorageForTests(storage) {
  activeStorage = storage;
}

// Projeto embutido: o jogo JÁ VEM CONECTADO a este banco.
// A chave publishable é pública por design (Supabase Auth); quem protege os
// dados é a RLS da tabela `records` (cada jogador só toca no que é dele).
export const DEFAULT_CONFIG = {
  url: 'https://dlofouyzbqsqbjhbheqh.supabase.co',
  key: 'sb_publishable_QKSd9PUaGVNXzxGe2AgRBA_Aos2uGIN',
};

export function loadConfig(storage = defaultStorage()) {
  try {
    const obj = JSON.parse(storage?.getItem(CONFIG_KEY) || 'null');
    if (obj && obj.url && obj.key) {
      return { url: String(obj.url).replace(/\/+$/, ''), key: String(obj.key) };
    }
  } catch { /* noop */ }
  return DEFAULT_CONFIG; // sem config manual → usa o projeto embutido
}

export function saveConfig(url, key, storage = defaultStorage()) {
  const clean = String(url || '').trim().replace(/\/+$/, '');
  const cleanKey = String(key || '').trim();
  if (!clean || !cleanKey) throw new Error('Preencha a URL e a chave anon.');
  if (!/^https:\/\/.+\.supabase\.co/.test(clean)) {
    throw new Error('A URL deve ser https://SEU-PROJETO.supabase.co');
  }
  try {
    storage?.setItem(CONFIG_KEY, JSON.stringify({ url: clean, key: cleanKey }));
  } catch { /* noop */ }
  return { url: clean, key: cleanKey };
}

export function clearConfig(storage = defaultStorage()) {
  try {
    storage?.removeItem(CONFIG_KEY);
  } catch { /* noop */ }
}

function loadSession(storage = defaultStorage()) {
  try {
    const obj = JSON.parse(storage?.getItem(SESSION_KEY) || 'null');
    if (obj && obj.accessToken && obj.user?.id) return obj;
  } catch { /* noop */ }
  return null;
}

function saveSession(session, storage = defaultStorage()) {
  try {
    storage?.setItem(SESSION_KEY, JSON.stringify(session));
  } catch { /* noop */ }
  return session;
}

export function clearSession(storage = defaultStorage()) {
  try {
    storage?.removeItem(SESSION_KEY);
  } catch { /* noop */ }
}

/** Usuário de nuvem logado agora (ou null). */
export function getCloudUser(storage = defaultStorage()) {
  const s = loadSession(storage);
  return s ? s.user : null;
}

/* ---------- HTTP interno ---------- */

function headers(cfg, session) {
  const h = { apikey: cfg.key, 'Content-Type': 'application/json' };
  h.Authorization = `Bearer ${session?.accessToken || cfg.key}`;
  return h;
}

async function sbFetch(cfg, path, opts = {}, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(`${cfg.url}${path}`, opts);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

/** Problemus traduzidos p/ português do jogador. */
function authErrorMessage(body, fallback) {
  const msg = body?.msg || body?.error_description || body?.error || '';
  if (/Invalid login/i.test(msg)) return 'Email ou senha incorretos.';
  if (/already registered|already been registered/i.test(msg)) return 'Já existe conta com esse email.';
  if (/password/i.test(msg) && /at least|should be/i.test(msg)) return `A senha precisa de ${MIN_CLOUD_PASS}+ caracteres na nuvem.`;
  return msg || fallback;
}

function sessionFrom(body) {
  const accessToken = body.access_token;
  const user = {
    id: body.user?.id,
    email: body.user?.email || body.email,
    name: body.user?.user_metadata?.name || body.user?.user_metadata?.avatar_name || body.email?.split('@')[0],
    avatar: body.user?.user_metadata?.avatar || '☁️',
  };
  return {
    accessToken,
    refreshToken: body.refresh_token || null,
    expiresAt: body.expires_at || Date.now() / 1000 + (body.expires_in || 3600),
    user,
  };
}

/* ---------- Autenticação (Auth REST) ---------- */

/**
 * Cria conta na nuvem. Retorna { session } ou { error }.
 * Se o projeto exigir confirmação de email, vem { needsEmailConfirm: true }.
 */
export async function cloudSignUp({ name, email, password, avatar } = {}, cfg = loadConfig(), fetchImpl = globalThis.fetch) {
  if (!cfg) return { error: 'Supabase não configurado.' };
  if (String(password || '').length < MIN_CLOUD_PASS) {
    return { error: `A senha precisa de pelo menos ${MIN_CLOUD_PASS} caracteres (exigência da nuvem).` };
  }
  const { status, body } = await sbFetch(cfg, '/auth/v1/signup', {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify({ email, password, data: { name, avatar } }),
  }, fetchImpl);
  if (status >= 400 || !body?.user) {
    return { error: authErrorMessage(body, 'Não deu para criar a conta na nuvem.') };
  }
  if (!body.access_token) return { needsEmailConfirm: true };
  return { session: saveSession(sessionFrom(body)) };
}

export async function cloudSignIn(email, password, cfg = loadConfig(), fetchImpl = globalThis.fetch) {
  if (!cfg) return { error: 'Supabase não configurado.' };
  const { status, body } = await sbFetch(cfg, '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify({ email, password }),
  }, fetchImpl);
  if (status >= 400 || !body?.access_token) {
    return { error: authErrorMessage(body, 'Não deu para entrar na nuvem.') };
  }
  return { session: saveSession(sessionFrom(body)) };
}

export async function cloudSignOut(cfg = loadConfig(), fetchImpl = globalThis.fetch) {
  const session = loadSession();
  if (cfg && session) {
    await sbFetch(cfg, '/auth/v1/logout', { method: 'POST', headers: headers(cfg, session) }, fetchImpl).catch(() => {});
  }
  clearSession();
}

/** Testa conexão + se a tabela `records` existe. Retorna { ok } ou { error }. */
export async function cloudTestConfig(cfg = loadConfig(), fetchImpl = globalThis.fetch) {
  if (!cfg) return { error: 'Preencha URL e chave anon.' };
  const { status, body } = await sbFetch(cfg, '/rest/v1/records?select=track_key&limit=1', {
    headers: headers(cfg),
  }, fetchImpl);
  if (status === 401 || status === 403) return { error: 'Chave rejeitada — confira a anon key.' };
  if (status === 404 || /relation .* does not exist/i.test(body?.message || '')) {
    return { error: 'Conectou, mas a tabela `records` não existe. Rode o SQL do README no SQL Editor do Supabase.' };
  }
  if (status >= 400) return { error: body?.message || `Erro ${status} ao testar.` };
  return { ok: true };
}

/* ---------- Recordes na nuvem (tabela `records`, RLS por usuário) ---------- */

/** Envia/atualiza o recorde do jogador naquela música (upsert por usuário+faixa). */
export async function cloudPushRecord(trackKey, entry, cfg = loadConfig(), fetchImpl = globalThis.fetch) {
  const session = loadSession();
  if (!cfg || !session || !trackKey) return { skipped: true };
  const { status, body } = await sbFetch(cfg, '/rest/v1/records', {
    method: 'POST',
    headers: { ...headers(cfg, session), Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      user_id: session.user.id,
      track_key: trackKey,
      best_score: entry.bestScore || 0,
      best_combo: entry.bestCombo || 0,
      best_progress_pct: entry.bestProgressPct || 0,
      plays: entry.plays || 0,
      finishes: entry.finishes || 0,
      updated_at: new Date().toISOString(),
    }),
  }, fetchImpl);
  if (status >= 400) return { error: body?.message || `Erro ${status} ao salvar na nuvem.` };
  return { ok: true };
}

/** Baixa TODOS os recordes do usuário (para fundir com os locais no login). */
export async function cloudFetchRecords(cfg = loadConfig(), fetchImpl = globalThis.fetch) {
  const session = loadSession();
  if (!cfg || !session) return [];
  const { status, body } = await sbFetch(cfg, '/rest/v1/records?select=*', {
    headers: headers(cfg, session),
  }, fetchImpl);
  if (status >= 400 || !Array.isArray(body)) return [];
  return body.map((row) => ({
    trackKey: row.track_key,
    bestScore: row.best_score || 0,
    bestCombo: row.best_combo || 0,
    bestProgressPct: row.best_progress_pct || 0,
    plays: row.plays || 0,
    finishes: row.finishes || 0,
  }));
}

export { MIN_CLOUD_PASS };
