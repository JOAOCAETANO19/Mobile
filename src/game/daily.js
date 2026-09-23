// Desafios diários + XP do jogador: progresso por dia (toca música, acerta
// notas, completa fase), XP acumulado e nível derivado. Lógica pura e
// testável; storage injetável como nos demais módulos.

export const DAILY_TASKS = [
  { id: 'plays', xp: 100, target: 3, label: 'Jogue 3 músicas', metric: 'plays' },
  { id: 'notes', xp: 150, target: 500, label: 'Acerte 500 notas', metric: 'notes' },
  { id: 'finish', xp: 200, target: 1, label: 'Complete 1 mapa difícil', metric: 'finishes' },
];

export const XP_PER_LEVEL = 100;

const DAILY_KEY = 'rhythm-dash-daily-v2';
const XP_KEY = 'rhythm-dash-xp-v1';

/** Escopo por jogador: junta o sufixo do escopo de recordes na chave do storage. */
const scopedKey = (base, suffix) => (suffix ? `${base}@${suffix}` : base);

export const todayKey = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

const blankDaily = (date) => ({ date, plays: 0, notes: 0, finishes: 0, claimed: [] });

/** Carrega o dia; virou outro dia → zera contadores (os XPs já ganhos ficam). */
export function loadDaily(storage = globalThis.localStorage, scope = '', now = new Date()) {
  let obj = null;
  try {
    const raw = storage?.getItem(scopedKey(DAILY_KEY, scope));
    if (raw) obj = JSON.parse(raw);
  } catch { /* noop */ }
  if (!obj || obj.date !== todayKey(now)) return blankDaily(todayKey(now));
  return { ...blankDaily(obj.date), ...obj };
}

export function saveDaily(state, storage = globalThis.localStorage, scope = '') {
  try {
    storage?.setItem(scopedKey(DAILY_KEY, scope), JSON.stringify(state));
  } catch { /* noop */ }
  return state;
}

/**
 * Aplica o resultado de uma partida ao dia e auto-resgata o XP das tarefas
 * concluídas AGORA. Retorna { state, xpGained, completedIds }.
 */
export function applyRunToDaily(run, state) {
  const next = { ...state };
  next.plays += 1;
  next.notes += Math.max(0, Math.floor(run.notesHit || 0));
  if (run.finished) next.finishes += 1;
  const gains = { state: next, xpGained: 0, completedIds: [] };
  for (const task of DAILY_TASKS) {
    const cur = next[task.metric] || 0;
    const done = cur >= task.target;
    if (done && !next.claimed.includes(task.id)) {
      next.claimed = [...next.claimed, task.id];
      gains.xpGained += task.xp;
      gains.completedIds.push(task.id);
    }
  }
  return gains;
}

/** Progresso formatado pra tela ("2/3", barra, concluído?). */
export function tasksWithProgress(state) {
  return DAILY_TASKS.map((task) => {
    const cur = Math.min(state[task.metric] || 0, task.target);
    return {
      ...task,
      cur,
      pct: Math.round((cur / task.target) * 100),
      done: cur >= task.target,
      claimed: state.claimed.includes(task.id),
    };
  });
}

/* ---------- XP total ---------- */

export function loadXp(storage = globalThis.localStorage, scope = '') {
  try {
    return Math.max(0, Math.floor(JSON.parse(storage?.getItem(scopedKey(XP_KEY, scope)) || '0')));
  } catch {
    return 0;
  }
}

export function addXp(amount, storage = globalThis.localStorage, scope = '') {
  const total = loadXp(storage, scope) + Math.max(0, Math.floor(amount));
  try {
    storage?.setItem(scopedKey(XP_KEY, scope), JSON.stringify(total));
  } catch { /* noop */ }
  return total;
}

/** Nível pelo XP total: a cada XP_PER_LEVEL sobe 1. */
export function levelForXp(xp) {
  return Math.floor(Math.max(0, xp) / XP_PER_LEVEL) + 1;
}

export function xpIntoLevel(xp) {
  return Math.max(0, xp) % XP_PER_LEVEL;
}
