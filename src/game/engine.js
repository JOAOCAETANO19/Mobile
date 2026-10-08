// Loop do jogo, física, colisões e sincronia com o áudio.
// O relógio do jogo é o relógio do áudio (AudioContext.currentTime, injetado via getAudioTime):
// posição do jogador, obstáculos e câmera derivam do tempo da música -> sincronia perfeita.

import { physicsForBpm } from './levelgen.js';
import { ParticlePool } from './particles.js';

export const CELLS_PER_BEAT = 3; // distância visual entre batidas (mundo, em células)
export const GROUND_Y = 0; // altura do chão em células
export const PLAYER_SIZE = 0.8; // lado do cubo, em células
export const PLAYER_SCREEN_X_RATIO = 0.28; // posição fixa do jogador na tela (fração da largura)

export const JUDGE = {
  PERFECT_MS: 60,
  GOOD_MS: 150,
  PERFECT_BEAT_FRACTION: 0.12, // janela musical do PERFEITO: 12% da batida
  GOOD_BEAT_FRACTION: 0.25, // janela musical do BOM: 25% da batida
  MISS_BEAT_FRACTION: 0.3, // tolerância total ~0.3 batida
};

/**
 * Janelas de julgamento "musicais": cada uma é o mais restritivo entre o valor
 * fixo (ms) e a fração proporcional à duração da batida — o feeling do clique
 * em relação à batida é o mesmo em qualquer BPM.
 */
export function judgeWindowsForBeat(beatMs) {
  return {
    perfectMs: Math.min(JUDGE.PERFECT_MS, beatMs * JUDGE.PERFECT_BEAT_FRACTION),
    goodMs: Math.min(JUDGE.GOOD_MS, beatMs * JUDGE.GOOD_BEAT_FRACTION),
    missMs: beatMs * JUDGE.MISS_BEAT_FRACTION,
  };
}

/**
 * Física real dos boosts:
 * - pad: estica o arco do pulo para 1,15 batidas (vy = 1,15·v → voo = 2·vy/g = 1,15·T);
 * - orb: air-jump a partir da altura atual — novo arco começando em player.y
 *   (sem teleport para o chão).
 */
export const BOOST = {
  PAD_ARC_BEATS: 1.15,
  ORB_VY_FACTOR: 0.8,
  PAD_GROUND_EPS: 0.15, // "no chão" para ativar o pad (tolerância, em células)
};

export const MODE = { BEAT: 'beat', FREE: 'free' };

/** Pontuação base (antes do multiplicador de combo). */
export const SCORE = {
  PERFECT: 100,
  GOOD: 50,
  NEAR_MISS: 25,
  COLLECT: 25,
};

/**
 * Degráus do multiplicador de pontuação por combo: 1x (padrão) → 2x a partir de
 * 10 de combo → 3x a partir de 25 → 4x a partir de 50. Cruzar uma tier dispara
 * onComboMilestone (banner + vibração no front).
 */
export const COMBO_MILESTONES = [
  { combo: 10, mult: 2 },
  { combo: 25, mult: 3 },
  { combo: 50, mult: 4 },
];

export function multiplierForCombo(combo) {
  let mult = 1;
  for (const m of COMBO_MILESTONES) {
    if (combo >= m.combo) mult = m.mult;
  }
  return mult;
}

const TRAIL_WINDOW_SEC = 0.3; // rastro: janela de posições recentes do jogador
const TRAIL_MAX_POINTS = 24;

function lowerBoundByTime(items, time) {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (items[middle].time < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * @typedef {Object} EngineCallbacks
 * @property {(judge: 'PERFECT'|'GOOD', combo: number) => void} [onJudge]
 * @property {(deltaMs: number, beat: object) => void} [onTapMiss]
 * @property {(obstacle: object) => void} [onNearMiss]
 * @property {(checkpoint: {time:number,label:string,progressPct:number}) => void} [onDeath]
 * @property {(collectible: object) => void} [onCollect]
 * @property {(obstacle: object) => void} [onOrb]
 * @property {(obstacle: object) => void} [onPad]
 * @property {(section: object) => void} [onSectionChange]
 * @property {(milestone: {combo:number,mult:number}) => void} [onComboMilestone]
 * @property {(obstacle: object) => void} [onShieldPickup]
 * @property {(obstacle: object) => void} [onShieldBreak]
 * @property {() => void} [onFinish]
 */

export class GameEngine {
  /**
   * @param {object} level saída de generateLevel()
   * @param {EngineCallbacks} callbacks
   * @param {'beat'|'free'} mode
   */
  constructor(level, callbacks = {}, mode = MODE.BEAT) {
    this.level = level;
    this.callbacks = callbacks;
    this.mode = mode;
    this.physics = physicsForBpm(level.bpm);

    this.reset();
    this.particles = new ParticlePool(400);
  }

  reset(startTime = 0) {
    this.startTimeOffset = startTime; // permite retomar de um checkpoint
    this.player = {
      y: GROUND_Y,
      vy: 0,
      jumping: false,
      jumpStart: 0,
      jumpOffset: 0, // altura base do arco atual (0 no chão; altura atual no air-jump do orb)
      rotation: 0,
      squash: 1,
      dead: false,
      landedBeatIndex: -1,
    };
    this.combo = 0;
    this.bestCombo = 0;
    this.score = 0;
    this.currentSectionLabel = null;
    this.hitObstacleIds = new Set();
    this.freeGravity = { g: 22, v: 9 }; // parâmetros fixos para o Modo Livre
    this.lastNearMissCheck = new Set();
    this.shieldActive = false; // escudo absorve uma colisão fatal e depois desaparece
    this.trail = []; // posições recentes {y, t} para o rastro neon
    this.finished = false;
    this.particles?.clear();
  }

  /** Soma pontos já aplicando o multiplicador do combo atual. */
  addScore(basePoints) {
    const gained = Math.round(basePoints * multiplierForCombo(this.combo));
    this.score += gained;
    return gained;
  }

  /**
   * Registro central de "hit": toques bem cronometrados e near-misses passam por aqui.
   * Incrementa combo (e melhor combo), converte em pontos via multiplicador e
   * celebra o marco quando o combo cruza uma nova tier.
   */
  registerHit(basePoints, kind = 'HIT') {
    const comboBefore = this.combo;
    this.combo += 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const gained = this.addScore(basePoints);
    const milestone =
      COMBO_MILESTONES.find((m) => comboBefore < m.combo && this.combo >= m.combo) || null;
    if (milestone) this.callbacks.onComboMilestone?.(milestone);
    this.callbacks.onRegisterHit?.({ kind, combo: this.combo, gained, milestone });
    return { gained, milestone, combo: this.combo };
  }

  /** Beat seguinte (para o snap do pulo); grid ordenado, busca em O(log n). */
  nextBeat(currentTime) {
    const { beats } = this.level;
    if (!beats.length) return { index: 0, time: 0 };
    const index = lowerBoundByTime(beats, currentTime - 0.001);
    return beats[Math.min(index, beats.length - 1)];
  }

  /** Beat mais próximo para o anel visual e o julgamento, em O(log n). */
  nearestBeat(currentTime) {
    const { beats } = this.level;
    if (!beats.length) return { index: 0, time: 0 };
    const index = lowerBoundByTime(beats, currentTime);
    const before = beats[Math.max(0, index - 1)];
    const after = beats[Math.min(index, beats.length - 1)];
    return Math.abs(currentTime - before.time) <= Math.abs(after.time - currentTime) ? before : after;
  }

  /** Chamado quando o jogador toca a tela. */
  tap(currentTime) {
    if (this.player.dead || this.finished) return false;

    if (this.mode === MODE.FREE) {
      if (!this.player.jumping) {
        this.player.jumping = true;
        this.player.jumpStart = currentTime;
        this.player.jumpOffset = 0;
        this.player.vy = this.freeGravity.v;
        this.callbacks.onTapVisual?.();
        return true;
      }
      return false;
    }

    // Modo Batida: avalia primeiro a batida para permitir buffer dentro da janela.
    // Assim um toque ligeiramente antecipado no beat seguinte não se perde só porque
    // o último frame de animação ainda não atualizou a aterrissagem do salto anterior.
    const beat = this.nearestBeat(currentTime);
    const deltaMs = (currentTime - beat.time) * 1000;
    const absMs = Math.abs(deltaMs);
    const beatDurationMs = this.physics.T * 1000;
    const windows = judgeWindowsForBeat(beatDurationMs); // tolerância musical

    if (absMs > windows.missMs) {
      // Toque fora de janela: não pula nem pune combo, mas dá feedback claro ao jogador.
      this.callbacks.onTapMiss?.(deltaMs, beat);
      return false;
    }

    // Recalcula a física no instante do toque: o loop visual pode estar um frame atrás.
    if (this.player.jumping) {
      this.updatePlayer(currentTime, 0);
      if (this.player.jumping) {
        const g = this.physics.g;
        const landingDuration = (
          this.player.vy
          + Math.sqrt(this.player.vy ** 2 + 2 * g * this.player.jumpOffset)
        ) / g;
        const landingTime = this.player.jumpStart + landingDuration;
        if (landingTime > beat.time + 0.001) return false;
        this.updatePlayer(beat.time, 0);
      }
      if (this.player.jumping) return false;
    }

    let judge = 'GOOD';
    if (absMs <= windows.perfectMs) judge = 'PERFECT';

    this.player.jumping = true;
    this.player.jumpStart = beat.time; // snap: o arco sempre começa exatamente na batida
    this.player.jumpOffset = 0;
    this.player.vy = this.physics.v;
    this.player.landedBeatIndex = beat.index;

    // Combo + pontuação (com multiplicador) passam pelo registro central de hits.
    this.registerHit(judge === 'PERFECT' ? SCORE.PERFECT : SCORE.GOOD, judge);
    this.callbacks.onJudge?.(judge, this.combo);
    return true;
  }

  /** Atualiza física do jogador (altura do pulo) para o tempo atual. */
  updatePlayer(currentTime, dt) {
    const p = this.player;
    if (p.jumping) {
      const t = currentTime - p.jumpStart;
      const g = this.mode === MODE.FREE ? this.freeGravity.g : this.physics.g;

      // Arco parábólico a partir da altura base (jumpOffset): pulo normal do chão,
      // pad esticado (1,15 batidas) ou air-jump do orb (que parte da altura atual).
      const y = p.jumpOffset + p.vy * t - 0.5 * g * t * t;
      if (y <= 0 && t > 0.02) {
        p.y = GROUND_Y;
        p.jumping = false;
        p.jumpOffset = 0;
        p.rotation = Math.round(p.rotation / 90) * 90; // aterrissa "de pé"
        p.squash = 1.3; // squash na aterrissagem
      } else {
        p.y = Math.max(0, y);
        // Um arco de pulo ocupa 90° de rotação, tanto no modo livre quanto no
        // modo batida. A duração real vem da velocidade vertical e da gravidade.
        const total = (2 * p.vy) / g;
        const progress = Math.max(0, Math.min(1, t / total));
        p.rotation = progress * 90;
        p.squash = 1 - Math.min(0.25, y * 0.05); // estica levemente no ar
      }
    } else {
      p.squash += (1 - p.squash) * Math.min(1, dt * 10); // volta ao normal suavemente
    }
  }

  /** Janela de obstáculos visíveis, com posição em tela já calculada. */
  getVisibleObstacles(currentTime, canvasWidthCells) {
    const worldX = (t) => t * CELLS_PER_BEAT * (this.level.bpm / 60);
    const playerWorldX = worldX(currentTime);
    const playerScreenX = canvasWidthCells * PLAYER_SCREEN_X_RATIO;

    const visible = [];
    for (const ob of this.level.obstacles) {
      const screenX = playerScreenX + (worldX(ob.time) - playerWorldX);
      if (screenX > -2 && screenX < canvasWidthCells + 2) {
        visible.push({ ...ob, screenX });
      }
    }
    return visible;
  }

  getVisibleCollectibles(currentTime, canvasWidthCells) {
    const worldX = (t) => t * CELLS_PER_BEAT * (this.level.bpm / 60);
    const playerWorldX = worldX(currentTime);
    const playerScreenX = canvasWidthCells * PLAYER_SCREEN_X_RATIO;

    const visible = [];
    for (const col of this.level.collectibles) {
      if (col.collected) continue;
      const screenX = playerScreenX + (worldX(col.time) - playerWorldX);
      if (screenX > -2 && screenX < canvasWidthCells + 2) {
        visible.push({ ...col, screenX });
      }
    }
    return visible;
  }

  /** Checagem de colisão justa: só conta se o jogador está baixo o suficiente no momento certo. */
  checkCollisions(currentTime, canvasWidthCells) {
    if (this.player.dead) return;
    const playerScreenX = canvasWidthCells * PLAYER_SCREEN_X_RATIO;
    const obstacles = this.getVisibleObstacles(currentTime, canvasWidthCells);

    for (const ob of obstacles) {
      if (this.hitObstacleIds.has(ob.id)) continue;
      const dx = Math.abs(ob.screenX - playerScreenX);

      if (ob.type === 'shield') {
        // Power-up: coletar ativa o escudo (já ativo, o item é ignorado).
        if (dx < 0.45) {
          this.hitObstacleIds.add(ob.id);
          if (!this.shieldActive) {
            this.shieldActive = true;
            this.callbacks.onShieldPickup?.(ob);
          }
        }
        continue;
      }

      if (ob.type === 'pad' || ob.type === 'orb') {
        // Pads/orbs dão impulso extra em vez de matar — com física real:
        // o novo arco parte exatamente de onde o jogador está.
        if (dx < 0.45) {
          const p = this.player;
          if (ob.type === 'orb' && p.jumping) {
            // Air-jump da altura atual: novo arco começando em p.y (sem teleport).
            this.hitObstacleIds.add(ob.id);
            p.jumpOffset = p.y;
            p.jumpStart = currentTime;
            p.vy = this.physics.v * BOOST.ORB_VY_FACTOR;
            this.callbacks.onOrb?.(ob);
          } else if (ob.type === 'pad' && (!p.jumping || p.y <= BOOST.PAD_GROUND_EPS)) {
            // Pad estica o arco para 1,15 batidas: tempo de voo = 2·vy/g = 1,15·T.
            this.hitObstacleIds.add(ob.id);
            p.jumping = true;
            p.jumpOffset = 0;
            p.jumpStart = currentTime;
            p.vy = this.physics.v * BOOST.PAD_ARC_BEATS;
            this.callbacks.onPad?.(ob);
          }
        }
        continue;
      }

      // Espinho/bloco: colisão fatal só se o cubo estiver baixo (não passou por cima).
      const hitboxHalfWidth = 0.35;
      if (dx < hitboxHalfWidth) {
        const clearance = this.player.y;
        const requiredClearance = 0.5; // altura mínima do obstáculo, em células
        if (clearance < requiredClearance) {
          this.hitObstacleIds.add(ob.id);
          if (this.shieldActive) {
            // O escudo absorve o golpe fatal e desaparece — o jogador respira.
            this.shieldActive = false;
            this.callbacks.onShieldBreak?.(ob);
          } else {
            this.die(currentTime);
            return;
          }
        } else if (dx < hitboxHalfWidth * 1.8 && !this.lastNearMissCheck.has(ob.id)) {
          this.lastNearMissCheck.add(ob.id);
          this.callbacks.onNearMiss?.(ob);
          // Near-miss soma no combo E em pontos, via o registro central de hits.
          this.registerHit(SCORE.NEAR_MISS, 'NEAR_MISS');
        }
      }
    }

    // Coletáveis
    const collectibles = this.getVisibleCollectibles(currentTime, canvasWidthCells);
    for (const col of collectibles) {
      const dx = Math.abs(col.screenX - playerScreenX);
      if (dx < 0.4) {
        const original = this.level.collectibles.find((c) => c.id === col.id);
        if (original && !original.collected) {
          original.collected = true;
          this.addScore(SCORE.COLLECT);
          this.callbacks.onCollect?.(col);
        }
      }
    }
  }

  die(currentTime) {
    this.player.dead = true;
    this.combo = 0;
    const checkpoint = this.findCheckpointTime(currentTime);
    this.callbacks.onDeath?.(checkpoint);
  }

  findCheckpointTime(atTime) {
    const sections = this.level.sections;
    let current = sections[0];
    for (const s of sections) {
      if (s.start <= atTime) current = s;
      else break;
    }
    return {
      time: current.start,
      label: current.label,
      progressPct: Math.round((atTime / this.level.durationSec) * 100),
    };
  }

  checkSectionChange(currentTime) {
    const section = this.level.sections.find((s) => currentTime >= s.start && currentTime < s.end);
    if (section && section.label !== this.currentSectionLabel) {
      this.currentSectionLabel = section.label;
      this.callbacks.onSectionChange?.(section);
    }
    return section;
  }

  /** Passo principal do loop, chamado a cada frame com o tempo do áudio e o dt visual. */
  update(currentTime, dt, canvasWidthCells) {
    if (this.finished) return;
    if (currentTime >= this.level.durationSec) {
      this.finished = true;
      this.callbacks.onFinish?.();
      return;
    }
    this.updatePlayer(currentTime, dt);
    this.checkSectionChange(currentTime);
    if (!this.player.dead) {
      this.checkCollisions(currentTime, canvasWidthCells);
      // Rastro: guarda posições recentes (altura em células + tempo do áudio).
      this.trail.push({ y: this.player.y, t: currentTime });
      const cutoff = currentTime - TRAIL_WINDOW_SEC;
      while (this.trail.length && this.trail[0].t < cutoff) this.trail.shift();
      if (this.trail.length > TRAIL_MAX_POINTS) this.trail.splice(0, this.trail.length - TRAIL_MAX_POINTS);
    }
    this.particles.update(dt);
  }
}
