// Máquina de estados da contagem regressiva 3-2-1 (pura, sem DOM).
// Roda antes de iniciar a música, retomar de um checkpoint, recomeçar e "jogar de novo":
// a cena fica congelada no ponto de partida e o áudio só começa quando a contagem termina.

export const COUNTDOWN_TOTAL_MS = 3000; // 1s por número: 3 → 2 → 1
export const COUNTDOWN_STEP_MS = 1000;

export class Countdown {
  /**
   * @param {object} [opts]
   * @param {number} [opts.totalMs] duração total (padrão: 3000ms)
   * @param {(number: number) => void} [opts.onNumber] chamado a cada mudança do número exibido (3, 2, 1)
   * @param {() => void} [opts.onDone] chamado uma única vez ao completar
   */
  constructor({ totalMs = COUNTDOWN_TOTAL_MS, onNumber, onDone } = {}) {
    this.totalMs = totalMs;
    this.onNumber = onNumber;
    this.onDone = onDone;
    this.startAt = null;
    this.lastNumber = null;
    this.done = false;
  }

  /** Inicia a contagem na marca `now` (ex.: performance.now()). Retorna o número inicial. */
  start(now = 0) {
    this.startAt = now;
    this.done = false;
    this.lastNumber = null;
    return this.update(now);
  }

  /**
   * Avança a contagem.
   * @returns {number|null} número atual (3/2/1) ou null quando já terminou.
   */
  update(now) {
    if (this.done || this.startAt === null) return null;
    const elapsed = now - this.startAt;
    if (elapsed >= this.totalMs) {
      this.done = true;
      this.onDone?.();
      return null;
    }
    const number = Math.max(1, Math.min(3, Math.ceil((this.totalMs - elapsed) / COUNTDOWN_STEP_MS)));
    if (number !== this.lastNumber) {
      this.lastNumber = number;
      this.onNumber?.(number);
    }
    return number;
  }
}
