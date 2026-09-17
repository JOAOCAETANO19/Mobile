// Contas locais: criação, validação, senha hasheada, troca e remoção.
// O storage é injetado (sem localStorage no Node).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AVATARS,
  NAME_MIN,
  PASS_MIN,
  normalizeName,
  normalizeEmail,
  isValidEmail,
  avatarForName,
  listAccounts,
  getActiveAccount,
  createAccount,
  verifyAccountPassword,
  switchAccount,
  deleteAccount,
  findAccountByIdentifier,
  clearActiveAccount,
} from '../src/core/accounts.js';

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

test('cria conta válida e já a deixa ativa', async () => {
  const s = memStorage();
  const acc = await createAccount({ name: '  Cleber  ', avatar: '🦊' }, s);
  assert.equal(acc.name, 'Cleber'); // espaços ao redor são removidos
  assert.equal(acc.avatar, '🦊');
  assert.equal(acc.passHash, null); // sem senha por padrão
  assert.ok(acc.id);
  assert.equal(getActiveAccount(s)?.id, acc.id);
  assert.equal(listAccounts(s).length, 1);
});

test('rejeita nomes inválidos com mensagem amigável', async () => {
  const s = memStorage();
  await assert.rejects(() => createAccount({ name: ' ' }, s), /entre/);
  await assert.rejects(() => createAccount({ name: 'X' }, s), new RegExp(`${NAME_MIN}`));
  await assert.rejects(() => createAccount({ name: 'abcdefghijklmnopqrstuvwxyz' }, s), /caracteres/);
});

test('não deixa duplicar usuário (ignora maiúsculas/espaços)', async () => {
  const s = memStorage();
  await createAccount({ name: 'Ramon' }, s);
  await assert.rejects(() => createAccount({ name: 'RAMON ' }, s), /Já existe/);
  await assert.rejects(() => createAccount({ name: 'ramon' }, s), /Já existe/);
});

test('senha: guarda hash com sal, nunca o texto; verificação confere', async () => {
  const s = memStorage();
  const acc = await createAccount({ name: 'Ramon', password: 'beat123' }, s);
  assert.ok(acc.passHash);
  assert.ok(!acc.passHash.includes('beat123'), 'senha não pode aparecer no hash');
  assert.equal(await verifyAccountPassword(acc, 'beat123'), true);
  assert.equal(await verifyAccountPassword(acc, 'errada'), false);
  assert.equal(await verifyAccountPassword(acc, ''), false);
});

test('conta sem senha aceita entrar direto; null não entra', async () => {
  const s = memStorage();
  const acc = await createAccount({ name: 'Fácil' }, s);
  assert.equal(await verifyAccountPassword(acc, 'qualquer coisa'), true);
  assert.equal(await verifyAccountPassword(null, 'x'), false);
});

test('senha curta demais é rejeitada', async () => {
  const s = memStorage();
  await assert.rejects(() => createAccount({ name: 'Xana', password: '12' }, s), new RegExp(`${PASS_MIN}`));
});

test('avatar automático é determinístico e válido', () => {
  assert.equal(avatarForName('Luna'), avatarForName('luna'));
  assert.ok(AVATARS.includes(avatarForName('Zé do Prego')));
  assert.ok(AVATARS.includes(avatarForName('')));
});

test('troca de conta ativa funciona e remoção reatribui', async () => {
  const s = memStorage();
  const a = await createAccount({ name: 'Ana' }, s);
  const b = await createAccount({ name: 'Beto' }, s); // criar também passa a ser ativa
  assert.equal(getActiveAccount(s)?.id, b.id);
  assert.equal(switchAccount(a.id, s)?.id, a.id);
  assert.equal(getActiveAccount(s)?.id, a.id);
  assert.equal(deleteAccount(a.id, s), 1, 'sobrou 1 conta');
  assert.equal(getActiveAccount(s)?.id, b.id, 'a conta restante virou a ativa');
  assert.equal(deleteAccount(b.id, s), 0);
  assert.equal(getActiveAccount(s), null, 'sem contas → nenhuma ativa');
});

test('normalizeName colapsa espaços dobrados', () => {
  assert.equal(normalizeName('  João   Vitor  '), 'João Vitor');
  assert.equal(normalizeName(null), '');
});

test('email: valida formato, normaliza e impede duplicar', async () => {
  const s = memStorage();
  assert.equal(isValidEmail('cleber@escola.com'), true);
  assert.equal(isValidEmail('naosouemail'), false);
  assert.equal(isValidEmail('faltam@dominio'), false);
  await assert.rejects(() => createAccount({ name: 'Email Ruim', email: 'zoado' }, s), /email/i);
  const acc = await createAccount({ name: 'Cleber', email: '  Cleber@EESCOLA.com ' }, s);
  assert.equal(acc.email, 'cleber@eescola.com', 'normaliza trecho e caixa');
  await assert.rejects(() => createAccount({ name: 'Outro', email: 'cleber@eescola.com' }, s), /email/i);
  await createAccount({ name: 'Sem Email' }, s); // email segue opcional
});

test('login flexível: encontra por usuário ou por email', async () => {
  const s = memStorage();
  const acc = await createAccount({ name: 'Ramon', email: 'ramon@escola.com', password: 'top123' }, s);
  assert.equal(findAccountByIdentifier('ramon', s)?.id, acc.id);
  assert.equal(findAccountByIdentifier('RAMON', s)?.id, acc.id); // caixa não importa
  assert.equal(findAccountByIdentifier('ramon@escola.com', s)?.id, acc.id);
  assert.equal(findAccountByIdentifier(' RAMON@escola.com ', s)?.id, acc.id);
  assert.equal(findAccountByIdentifier('ninguem', s), null);
  assert.equal(await verifyAccountPassword(findAccountByIdentifier('ramon@escola.com', s), 'top123'), true);
  assert.equal(await verifyAccountPassword(findAccountByIdentifier('ramon@escola.com', s), 'naoe'), false);
});

test('clearActiveAccount tira a sessão (jogar sem conta)', async () => {
  const s = memStorage();
  await createAccount({ name: 'Zed' }, s);
  assert.ok(getActiveAccount(s));
  clearActiveAccount(s);
  assert.equal(getActiveAccount(s), null);
  assert.equal(listAccounts(s).length, 1, 'a conta continua salva, só estamos deslogados');
});
