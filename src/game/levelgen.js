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

/**
 * Padrões rítmicos: "células" de 1–2 batidas com obstáculos plantados no meio de
 * cada batida ocupada (offset 0.5 = pico do pulo daquela batida):
 * - single:     o clássico — 1 obstáculo (tipo decidido pelos pesos da seção);
 * - double:     dois pulos em sequência (dupla batida, "double tap");
 * - blockSpike: bloco seguido de espinho (2 batidas);
 * - padSpike:   [pad, espinho] — o pad estica o arco para 1,15 batidas e carrega
 *               o jogador por cima do espinho da batida seguinte.
 * A garantia "sem beat ocupado duas vezes" vem do posicionador: um padrão só
 * começa quando as batidas que ele ocupa estão livres, e o próximo início só
 * acontece depois das batidas ocupadas + o intervalo de densidade da seção.
 */
export const RHYTHM_PATTERNS = {
  single: { beats: 1, slots: [{ offset: 0.5, type: null }] }, // type null = pesos da seção
  double: { beats: 2, slots: [{ offset: 0.5, type: 'spike' }, { offset: 1.5, type: 'spike' }] },
  blockSpike: { beats: 2, slots: [{ offset: 0.5, type: 'block' }, { offset: 1.5, type: 'spike' }] },
  padSpike: { beats: 2, slots: [{ offset: 0.5, type: 'pad' }, { offset: 1.5, type: 'spike' }] },
};

/** Pesos do sorteio do padrão por seção (o drop é o mais "rítmico"; o build
 *  privilegia single/bloco para manter a "variedade" de blocos da seção). */
const PATTERN_WEIGHTS = {
  drop: { single: 50, double: 16, blockSpike: 17, padSpike: 17 },
  build: { single: 76, double: 6, blockSpike: 10, padSpike: 8 },
  flow: { single: 82, double: 0, blockSpike: 9, padSpike: 9 },
};
const DEFAULT_PATTERN_WEIGHTS = PATTERN_WEIGHTS.flow;

/** Sorteia o padrão rítmico determinísticamente (RNG injetado). */
function pickPattern(rng, sectionLabel, obstaclesPlaced, beatsLeft) {
  if (obstaclesPlaced < INTRO_SPIKE_BEATS) return 'single';
  const weights = PATTERN_WEIGHTS[sectionLabel] || DEFAULT_PATTERN_WEIGHTS;
  const candidates = [];
  let total = 0;
  for (const [name, weight] of Object.entries(weights)) {
    if (weight <= 0) continue;
    if (RHYTHM_PATTERNS[name].beats > beatsLeft) continue; // padrão não cabe no fim do nível
    candidates.push([name, weight]);
    total += weight;
  }
  if (!candidates.length) return 'single';
  let roll = rng() * total;
  for (const [name, weight] of candidates) {
    roll -= weight;
    if (roll < 0) return name;
  }
  return candidates[candidates.length - 1][0];
}

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
/**
 * O mapa nasce DA MÚSICA: a análise traz onsets (batidas reais com força), e o
 * gerador traduz isso em jogo —
 * - batida real FORTE  → intensifica (dupla/bloco);
 * - silêncio no trecho → o mapa descansa junto (fora do drop);
 * - entrada de DROP    → obstáculo de impacto obrigatório (o "uau" da música);
 * - build              → rampa de densidade (esquenta até o drop);
 * - respira de frase   → 1 batida livre a cada 8 fora do drop;
 * - moedas             → arcos coroando acentos; nas partes calmas seguem a melodia.
 * Tudo determinístico: mesma análise + mesma seed → sempre o mesmo mapa.
 */
export function generateLevel(analysis, track = {}) {
  const { bpm, sections, durationSec } = analysis;
  const { T } = physicsForBpm(bpm);
  const rng = createRng(seedFromTrack({ ...track, duration: durationSec }));

  const beats = generateBeatGrid(bpm, durationSec);
  const obstacles = [];
  const collectibles = [];

  // Escuta musical: onsets (batidas reais) com força 0..1, vindos da análise.
  // Sem dados de onsets → regras musicais neutras (comportamento clássico).
  const onsets = Array.isArray(analysis.onsets) && analysis.onsets.length ? analysis.onsets : null;
  let onsetCursor = 0;
  const onsetStrengthAt = (t) => {
    if (!onsets) return null;
    const tol = Math.min(0.12, T * 0.25);
    // Cursor anda para trás/para frente até a janela [t-tol, t+tol].
    while (onsetCursor > 0 && onsets[onsetCursor - 1].time >= t - tol) onsetCursor--;
    while (onsetCursor < onsets.length && onsets[onsetCursor].time < t - tol) onsetCursor++;
    let best = 0;
    for (let j = onsetCursor; j < onsets.length && onsets[j].time <= t + tol; j++) {
      best = Math.max(best, onsets[j].strength ?? 1);
    }
    return best;
  };

  let nextPlaceBeat = 0; // primeira batida onde um novo padrão pode começar
  let beatsSinceLastShield = Infinity;
  const impactedDrops = new Set(); // drops que já receberam seu obstáculo de impacto

  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    const section = sectionAt(sections, beat.time) || { label: 'flow', color: '#7c5cff' };
    let density = SECTION_DENSITY[section.label] ?? 2;
    beatsSinceLastShield++;

    // Build em rampa: a segunda metade do build densifica conforme o drop se aproxima.
    if (section.label === 'build' && section.end > section.start) {
      const frac = (beat.time - section.start) / (section.end - section.start);
      if (frac > 0.55) density = Math.max(1, density - 1);
    }

    // Respira de frase: 1 batida livre a cada 8 (2 compassos), fora do drop.
    const isRestBeat =
      section.label !== 'drop' && i % 8 === 7 && obstacles.length > INTRO_SPIKE_BEATS;

    if (density > 0 && i >= nextPlaceBeat && !isRestBeat) {
      const slotMid = beat.time + T * 0.5;
      const strength = onsetStrengthAt(slotMid); // null quando não há dados
      const firstPlacements = obstacles.length < INTRO_SPIKE_BEATS;

      // Sem batida real perto: a música está vazia aqui — o mapa descansa junto
      // (55% de chance de pular; fora do drop, que sempre mantém a pressão).
      if (strength === 0 && !firstPlacements && section.label !== 'drop' && rng() < 0.55) {
        continue;
      }

      // Impacto do drop: a 1ª batida jogável de CADA drop sempre recebe obstáculo
      // marcante (bloco) — é o momento "uau" da música.
      const beatIsDropStart =
        section.label === 'drop' && beat.time - section.start < T && !impactedDrops.has(section.start);
      if (beatIsDropStart) impactedDrops.add(section.start);

      let patternName = pickPattern(rng, section.label, obstacles.length, beats.length - i);
      if (beatIsDropStart) patternName = 'single';
      else if (strength != null && strength >= 0.66 && !firstPlacements && beats.length - i >= 2 && section.label !== 'build') {
        patternName = 'double'; // acento forte vira sequência de dois pulos
      }

      const pattern = RHYTHM_PATTERNS[patternName];

      for (const slot of pattern.slots) {
        const slotBeatIndex = i + Math.floor(slot.offset); // batida ocupada pelo slot
        const slotTime = beats[slotBeatIndex].time + T * (slot.offset - Math.floor(slot.offset));
        let type =
          slot.type || pickObstacleType(rng, section.label, obstacles.length, beatsSinceLastShield);
        if (beatIsDropStart && type !== 'shield') type = 'block';
        else if (strength != null && strength >= 0.66 && !slot.type && type === 'spike') type = 'block';
        if (type === 'shield') beatsSinceLastShield = 0;

        // Obstáculo plantado no meio da batida = pico do arco do pulo daquela batida.
        obstacles.push({
          id: `ob_${i}_${slotBeatIndex}`,
          type,
          time: slotTime,
          beatIndex: slotBeatIndex,
          section: section.label,
          color: section.color || '#7c5cff',
          glow: section.glow || '#b39dff',
        });
      }

      nextPlaceBeat = i + pattern.beats + (density - 1);

      // Moedas: arcos de 3 coroando acentos fortes da música; senão, solitária ocasional.
      const coinRoll = rng();
      if (coinRoll > 0.9 && strength != null && strength >= 0.5 && beat.time + T * 1.25 < durationSec) {
        for (let k = 0; k < 3; k++) {
          collectibles.push({
            id: `col_${i}_${k}`,
            time: beat.time + T * (0.25 + k * 0.5),
            section: section.label,
          });
        }
      } else if (coinRoll > 0.75) {
        collectibles.push({
          id: `col_${i}`,
          time: beat.time + T * 0.25,
          section: section.label,
        });
      }
    }
  }

  // Nas partes calmas (intro/break/outro), as moedas seguem os acentos reais
  // da melodia — trilha sonora virando trilha de diamantes.
  if (onsets) {
    let lastCoinTime = -Infinity;
    for (const o of onsets) {
      const s = sectionAt(sections, o.time);
      if (!s || (SECTION_DENSITY[s.label] ?? 2) !== 0) continue;
      if ((o.strength ?? 0) < 0.55) continue;
      if (o.time - lastCoinTime < T * 1.5) continue;
      collectibles.push({ id: `col_m_${collectibles.length}`, time: o.time, section: s.label });
      lastCoinTime = o.time;
    }
    collectibles.sort((a, b) => a.time - b.time);
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
