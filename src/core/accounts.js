// Contas locais do aparelho (localStorage): usuário + avatar + senha opcional
// hasheada com sal (SHA-256 via WebCrypto; fallback FNV-1a em contexto sem TLS).
// Cada conta tem recordes separados (veja game/stats.js → setStatsScope). Lógica
// pura e testável; o storage é injetável, como em game/stats.js.

const STORAGE_KEY = 'rhythm-dash-accounts-v1';

export const AVATARS = ['🎧', '👾', '🚀', '🦊', '🐼', '🐙', '🦄', '🦖', '🐸', '⭐', '🔥', '⚡', '🌙', '💫', '🍕', '🕹️'];
export const NAME_MIN = 2;
export const NAME_MAX = 16;
export const PASS_MIN = 4;

/** Normalização: nada de espaço extra no começo/fim nem dobrado no meio. */
export const normalizeName = (name) => String(name || '').trim().replace(/\s+/g, ' ');
export const nameMatches = (a, b) =>
  normalizeName(a).toLocaleLowerCase('pt-BR') === normalizeName(b).toLocaleLowerCase('pt-BR');

function loadRaw(storage = globalThis.localStorage) {
  try {
    const obj = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
    if (obj && Array.isArray(obj.accounts)) {
      return { accounts: obj.accounts, activeId: obj.activeId ?? null };
    }
  } catch {
    /* storage indisponível */
  }
  return { accounts: [], activeId: null };
}

function saveRaw(raw, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(raw));
  } catch {
    /* noop */
  }
  return raw;
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function randomToken(len = 10) {
  let s = '';
  while (s.length < len) s += Math.random().toString(36).slice(2);
  return s.slice(0, len);
}

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** hash(sal + senha) — a senha nunca é guardada em texto puro. */
export async function hashPassword(password, salt) {
  const input = `${salt}::${password}`;
  if (globalThis.crypto?.subtle?.digest) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return `s2:${toHex(buf)}`;
  }
  return `f1:${fnv1a(input)}${fnv1a(String(password) + '::' + salt)}`;
}

/** Avatar determinístico a partir do nome (quando o jogador não escolhe um). */
export function avatarForName(name) {
  let h = 0;
  for (const ch of normalizeName(name)) h = (h * 31 + (ch.codePointAt(0) || 0)) >>> 0;
  return AVATARS[h % AVATARS.length];
}

export function listAccounts(storage) {
  return loadRaw(storage).accounts.map((a) => ({ ...a }));
}

export function getActiveAccount(storage) {
  const raw = loadRaw(storage);
  const acc = raw.accounts.find((a) => a.id === raw.activeId);
  return acc ? { ...acc } : null;
}

/** Cria a conta e já a deixa ativa. Lança Error com mensagem amigável se inválida. */
export async function createAccount({ name, password = '', avatar = '' } = {}, storage) {
  const clean = normalizeName(name);
  if (clean.length < NAME_MIN || clean.length > NAME_MAX) {
    throw new Error(`O usuário precisa ter entre ${NAME_MIN} e ${NAME_MAX} caracteres.`);
  }
  const raw = loadRaw(storage);
  if (raw.accounts.some((a) => nameMatches(a.name, clean))) {
    throw new Error(`Já existe uma conta chamada “${clean}”.`);
  }
  if (password && String(password).length < PASS_MIN) {
    throw new Error(`A senha precisa ter pelo menos ${PASS_MIN} caracteres.`);
  }
  const salt = randomToken(10);
  const account = {
    id: uuid(),
    name: clean,
    avatar: AVATARS.includes(avatar) ? avatar : avatarForName(clean),
    salt,
    passHash: password ? await hashPassword(String(password), salt) : null,
    createdAt: Date.now(),
  };
  raw.accounts.push(account);
  raw.activeId = account.id; // criou, já entra nela
  saveRaw(raw, storage);
  return { ...account };
}

/** Confere a senha de uma conta (conta sem senha: qualquer toque entra). */
export async function verifyAccountPassword(account, password = '') {
  if (!account || !account.id) return false;
  if (!account.passHash) return true;
  return (await hashPassword(String(password), account.salt)) === account.passHash;
}

/** Marca a conta como ativa. Retorna a conta (null se não existe). */
export function switchAccount(id, storage) {
  const raw = loadRaw(storage);
  const acc = raw.accounts.find((a) => a.id === id);
  if (!acc) return null;
  raw.activeId = id;
  saveRaw(raw, storage);
  return { ...acc };
}

/** Remove a conta; se ela era a ativa, ativa a próxima (ou fica sem nenhuma). */
export function deleteAccount(id, storage) {
  const raw = loadRaw(storage);
  raw.accounts = raw.accounts.filter((a) => a.id !== id);
  if (raw.activeId === id) raw.activeId = raw.accounts[0]?.id ?? null;
  saveRaw(raw, storage);
  return raw.accounts.length;
}
