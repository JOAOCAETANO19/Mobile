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
  // Pads aparecem em frases próprias (na batida, quando podem ser ativados de verdade).
  // Orb e escudo seguem como eventos ocasionais, sem poluir o ritmo principal.
  drop: { spike: 58, block: 26, orb: 10, shield: 6 },
  build: { spike: 36, block: 46, orb: 12, shield: 6 },
  flow: { spike: 62, block: 23, orb: 15, shield: 0 },
};
const DEFAULT_TYPE_WEIGHTS = TYPE_WEIGHTS.flow;

const INTRO_SPIKE_BEATS = 3; // abertura previsível: os 3 primeiros obstáculos são espinhos
const MIN_SHIELD_GAP_BEATS = 16; // não empilhar escudos: intervalo mínimo entre um e outro

/**
 * Padrões rítmicos de 1–4 batidas: hazards comuns caem no meio da batida
 * (offset 0.5, encontro com o pico do pulo); o pad é a exceção intencional,
 * colocado no chão para ativar o impulso e seguido por uma janela segura.
 * Frases maiores organizam double, sequência tripla e uso legível do orb/pad.
 * A geração impede padrões de atravessar limites de seção e deixa pausas entre frases.
 */
export const RHYTHM_PATTERNS = {
  single: { beats: 1, slots: [{ offset: 0.5, type: null }] }, // tipo decidido pelos pesos da seção
  double: { beats: 2, slots: [{ offset: 0.5, type: 'spike' }, { offset: 1.5, type: 'spike' }] },
  blockSpike: { beats: 2, slots: [{ offset: 0.5, type: 'block' }, { offset: 1.5, type: 'spike' }] },
  // O pad fica no chão, no tempo da batida; o espinho vem depois de um tempo
  // seguro para o jogador aterrissar e voltar a pular.
  padSpike: { beats: 3, slots: [{ offset: 0, type: 'pad' }, { offset: 2.5, type: 'spike' }] },
  tripleRush: {
    beats: 3,
    slots: [{ offset: 0.5, type: 'spike' }, { offset: 1.5, type: 'block' }, { offset: 2.5, type: 'spike' }],
  },
  orbBridge: {
    beats: 4,
    slots: [{ offset: 0.5, type: 'spike' }, { offset: 1.5, type: 'orb' }, { offset: 3.5, type: 'spike' }],
  },
};

/** Frases com mais variação nos drops e mais espaço de leitura nos builds/flows. */
const PATTERN_WEIGHTS = {
  drop: { single: 43, double: 14, blockSpike: 15, padSpike: 9, tripleRush: 9, orbBridge: 10 },
  build: { single: 68, double: 6, blockSpike: 9, padSpike: 7, tripleRush: 5, orbBridge: 5 },
  flow: { single: 77, double: 0, blockSpike: 6, padSpike: 6, tripleRush: 4, orbBridge: 7 },
};
const DEFAULT_PATTERN_WEIGHTS = PATTERN_WEIGHTS.flow;

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function obstacleTimeForSlot(slot, beats, index, T) {
  const slotBeatIndex = index + Math.floor(slot.offset);
  const beat = beats[slotBeatIndex];
  if (!beat) return null;
  return beat.time + T * (slot.offset - Math.floor(slot.offset));
}

function patternFitsSection(pattern, beats, index, T, section, sections, durationSec) {
  return pattern.slots.every((slot) => {
    const time = obstacleTimeForSlot(slot, beats, index, T);
    if (time == null || time >= durationSec) return false;
    const occupiedSection = sectionAt(sections, time);
    return occupiedSection === section || (
      occupiedSection?.label === section.label &&
      occupiedSection?.start === section.start &&
      occupiedSection?.end === section.end
    );
  });
}

/** Accentua frases nos picos musicais, mas preserva a aleatoriedade determinística. */
function pickPattern(rng, sectionLabel, obstaclesPlaced, beatsLeft, intensity, accent, isBarStart, fits) {
  if (obstaclesPlaced < INTRO_SPIKE_BEATS) return fits('single') ? 'single' : null;
  const weights = PATTERN_WEIGHTS[sectionLabel] || DEFAULT_PATTERN_WEIGHTS;
  const candidates = [];
  let total = 0;
  for (const [name, baseWeight] of Object.entries(weights)) {
    const pattern = RHYTHM_PATTERNS[name];
    if (baseWeight <= 0 || pattern.beats > beatsLeft || !fits(name)) continue;
    const phraseFactor = pattern.beats > 1
      ? 0.74 + accent * 0.72 + intensity * 0.18
      : 1.18 - accent * 0.34;
    const barFactor = isBarStart && pattern.beats > 1 ? 1.12 : 1;
    const intensityFactor = name === 'tripleRush'
      ? 0.45 + intensity * 0.8
      : name === 'orbBridge'
        ? 0.72 + intensity * 0.4
        : 1;
    const weight = baseWeight * phraseFactor * barFactor * intensityFactor;
    candidates.push([name, weight]);
    total += weight;
  }
  if (!candidates.length) return null;
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
  for (const section of sections) {
    if (time >= section.start && time < section.end) return section;
  }
  return sections[sections.length - 1];
}

/** Maior onset dentro da batida: picos fortes podem receber frases mais marcantes. */
function beatAccents(beats, onsets, T) {
  const sorted = Array.isArray(onsets)
    ? onsets.filter((onset) => Number.isFinite(onset?.time)).slice().sort((a, b) => a.time - b.time)
    : [];
  const accents = new Float32Array(beats.length);
  let cursor = 0;
  for (let i = 0; i < beats.length; i++) {
    const start = beats[i].time - T * 0.15;
    const end = beats[i].time + T;
    while (cursor < sorted.length && sorted[cursor].time < start) cursor++;
    for (let j = cursor; j < sorted.length && sorted[j].time <= end; j++) {
      accents[i] = Math.max(accents[i], clamp01(sorted[j].strength));
    }
  }
  return accents;
}

/** Ajuste leve de cadência pela energia real, sem deixar um flow calmo lotado. */
function densityForSection(section) {
  const base = SECTION_DENSITY[section?.label] ?? 2;
  if (base <= 1 || base === 0) return base;
  const intensity = clamp01(section?.intensity ?? section?.energy ?? 0.5);
  if (base === 2 && intensity > 0.84) return 1;
  if (base === 3 && intensity > 0.82) return 2;
  if (base === 3 && intensity < 0.2) return 4;
  return base;
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
 * Estima a fase da batida a partir dos onsets, para a grade e os obstáculos
 * acompanharem a música mesmo quando a primeira batida não começa em t = 0.
 */
export function estimateBeatOffset(onsets, bpm) {
  const T = 60 / bpm;
  if (!Array.isArray(onsets) || onsets.length < 3 || !Number.isFinite(T) || T <= 0) return 0;

  const phases = onsets
    .filter((onset) => Number.isFinite(onset?.time))
    .map((onset) => ({
      phase: ((onset.time % T) + T) % T,
      weight: Math.max(0.05, clamp01(onset.strength)),
    }));
  if (phases.length < 3) return 0;

  const bins = 64;
  const sigma = T * 0.075;
  let bestPhase = 0;
  let bestScore = -Infinity;
  for (let bin = 0; bin < bins; bin++) {
    const candidate = (bin / bins) * T;
    let score = 0;
    for (const onset of phases) {
      const rawDistance = Math.abs(onset.phase - candidate);
      const distance = Math.min(rawDistance, T - rawDistance);
      score += onset.weight * Math.exp(-0.5 * (distance / sigma) ** 2);
    }
    if (score > bestScore) {
      bestScore = score;
      bestPhase = candidate;
    }
  }
  return bestPhase;
}

/**
 * Gera obstáculos e recompensas. Quando disponíveis, os onsets graves ancoram a fase
 * da grade e os acentos; a densidade segue a energia/seção e o RNG mantém o mapa reproduzível.
 */
function generateAdaptiveLevel(analysis, track = {}) {
  const { bpm, durationSec } = analysis;
  const sections = Array.isArray(analysis.sections) && analysis.sections.length
    ? analysis.sections
    : [{ label: 'flow', start: 0, end: durationSec, color: '#7c5cff', glow: '#b39dff' }];
  const { T } = physicsForBpm(bpm);
  const seed = seedFromTrack({ ...track, duration: durationSec });
  const rng = createRng(seed);
  const hasBassOnsets = Array.isArray(analysis.bassOnsets) && analysis.bassOnsets.length >= 3;
  const syncOnsets = hasBassOnsets ? analysis.bassOnsets : analysis.onsets;
  const beatOffset = estimateBeatOffset(syncOnsets, bpm);
  const beats = generateBeatGrid(bpm, durationSec, beatOffset);
  const accents = beatAccents(beats, syncOnsets, T);
  const obstacles = [];
  const collectibles = [];

  let nextPlaceBeat = 0; // primeira batida onde uma nova frase pode começar
  let beatsSinceLastShield = Infinity;

  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    const section = sectionAt(sections, beat.time) || sections[sections.length - 1];
    const density = densityForSection(section);
    beatsSinceLastShield++;

    // Intervalos calmos viram uma breve trilha de notas coletáveis, sem obstáculos.
    if (density === 0) {
      if (section?.label === 'break' && i % 2 === 0 && rng() < 0.62) {
        const time = beat.time + T * 0.5;
        if (time < durationSec && sectionAt(sections, time) === section) {
          collectibles.push({
            id: `col_break_${i}`,
            time,
            section: section.label,
            color: section.glow || section.color || '#b39dff',
            trail: true,
          });
        }
      }
      continue;
    }

    if (i < nextPlaceBeat) continue;

    const intensity = clamp01(section?.intensity ?? section?.energy ?? 0.5);
    const accent = accents[i] || 0;
    const fits = (name) => {
      const pattern = RHYTHM_PATTERNS[name];
      return Boolean(pattern && patternFitsSection(pattern, beats, i, T, section, sections, durationSec));
    };
    const patternName = pickPattern(
      rng,
      section.label,
      obstacles.length,
      beats.length - i,
      intensity,
      accent,
      i % 4 === 0,
      fits,
    );
    if (!patternName) continue; // não deixa uma frase atravessar intro, break ou outro

    const pattern = RHYTHM_PATTERNS[patternName];
    let containsPad = false;
    let containsOrb = false;
    for (let slotIndex = 0; slotIndex < pattern.slots.length; slotIndex++) {
      const slot = pattern.slots[slotIndex];
      const slotBeatIndex = i + Math.floor(slot.offset);
      const slotTime = obstacleTimeForSlot(slot, beats, i, T);
      const slotSection = sectionAt(sections, slotTime) || section;
      const type = slot.type || pickObstacleType(
        rng,
        slotSection.label,
        obstacles.length,
        beatsSinceLastShield,
      );
      const beatAccent = accents[slotBeatIndex] || 0;
      if (type === 'shield') beatsSinceLastShield = 0;
      if (type === 'pad') containsPad = true;
      if (type === 'orb') containsOrb = true;

      obstacles.push({
        id: `ob_${i}_${slotBeatIndex}_${slotIndex}`,
        type,
        time: slotTime,
        beatIndex: slotBeatIndex,
        section: slotSection.label,
        color: slotSection.color || '#7c5cff',
        glow: slotSection.glow || '#b39dff',
        hue: slotSection.hue,
        accent: beatAccent,
        intensity,
        pattern: patternName,
        phraseId: `phrase_${Math.floor(i / 4)}_${i}`,
        variant: Math.floor(rng() * 3),
      });
    }

    // Frases de três batidas terminam com uma pausa curta para o ritmo "respirar".
    // Power-ups alongam o arco; a pausa extra evita exigir um toque impossível no ar.
    nextPlaceBeat = i + pattern.beats + (density - 1);
    if (patternName === 'tripleRush') nextPlaceBeat = Math.max(nextPlaceBeat, i + pattern.beats + 1);
    if (containsPad || containsOrb) nextPlaceBeat = Math.max(nextPlaceBeat, i + 3);

    // Notas-guia aparecem nos espaços seguros entre frases e acompanham a energia.
    const restStart = i + pattern.beats;
    const rewardChance = 0.2 + (1 - intensity) * 0.2;
    for (let rewardBeat = restStart; rewardBeat < nextPlaceBeat && rewardBeat < beats.length; rewardBeat++) {
      if (rng() >= rewardChance) continue;
      const rewardTime = beats[rewardBeat].time + T * 0.5;
      if (rewardTime >= durationSec) continue;
      const rewardSection = sectionAt(sections, rewardTime) || section;
      if (densityForSection(rewardSection) === 0) continue;
      collectibles.push({
        id: `col_${i}_${rewardBeat}`,
        time: rewardTime,
        section: rewardSection.label,
        color: rewardSection.glow || rewardSection.color || '#b39dff',
        trail: true,
      });
    }
  }

  return {
    bpm,
    durationSec,
    beatOffset,
    timingSource: hasBassOnsets ? 'bass' : 'general',
    physics: physicsForBpm(bpm),
    beats,
    obstacles,
    collectibles,
    sections,
    seed,
    mapMode: 'free',
  };
}

const BEAT_MOTIFS = [
  { name: 'pulse', slots: ['spike', 'block', 'spike', 'block'] },
  { name: 'double-kick', slots: ['spike', 'spike', 'block', 'spike'] },
  { name: 'drive', slots: ['block', 'spike', 'block', 'spike'] },
  { name: 'flow', slots: ['spike', 'block', 'block', 'spike'] },
  { name: 'rush', slots: ['spike', 'spike', 'spike', 'block'] },
  { name: 'landing', slots: ['spike', 'block', 'spike', 'spike'] },
];

/** Varia a frase visual sem quebrar a regra de um obstáculo saltável por beat. */
function pickBeatMotif(rng, section, intensity) {
  const quietSection = ['intro', 'break', 'outro'].includes(section?.label);
  const weights = [
    30 + (quietSection ? 14 : 0), // pulse
    17 - (quietSection ? 5 : 0), // double-kick
    14 + intensity * 8, // drive
    22 + (quietSection ? 8 : 0), // flow
    5 + intensity * (quietSection ? 5 : 15), // rush
    12,
  ];
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = rng() * total;
  for (let i = 0; i < BEAT_MOTIFS.length; i++) {
    roll -= weights[i];
    if (roll < 0) return BEAT_MOTIFS[i];
  }
  return BEAT_MOTIFS[BEAT_MOTIFS.length - 1];
}

/**
 * Modo Batida: cada pulso da grade recebe exatamente um obstáculo que se salta.
 * Os hazards ficam no meio da batida para coincidir com o pico do arco iniciado no beat.
 * Intro, breaks e outros trechos suaves também mantêm o pulso — só a aparência muda.
 */
function generateBeatLevel(analysis, track = {}) {
  const { bpm, durationSec } = analysis;
  const sections = Array.isArray(analysis.sections) && analysis.sections.length
    ? analysis.sections
    : [{ label: 'flow', start: 0, end: durationSec, color: '#7c5cff', glow: '#b39dff' }];
  const { T } = physicsForBpm(bpm);
  const seed = seedFromTrack({ ...track, duration: durationSec });
  const rng = createRng(seed);
  const hasBassOnsets = Array.isArray(analysis.bassOnsets) && analysis.bassOnsets.length >= 3;
  const syncOnsets = hasBassOnsets ? analysis.bassOnsets : analysis.onsets;
  const beatOffset = estimateBeatOffset(syncOnsets, bpm);
  const beats = generateBeatGrid(bpm, durationSec, beatOffset);
  const accents = beatAccents(beats, syncOnsets, T);
  const obstacles = [];
  const collectibles = [];
  let motif = BEAT_MOTIFS[0];
  let motifSection = null;
  let motifStartBeat = 0;

  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    const beatSection = sectionAt(sections, beat.time) || sections[sections.length - 1];
    const intensity = clamp01(beatSection?.intensity ?? beatSection?.energy ?? 0.5);
    if (i % 4 === 0 || beatSection !== motifSection) {
      motif = pickBeatMotif(rng, beatSection, intensity);
      motifSection = beatSection;
      motifStartBeat = i;
    }

    const time = beat.time + T * 0.5;
    if (time >= durationSec) continue;

    const section = sectionAt(sections, time) || beatSection;
    const accent = accents[i] || 0;
    const motifSlot = (i - motifStartBeat) % motif.slots.length;
    let type = obstacles.length < INTRO_SPIKE_BEATS ? 'spike' : motif.slots[motifSlot];
    // Kicks fortes no início de uma frase recebem um bloco, sem remover o pulo do beat.
    if (obstacles.length >= INTRO_SPIKE_BEATS && accent >= 0.84 && motifSlot === 0 && type === 'spike') {
      type = 'block';
    }

    obstacles.push({
      id: `ob_beat_${i}`,
      type,
      time,
      beatIndex: i,
      section: section.label,
      color: section.color || '#7c5cff',
      glow: section.glow || '#b39dff',
      hue: section.hue,
      accent,
      intensity,
      pattern: motif.name,
      phraseId: `phrase_${motifStartBeat}`,
      variant: Math.floor(rng() * 3),
    });

    // Uma nota opcional no quarto beat da frase, colocada antes do obstáculo seguinte.
    if ((i + 1) % 4 === 0 && rng() < 0.76) {
      const rewardTime = beat.time + T * 0.25;
      if (rewardTime < durationSec) {
        collectibles.push({
          id: `col_beat_${i}`,
          time: rewardTime,
          section: section.label,
          color: section.glow || section.color || '#b39dff',
          trail: true,
        });
      }
    }
  }

  return {
    bpm,
    durationSec,
    beatOffset,
    timingSource: hasBassOnsets ? 'bass' : 'general',
    physics: physicsForBpm(bpm),
    beats,
    obstacles,
    collectibles,
    sections,
    seed,
    mapMode: 'beat',
  };
}

/**
 * Gera o mapa para o modo selecionado. O modo Batida garante um salto por beat;
 * o modo Livre mantém a composição adaptativa com pausas, power-ups e padrões.
 */
export function generateLevel(analysis, track = {}, mode = 'beat') {
  return mode === 'free'
    ? generateAdaptiveLevel(analysis, track)
    : generateBeatLevel(analysis, track);
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
