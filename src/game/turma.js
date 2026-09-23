// Modo Turma (placar local no mesmo celular): cada jogador toca a mesma música,
// um de cada vez, e no final sai o ranking. Lógica pura e testável — o estado
// e a persistência (localStorage) ficam no main.js.

/**
 * Ordena os resultados da rodada: mais progresso primeiro; desempate por
 * pontuação e depois por melhor combo.
 */
export function sortTurmaResults(rows) {
  return [...rows].sort(
    (a, b) =>
      (b.progressPct ?? 0) - (a.progressPct ?? 0) ||
      (b.score ?? 0) - (a.score ?? 0) ||
      (b.bestCombo ?? 0) - (a.bestCombo ?? 0)
  );
}

/** Medalha do pódio (🥇🥈🥉) ou posição ordinal a partir do 4º. */
export function medalFor(index) {
  return ['🥇', '🥈', '🥉'][index] || `${index + 1}º`;
}

/** Estado inicial de uma turma (sem rodada em andamento). */
export function emptyTurma() {
  return { active: false, players: [], current: 0, results: [] };
}

/** Normaliza um nome de jogador (trim + limite razoável). */
export function normalizePlayerName(name) {
  return String(name ?? '').trim().slice(0, 16);
}

/**
 * Reinicia a rodada mantendo os jogadores (revanche): zera ponteiro e resultados.
 */
export function restartRound(turma) {
  return { ...turma, current: 0, results: [] };
}
