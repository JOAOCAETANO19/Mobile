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
  MISS_BEAT_FRACTION: 0.3, // tolerância total ~0.3 batida
};

export const MODE = { BEAT: 'beat', FREE: 'free' };

/**
 * @typedef {Object} EngineCallbacks
 * @property {(judge: 'PERFECT'|'GOOD'|'MISS', combo: number) => void} [onJudge]
 * @property {() => void} [onNearMiss]
 * @property {(checkpoint: {time:number,label:string,progressPct:number}) => void} [onDeath]
 * @property {(collectible: object) => void} [onCollect]
 * @property {() => void} [onOrb]
 * @property {(section: object) => void} [onSectionChange]
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
    this.finished = false;
  }

  /** Beat mais próximo (para o anel visual de expectativa e para o snap do pulo). */
  nextBeat(currentTime) {
    const { beats } = this.level;
    for (let i = 0; i < beats.length; i++) {
      if (beats[i].time >= currentTime - 0.001) return beats[i];
    }
    return beats[beats.length - 1] || { index: 0, time: 0 };
  }

  nearestBeat(currentTime) {
    const { beats } = this.level;
    let nearest = beats[0];
    let best = Infinity;
    for (const b of beats) {
      const d = Math.abs(b.time - currentTime);
      if (d < best) { best = d; nearest = b; }
      if (b.time - currentTime > 1) break; // beats ordenados; corta cedo
    }
    return nearest;
  }

  /** Chamado quando o jogador toca a tela. */
  tap(currentTime) {
    if (this.player.dead || this.finished) return;

    if (this.mode === MODE.FREE) {
      if (!this.player.jumping) {
        this.player.jumping = true;
        this.player.jumpStart = currentTime;
        this.player.vy = this.freeGravity.v;
        this.callbacks.onTapVisual?.();
      }
      return;
    }

    // Modo Batida: só aceita toque se não estiver no ar.
    if (this.player.jumping) return;

    const beat = this.nearestBeat(currentTime);
    const deltaMs = (currentTime - beat.time) * 1000;
    const absMs = Math.abs(deltaMs);
    const beatDurationMs = this.physics.T * 1000;
    const missToleranceMs = beatDurationMs * JUDGE.MISS_BEAT_FRACTION;

    if (absMs > missToleranceMs) {
      // Toque fora de janela: não pula (evita "spam"), mas não pune combo diretamente.
      return;
    }

    let judge = 'GOOD';
    if (absMs <= JUDGE.PERFECT_MS) judge = 'PERFECT';
    else if (absMs <= JUDGE.GOOD_MS) judge = 'GOOD';

    this.player.jumping = true;
    this.player.jumpStart = beat.time; // snap: o arco sempre começa exatamente na batida
    this.player.vy = this.physics.v;
    this.player.landedBeatIndex = beat.index;

    this.combo += 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.score += judge === 'PERFECT' ? 100 : 50;
    this.callbacks.onJudge?.(judge, this.combo);
  }

  /** Atualiza física do jogador (altura do pulo) para o tempo atual. */
  updatePlayer(currentTime, dt) {
    const p = this.player;
    if (p.jumping) {
      const t = currentTime - p.jumpStart;
      const { v, g, T } = this.mode === MODE.FREE
        ? { v: this.freeGravity.v, g: this.freeGravity.g, T: null }
        : this.physics;

      const y = v * t - 0.5 * g * t * t;
      if (y <= 0 && t > 0.02) {
        p.y = GROUND_Y;
        p.jumping = false;
        p.rotation = Math.round(p.rotation / 90) * 90; // aterrissa "de pé"
        p.squash = 1.3; // squash na aterrissagem
      } else {
        p.y = Math.max(0, y);
        // Rotação: 90° por pulo no modo batida; contínua e proporcional no modo livre.
        const total = this.mode === MODE.FREE ? Math.max(0.3, t * 2) : T;
        const progress = Math.min(1, t / total);
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

      if (ob.type === 'pad' || ob.type === 'orb') {
        // Pads/orbs dão impulso extra em vez de matar.
        if (dx < 0.45) {
          this.hitObstacleIds.add(ob.id);
          if (ob.type === 'orb' && this.player.jumping) {
            this.player.jumpStart = currentTime; // air-jump: reinicia o arco no ar
            this.player.vy = this.physics.v * 0.8;
            this.callbacks.onOrb?.();
          } else if (ob.type === 'pad') {
            this.player.jumping = true;
            this.player.jumpStart = currentTime;
            this.player.vy = this.physics.v * 1.1;
            this.callbacks.onOrb?.();
          }
        }
        continue;
      }

      // Espinho: colisão só se o cubo estiver baixo (não passou por cima) na hora certa.
      const hitboxHalfWidth = 0.35;
      if (dx < hitboxHalfWidth) {
        const clearance = this.player.y;
        const requiredClearance = 0.5; // altura mínima do espinho, em células
        if (clearance < requiredClearance) {
          this.hitObstacleIds.add(ob.id);
          this.die(currentTime);
          return;
        } else if (dx < hitboxHalfWidth * 1.8 && !this.lastNearMissCheck.has(ob.id)) {
          this.lastNearMissCheck.add(ob.id);
          this.callbacks.onNearMiss?.();
          this.combo += 1; // near-miss soma no combo, como descrito no README
          this.bestCombo = Math.max(this.bestCombo, this.combo);
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
          this.score += 25;
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
    }
    this.particles.update(dt);
  }
}
