// Cliente mínimo do Supabase Auth + PostgREST, sem SDK.
// A chave publishable é pública por definição; nunca coloque a service_role no frontend.

export const DEFAULT_CONFIG = Object.freeze({
  url: 'https://dlofouyzbqsqbjhbheqh.supabase.co',
  key: 'sb_publishable_QKSd9PUaGVNXzxGe2AgRBA_Aos2uGIN',
});

const SESSION_STORAGE_KEY = 'rhythm-dash.supabase.session.v1';
const REQUEST_TIMEOUT_MS = 20_000;
const authListeners = new Set();
let refreshPromise = null;
let memorySession = null;
let sessionEpoch = 0;

export class SupabaseError extends Error {
  constructor(message, { status = 0, code = '', details = null } = {}) {
    super(message);
    this.name = 'SupabaseError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function notifyAuthListeners(session) {
  for (const listener of authListeners) {
    try {
      listener(session);
    } catch (error) {
      console.error('Listener de autenticação falhou:', error);
    }
  }
}

function readStoredSession() {
  const store = storage();
  if (!store) return memorySession;
  try {
    const serialized = store.getItem(SESSION_STORAGE_KEY);
    if (!serialized) return memorySession;
    const session = JSON.parse(serialized);
    memorySession = session?.access_token ? session : null;
    return memorySession;
  } catch {
    try { store.removeItem(SESSION_STORAGE_KEY); } catch { return memorySession; }
    memorySession = null;
    return null;
  }
}

function saveStoredSession(session) {
  sessionEpoch++;
  memorySession = session;
  const store = storage();
  if (store) {
    try {
      store.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch {
      // A sessão continua utilizável nesta aba mesmo se o navegador bloquear storage.
    }
  }
  notifyAuthListeners(session);
}

function clearStoredSession() {
  sessionEpoch++;
  memorySession = null;
  const store = storage();
  try { store?.removeItem(SESSION_STORAGE_KEY); } catch { /* storage indisponível */ }
  notifyAuthListeners(null);
}

function makeSession(payload, previous = null) {
  const data = payload?.session || payload || {};
  if (!data.access_token) return null;

  let expiresAtMs;
  if (Number.isFinite(Number(data.expires_at_ms))) {
    expiresAtMs = Number(data.expires_at_ms);
  } else if (Number.isFinite(Number(data.expires_at))) {
    const expiresAt = Number(data.expires_at);
    expiresAtMs = expiresAt > 1_000_000_000_000 ? expiresAt : expiresAt * 1000;
  } else {
    expiresAtMs = Date.now() + Math.max(0, Number(data.expires_in) || 3600) * 1000;
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || previous?.refresh_token || '',
    token_type: data.token_type || previous?.token_type || 'bearer',
    expires_at_ms: expiresAtMs,
    user: data.user || previous?.user || null,
  };
}

function authRedirectUrl() {
  if (typeof window === 'undefined' || !window.location) return '';
  const location = window.location;
  const url = new URL(`${location.origin}${location.pathname}`);
  const isLocalDevelopment = ['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '5173';
  const isPublishedApp = url.origin === 'https://joaocaetano19.github.io'
    && /^\/Mobile(?:\/|$)/.test(url.pathname);
  // Preview hosts temporários não estão na allowlist do Auth. Sem redirect_to,
  // o GoTrue usa o Site URL configurado no projeto em vez de rejeitar o cadastro.
  return isLocalDevelopment || isPublishedApp ? url.href : '';
}

function makeUrl(path) {
  const base = DEFAULT_CONFIG.url.replace(/\/+$/, '');
  return new URL(`${base}/${String(path).replace(/^\/+/, '')}`);
}

function messageFromPayload(payload, status) {
  const message = payload?.msg || payload?.message || payload?.error_description
    || payload?.error || payload?.hint || `Supabase respondeu com HTTP ${status}.`;
  return String(message);
}

async function request(path, { method = 'GET', body, accessToken, headers = {} } = {}) {
  const url = makeUrl(path);
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        apikey: DEFAULT_CONFIG.key,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(controller ? { signal: controller.signal } : {}),
    });

    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = { message: text }; }
    }

    if (!response.ok) {
      throw new SupabaseError(messageFromPayload(payload, response.status), {
        status: response.status,
        code: payload?.code || payload?.error_code || '',
        details: payload,
      });
    }
    return payload;
  } catch (error) {
    if (error instanceof SupabaseError) throw error;
    if (error?.name === 'AbortError') {
      throw new SupabaseError('A conexão com o Supabase demorou demais. Tente novamente.', { code: 'timeout' });
    }
    if (error instanceof TypeError) {
      throw new SupabaseError('Não foi possível conectar ao Supabase. Verifique a internet e a URL do projeto.', { code: 'network_error' });
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function refreshSession(current) {
  if (!current?.refresh_token) {
    clearStoredSession();
    return null;
  }
  const stored = readStoredSession();
  if (!stored) return null;
  if (stored.refresh_token !== current.refresh_token) return stored;
  if (refreshPromise) return refreshPromise;
  const epochAtStart = sessionEpoch;

  refreshPromise = request('auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: { refresh_token: current.refresh_token },
  })
    .then((payload) => {
      if (epochAtStart !== sessionEpoch) return readStoredSession();
      const session = makeSession(payload, current);
      if (!session) throw new SupabaseError('O Supabase não retornou uma sessão válida.', { code: 'invalid_session' });
      saveStoredSession(session);
      return session;
    })
    .catch((error) => {
      if ((error.status === 400 || error.status === 401) && epochAtStart === sessionEpoch) clearStoredSession();
      throw error;
    })
    .finally(() => { refreshPromise = null; });

  return refreshPromise;
}

/** Retorna a sessão local e renova o access token antes de ele expirar. */
export async function getSession() {
  const session = readStoredSession();
  if (!session) return null;
  const expiresAt = Number(session.expires_at_ms) || 0;
  if (!session.refresh_token || expiresAt > Date.now() + 60_000) return session;
  return refreshSession(session);
}

async function requireSession() {
  const session = await getSession();
  if (!session?.access_token) {
    throw new SupabaseError('Entre na sua conta para sincronizar os recordes.', { status: 401, code: 'not_authenticated' });
  }
  return session;
}

async function authenticatedRequest(path, options = {}) {
  let session = await requireSession();
  try {
    return await request(path, { ...options, accessToken: session.access_token });
  } catch (error) {
    if (error.status !== 401 || !session.refresh_token) throw error;
    session = await refreshSession(session);
    if (!session?.access_token) throw error;
    return request(path, { ...options, accessToken: session.access_token });
  }
}

/** Cria uma conta. Com confirmação de e-mail habilitada, a sessão virá após o clique no link. */
export async function signUp(email, password) {
  const redirect = authRedirectUrl();
  const path = `auth/v1/signup${redirect ? `?redirect_to=${encodeURIComponent(redirect)}` : ''}`;
  const payload = await request(path, {
    method: 'POST',
    body: { email: String(email).trim(), password },
  });
  const session = makeSession(payload);
  const user = payload?.user || session?.user || (payload?.id ? payload : null);
  const resolvedSession = session ? { ...session, user: user || null } : null;
  if (resolvedSession) saveStoredSession(resolvedSession);
  return { user, session: resolvedSession, confirmationRequired: !resolvedSession };
}

/** Reenvia o link de confirmação de cadastro para um endereço ainda não confirmado. */
export async function resendSignupConfirmation(email) {
  const redirect = authRedirectUrl();
  const path = `auth/v1/resend${redirect ? `?redirect_to=${encodeURIComponent(redirect)}` : ''}`;
  return request(path, {
    method: 'POST',
    body: { type: 'signup', email: String(email).trim() },
  });
}

/** Entra com e-mail e senha e guarda a sessão persistente neste aparelho. */
export async function signIn(email, password) {
  const payload = await request('auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: String(email).trim(), password },
  });
  const session = makeSession(payload);
  if (!session) throw new SupabaseError('O Supabase não retornou uma sessão válida.', { code: 'invalid_session' });
  if (!session.user && payload?.id) session.user = payload;
  saveStoredSession(session);
  return session;
}

/** Finaliza a sessão também no servidor; mesmo sem rede, remove o token deste aparelho. */
export async function signOut() {
  const session = readStoredSession();
  clearStoredSession();
  if (!session?.access_token) return { remoteSignedOut: false };
  try {
    await request('auth/v1/logout', { method: 'POST', accessToken: session.access_token });
    return { remoteSignedOut: true };
  } catch {
    return { remoteSignedOut: false };
  }
}

/** Consome a sessão que o Supabase devolve no fragmento após confirmação de e-mail. */
export async function initializeAuth() {
  let callback = null;
  if (typeof window !== 'undefined' && window.location?.hash) {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const hasAuthCallback = params.has('access_token') || params.has('error') || params.has('error_description');
    if (hasAuthCallback) {
      callback = {
        accessToken: params.get('access_token'),
        refreshToken: params.get('refresh_token'),
        expiresIn: params.get('expires_in'),
        error: params.get('error_description') || params.get('error'),
        type: params.get('type'),
      };
      window.history?.replaceState?.(window.history.state, '', `${window.location.pathname}${window.location.search}`);
    }
  }

  if (callback?.error) {
    return { session: readStoredSession(), notice: '', error: new SupabaseError(callback.error, { code: 'auth_callback_error' }) };
  }

  if (callback?.accessToken && callback?.refreshToken) {
    let session = makeSession({
      access_token: callback.accessToken,
      refresh_token: callback.refreshToken,
      expires_in: Number(callback.expiresIn) || 3600,
    });
    try {
      const user = await request('auth/v1/user', { accessToken: session.access_token });
      session = { ...session, user };
      saveStoredSession(session);
      return {
        session,
        notice: callback.type === 'signup' ? 'E-mail confirmado. Sua conta está conectada.' : 'Conta conectada.',
        error: null,
      };
    } catch (error) {
      return { session: null, notice: '', error };
    }
  }

  try {
    return { session: await getSession(), notice: '', error: null };
  } catch (error) {
    // Não derruba a inicialização offline: mantém a identidade local, mas a próxima
    // chamada autenticada vai renovar ou avisar que é necessária uma conexão.
    return { session: readStoredSession(), notice: '', error };
  }
}

/** Escuta login/logout feitos por outra aba do mesmo navegador. */
export function onAuthStateChange(listener) {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== SESSION_STORAGE_KEY) return;
    let session = null;
    try { session = event.newValue ? JSON.parse(event.newValue) : null; } catch { /* sessão inválida */ }
    sessionEpoch++;
    memorySession = session?.access_token ? session : null;
    notifyAuthListeners(memorySession);
  });
}

/** Busca somente os recordes do usuário conectado; RLS limita a resposta à própria conta. */
export async function fetchPlayerRecords() {
  const query = new URLSearchParams({
    select: 'track_id,track_title,track_artist,score,best_combo,completed,updated_at',
    order: 'score.desc,updated_at.desc',
    limit: '100',
  });
  return authenticatedRequest(`rest/v1/player_records?${query.toString()}`);
}

/** Grava o maior recorde de uma faixa via RPC atômica, sem permitir downgrade por corrida. */
export async function submitPlayerRecord(record) {
  return authenticatedRequest('rest/v1/rpc/submit_player_record', {
    method: 'POST',
    body: {
      p_track_id: record.track_id,
      p_track_title: record.track_title || '',
      p_track_artist: record.track_artist || '',
      p_score: record.score,
      p_best_combo: record.best_combo,
      p_completed: Boolean(record.completed),
    },
  });
}

/** Mensagens claras para os erros mais comuns do GoTrue e do PostgREST. */
export function describeSupabaseError(error) {
  const message = String(error?.message || error || 'Erro desconhecido.');
  const lower = message.toLowerCase();
  const code = String(error?.code || error?.details?.code || '').toLowerCase();
  if (/invalid login credentials|invalid email or password/.test(lower)) return 'E-mail ou senha incorretos.';
  if (code === 'email_not_confirmed' || /email not confirmed|email_not_confirmed/.test(lower)) return 'Este e-mail ainda não foi confirmado. Reenvie o link para ativar a conta.';
  if (/user already registered|already been registered|email_exists|user_already_exists/.test(`${lower} ${code}`)) return 'Este e-mail já possui uma conta. Entre ou use a opção de reenviar a confirmação.';
  if (/signup_disabled|signups? (are )?(not allowed|disabled)|signup is disabled/.test(`${lower} ${code}`)) return 'O cadastro está desativado neste momento. O administrador precisa habilitar o provedor de e-mail no Supabase.';
  if (/weak_password|password should be at least|password is too short|password.*too weak/.test(`${lower} ${code}`)) return 'A senha não atende aos requisitos do projeto. Use uma senha mais longa e tente novamente.';
  if (/email_address_invalid|invalid email|email address.*invalid/.test(`${lower} ${code}`)) return 'Esse endereço de e-mail parece inválido. Confira e tente novamente.';
  if (/email rate limit|over_email_send_rate_limit|too many requests|rate limit/.test(`${lower} ${code}`)) return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos antes de pedir outro e-mail.';
  if (/error sending confirmation email|failed to send.*email|smtp/.test(lower)) return 'O Supabase não conseguiu enviar o e-mail de confirmação. Verifique o SMTP do projeto ou tente novamente mais tarde.';
  if (/failed to fetch|network_error|conectar ao supabase/.test(lower)) return 'Sem conexão com o Supabase. Verifique sua internet e tente novamente.';
  if (/player_records|submit_player_record|schema cache|function .* not found|relation .* does not exist/.test(lower)) {
    return 'A tabela ou função de recordes ainda não está configurada. Execute supabase/schema.sql no SQL Editor do Supabase.';
  }
  return message;
}
