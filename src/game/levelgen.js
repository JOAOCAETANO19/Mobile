// Conversão de eventos musicais (onsets, BPM, seções) em obstáculos + relógio do mundo.
// Geração determinística: mesma análise + mesma seed -> sempre o mesmo mapa.

import { createRng, seedFromTrack } from '../core/rng.js';

export const CELL = 1; // unidade de mundo (1 célula = 1 unidade lógica, renderer escala em px)
export const JUMP_HEIGHT_CELLS = 1.9;

/** Física derivada do BPM: o arco do pulo dura exatamente 1 batida. */
export function physicsForBpm(bpm) {
  const T = 60 / bpm; // duração de 1 batida em segundos
  const h = JUMP_HEIGHT_CELLS;
  const v = (4 * h) / T; // velocidade inicial do pulo
  const g = (8 * h) / (T * T); // gravidade
  return { T, h, v, g };
}

const SECTION_DENSITY = {
  drop: 1, // obstáculo a cada batida
  build: 2, // a cada 2 batidas
  flow: 3, // a cada 3 batidas
  break: 0, // sem obstáculos
  intro: 0,
  outro: 0,
};

/**
 * Pesos do sorteio do tipo de obstáculo por seção (soma normalizada em runtime).
 * "block" aparece com frequência maior em builds (variedade), e "shield" é raro,
 * só em seções densas, para dar um respiro no momento certo.
 */
const TYPE_WEIGHTS = {
  drop: { spike: 54, block: 24, pad: 10, orb: 6, shield: 6 },
  build: { spike: 30, block: 40, pad: 15, orb: 9, shield: 6 },
  flow: { spike: 55, block: 20, pad: 15, orb: 10, shield: 0 },
};
const DEFAULT_TYPE_WEIGHTS = TYPE_WEIGHTS.flow;

const OBSTACLE_TYPES = ['spike', 'block', 'pad', 'orb', 'shield'];
const INTRO_SPIKE_BEATS = 3; // abertura previsível: os 3 primeiros obstáculos são espinhos
const MIN_SHIELD_GAP_BEATS = 16; // não empilhar escudos: intervalo mínimo entre um e outro

/** Sorteia o tipo do obstáculo determinísticamente (RNG injetado). */
function pickObstacleType(rng, sectionLabel, obstaclesPlaced, beatsSinceLastShield) {
  if (obstaclesPlaced < INTRO_SPIKE_BEATS) return 'spike';
  const weights = TYPE_WEIGHTS[sectionLabel] || DEFAULT_TYPE_WEIGHTS;
  const candidates = [];
  let total = 0;
  for (const [type, weight] of Object.entries(weights)) {
    if (weight <= 0) continue;
    if (type === 'shield' && beatsSinceLastShield < MIN_SHIELD_GAP_BEATS) continue;
    candidates.push([type, weight]);
    total += weight;
  }
  let roll = rng() * total;
  for (const [type, weight] of candidates) {
    roll -= weight;
    if (roll < 0) return type;
  }
  return candidates[candidates.length - 1][0];
}

function sectionAt(sections, time) {
  for (const s of sections) {
    if (time >= s.start && time < s.end) return s;
  }
  return sections[sections.length - 1];
}

/**
 * Gera a lista de batidas (grid) a partir do BPM e duração, ancoradas no tempo 0.
 */
export function generateBeatGrid(bpm, durationSec, startOffset = 0) {
  const T = 60 / bpm;
  const beats = [];
  let t = startOffset;
  let index = 0;
  while (t < durationSec) {
    beats.push({ index, time: t });
    t += T;
    index++;
  }
  return beats;
}

/**
 * Gera os obstáculos do nível: espinhos plantados no meio da batida (pico do pulo),
 * com densidade dependente da seção musical, e coletáveis distribuídos com o RNG determinístico.
 */
export function generateLevel(analysis, track = {}) {
  const { bpm, sections, durationSec } = analysis;
  const { T } = physicsForBpm(bpm);
  const rng = createRng(seedFromTrack({ ...track, duration: durationSec }));

  const beats = generateBeatGrid(bpm, durationSec);
  const obstacles = [];
  const collectibles = [];

  let beatsSinceLastObstacle = 0;
  let beatsSinceLastShield = Infinity;

  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    const section = sectionAt(sections, beat.time) || { label: 'flow', color: '#7c5cff' };
    const density = SECTION_DENSITY[section.label] ?? 2;
    beatsSinceLastObstacle++;
    beatsSinceLastShield++;

    if (density > 0 && beatsSinceLastObstacle >= density) {
      beatsSinceLastObstacle = 0;
      // Obstáculo plantado no meio da batida = pico do arco do pulo seguinte.
      const spikeTime = beat.time + T / 2;

      const type = pickObstacleType(rng, section.label, obstacles.length, beatsSinceLastShield);
      if (type === 'shield') beatsSinceLastShield = 0;

      obstacles.push({
        id: `ob_${i}`,
        type,
        time: spikeTime,
        beatIndex: i,
        section: section.label,
        color: section.color || '#7c5cff',
        glow: section.glow || '#b39dff',
      });

      // Coletável ocasional (diamante) entre obstáculos, fora da linha de colisão do pulo.
      if (rng() > 0.75) {
        collectibles.push({
          id: `col_${i}`,
          time: beat.time + T * 0.25,
          section: section.label,
        });
      }
    }
  }

  return {
    bpm,
    durationSec,
    physics: physicsForBpm(bpm),
    beats,
    obstacles,
    collectibles,
    sections,
    seed: seedFromTrack({ ...track, duration: durationSec }),
  };
}

/**
 * Encontra o checkpoint (início da seção) mais próximo de um dado tempo — usado para
 * "Retomar do DROP · 45%" ao morrer.
 */
export function findCheckpoint(level, atTime) {
  const sections = level.sections;
  let current = sections[0];
  for (const s of sections) {
    if (s.start <= atTime) current = s;
    else break;
  }
  const progressPct = Math.round((atTime / level.durationSec) * 100);
  return { time: current.start, label: current.label, progressPct };
}
