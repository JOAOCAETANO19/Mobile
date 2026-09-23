// Arquétipos musicais: cada música recebe uma "personalidade" (detectada pela
// análise de áudio) — e a personalidade afina o gerador de fase e o cenário.
// Como a detecção é 100% derivada da análise, o arquétipo é determinístico:
// a mesma música sempre gera o mesmo estilo de mapa, em qualquer aparelho.

/**
 * Classifica uma música em um dos 4 arquétipos a partir de 3 sinais da análise:
 *
 *   ENERGIA  (RMS médio 0..1, normalizado internamente) → quão "cheia" é a música?
 *   AGITAÇÃO (batidas reais por segundo)                → quão percussiva/apressada ela é?
 *   BRILHO   (centroide espectral médio 0..1)           → grave e escura x clara e cristalina?
 *
 * Agitação e brilho cruzam em 4 quadrantes:
 *
 *        | brilho baixo (escura)      | brilho alto (cristalina)
 * -------|----------------------------|---------------------------
 *  alta  | FURIA (trap/metal/phonk)   | GLITCH (drum&bass/complextro)
 *  baixa | NOTURNO (lo-fi/bossa/jazz) | LUNA (balada/synthwave/romântica)
 *
 * ENERGIA abaixo de um piso (músicas muito "limpas/sintéticas", ex.: demo interna)
 * puxa para LUNA e evita classificar FURIA/GLITCH por engano.
 */
export function classifyMood(analysis) {
  const onsets = analysis.onsets || [];
  const frames = analysis.frames || {};
  const durationSec = analysis.durationSec || 1;

  const rmsAvg = avg(frames.rms);
  const centroidAvg = avg(frames.centroid);
  const onsetRate = onsets.length / Math.max(1, durationSec); // batidas/s

  const intensity = (rmsAvg + Math.min(1, onsetRate / 6)) / 2; // 0..1 composto
  const agitada = intensity >= 0.55;
  const brilhante = centroidAvg >= 0.46;

  if (rmsAvg > 0 && rmsAvg < 0.25) return 'luna'; // mix limpa/sintética → nunca é fúria
  if (!agitada) return brilhante ? 'luna' : 'noturno';
  return brilhante ? 'glitch' : 'furia';
}

/**
 * Força "pesada" composta 0..1: dentre as músicas de MESMA classe (ex.: trap e
 * metal, ambas FÚRIA), é isso que decide qual é MAIS BRUTA — usada pelo cenário
 * para afinar a intensidade do fogo/lasers/estrelas.
 */
export function moodStrength(analysis) {
  const frames = analysis.frames || {};
  const onsets = analysis.onsets || [];
  const durationSec = Math.max(1, analysis.durationSec || 1);
  const rmsAvg = avg(frames.rms);
  const onsetRate = onsets.length / durationSec;
  return Math.min(1, Math.max(0, (rmsAvg + Math.min(1, onsetRate / 6)) / 2));
}

/**
 * Afina o gerador por arquétipo — todos os ajustes são multiplicadores/vieses
 * (nunca regras novas probabilísticas), então a fase segue 100% determinística
 * para a mesma análise + mesma seed, e continua obedecendo às regras musicais
 * v2 (impacto de drop, respiro de frase, rampa de build, moedas melódicas...).
 */
export const MOOD_TUNING = {
  furia: {
    // ATENÇÃO: densityMul multiplica o INTERVALO entre padrões (1 = a cada batida).
    // Valor MENOR = mais intervalos colados = mais obstáculos. Valor MAIOR = mais ar.
    densityMul: 0.6, // drop fica 1 (mín.), build 2→1, flow 3→2 — não perdoa // sempre apertada — é o arquétipo da pressão constante
    silenceChance: 0.15, // descansa quase nada (fúria não perdoa)
    coinBias: 0.8, // menos moedas, mais sangue
    swellRampFrac: 0.35, // build junta CEDO (rampa chega ao pico mais rápido)
    typeBias: { spike: +0.3, block: +0.3, orb: -0.3, pad: -0.2, shield: -0.05 },
    patternBias: { double: +0.4, single: -0.3 }, // pulsos rápidos em sequência
    glowBoost: 1.2,
  },
  glitch: {
    densityMul: 0.75, // flow 3→2 (Math.round(2.25)), build 2→2, drop 1
    silenceChance: 0.35,
    coinBias: 1.0,
    swellRampFrac: 0.45,
    typeBias: { orb: +0.35, pad: +0.2, block: -0.2, spike: -0.15, shield: +0.05 }, // joga no ar!
    patternBias: { double: +0.3, blockSpike: +0.15, single: -0.2 },
    glowBoost: 1.35, // eletrônico = neon estourado
  },
  noturno: {
    densityMul: 1.45, // flow 3→4, build 2→3, drop 1 (a música respira) // bem espaçada — deixa a música respirar
    silenceChance: 0.7, // silêncio vira abraço
    coinBias: 1.5, // chuva de moedas melódicas
    coinStrengthMin: 0.45, // acentos mais suaves já viram moeda
    melodicStrengthMin: 0.4,
    coinGapMul: 0.7, // permite moedas mais juntinhas
    swellRampFrac: 0.6,
    typeBias: { pad: +0.3, orb: +0.15, shield: +0.15, spike: -0.25, block: -0.3 },
    patternBias: { single: +0.2, double: -0.5 }, // quase sem dupla apertada
    glowBoost: 0.85, // suave
  },
  luna: {
    densityMul: 1.25, // flow 3→4, build 2→3, drop 1
    silenceChance: 0.5,
    coinBias: 1.3,
    coinStrengthMin: 0.5,
    melodicStrengthMin: 0.5,
    coinGapMul: 0.85,
    swellRampFrac: 0.55,
    typeBias: { orb: +0.2, pad: +0.15, shield: +0.1, spike: -0.2, block: -0.15 },
    patternBias: { single: +0.1, double: -0.2 },
    glowBoost: 1.1,
  },
};

/** Identidade visual do cenário por arquétipo (o renderer consome). */
export const MOOD_VISUALS = {
  furia: {
    label: 'Fúria',
    emoji: '🔥',
    desc: 'trap / metal / phonk — fogo e pressão',
    sun: ['#8a0f12', '#e84817', '#ffb347'], // língua de fogo
    sunHalo: '255, 60, 20',
    skyMid: '#1c0408',
    particle: 'ember', // faíscas subindo
    tint: '#ff6a3d',
    mtnA: '#39100f',
    mtnB: '#20060a',
  },
  glitch: {
    label: 'Glitch',
    emoji: '⚡',
    desc: 'drum&bass / complextro — lasers e neon',
    sun: ['#2ef2ff', '#8a5cff', '#ff4dd8'], // anel eletrônico
    sunHalo: '46, 242, 255',
    skyMid: '#0e0a2e',
    particle: 'laser', // riscos diagonais rápidos
    tint: '#2ef2ff',
    mtnA: '#1c1450',
    mtnB: '#120c38',
  },
  noturno: {
    label: 'Noturno',
    emoji: '🌙',
    desc: 'lo-fi / bossa / jazz — madrugada estrelada',
    sun: ['#8fb8e8', '#5c7fbf', '#374a75'], // lua cheia
    sunHalo: '200, 220, 255',
    skyMid: '#060a1c',
    particle: 'star', // estrelas brilhando mais fortes
    tint: '#9fc8ff',
    mtnA: '#0d1630',
    mtnB: '#080e22',
  },
  luna: {
    label: 'Luna',
    emoji: '💫',
    desc: 'balada / synthwave romântica — hora dourada eterna',
    sun: ['#ffe9a8', '#ff9e7a', '#c96aa8'],
    sunHalo: '255, 190, 130',
    skyMid: '#231029',
    particle: 'firefly', // vagalumes à deriva
    tint: '#ffcf9e',
    mtnA: '#3a1c38',
    mtnB: '#241026',
  },
};

// Quantidade de partículas ambientes por quadro (padrão por tipo).
export const PARTICLE_COUNTS = { ember: 22, laser: 14, star: 26, firefly: 12 };

/** Paleta de cores da faixa SONORA pra cada arquétipo — aplica sobre as seções
 * durante o jogo (exceto quando o usuário escolheu um tema visual específico,
 * que tem prioridade e substitui tudo, como antes). */
export const MOOD_SECTION_COLORS = {
  furia: {
    intro: ['#5c0f12', '#ff7a5c'],
    build: ['#7d1415', '#ff9a6b'],
    pre: ['#a02010', '#ffb37a'],
    drop: ['#e03218', '#ff8a5c'], // fogo no máximo na faixa intensa
    break: ['#3d0d10', '#c96a5c'],
    outro: ['#7a2a18', '#ffc49b'],
    flow: ['#8a1a12', '#ff9a6b'],
  },
  glitch: {
    intro: ['#3f29c7', '#9d8bff'],
    build: ['#2447e0', '#7aa3ff'],
    pre: ['#c724c7', '#ff7afc'],
    drop: ['#19d3d3', '#87f9ff'], // ciano elétrico irado
    break: ['#1d2566', '#7688e6'],
    outro: ['#6a3de6', '#b9a3ff'],
    flow: ['#3f29c7', '#9d8bff'],
  },
  noturno: {
    intro: ['#1e2d59', '#7a90c9'],
    build: ['#27386e', '#8aa3de'],
    pre: ['#3a4a8c', '#a8bfff'],
    drop: ['#4a5fa8', '#b8cfff'], // lua cheia na parte intensa
    break: ['#121b3d', '#5c6c9e'],
    outro: ['#2e4170', '#9fb4ea'],
    flow: ['#1e2d59', '#7a90c9'],
  },
  luna: {
    intro: ['#c96a5c', '#ffc9a8'],
    build: ['#e87a5c', '#ffcf9e'],
    pre: ['#ff9a6b', '#ffe0b8'],
    drop: ['#ff7a9e', '#ffc9d4'], // rosa hora dourada explode
    break: ['#a34a6e', '#e8a3c9'],
    outro: ['#d68a5c', '#ffddab'],
    flow: ['#c96a5c', '#ffc9a8'],
  },
};

/** Recolor as seções do nível pela paleta do arquétipo (mantém tudo mais).
 * Obtém cor/glow do arquétipo específico; para 'flow' usa o próprio (clássico).
 * Usada quando o tema visual está em 'auto'. */
export function applyArchetypePalette(sections, moodKey) {
  const palette = MOOD_SECTION_COLORS[moodKey];
  if (!palette) return sections;
  return sections.map((s) => {
    const pair = palette[s.label] || palette.flow;
    return { ...s, color: pair[0], glow: pair[1] };
  });
}

const MOOD_NAMES = Object.keys(MOOD_TUNING);
export function getArchetype(analysis) {
  const key = classifyMood(analysis);
  const v = MOOD_VISUALS[key];
  return { key, label: v.label, emoji: v.emoji, desc: v.desc, tuning: MOOD_TUNING[key], visuals: v };
}

export function isValidMood(key) {
  return MOOD_NAMES.includes(key);
}

// Tunagem "neutra" exatamente igual ao comportamento clássico do gerador,
// usada quando a análise chega SEM dados de sinal (fixtures/edge cases):
// comportamento idêntico ao de antes dos arquétipos, sempre.
export const IDENTITY_TUNING = {
  densityMul: 1,
  silenceChance: 0.55,
  swellRampFrac: 0.55,
  coinBias: 1,
  coinStrengthMin: 0.5, // p/ arco de acento
  melodicStrengthMin: 0.55, // p/ moeda na parte calma
  coinGapMul: 1,
  typeBias: {},
  patternBias: {},
};

/** Tunagem efetiva para uma análise — neutra se não houver sinal de áudio. */
export function tuningFor(analysis) {
  const hasSignal =
    (analysis.onsets && analysis.onsets.length > 0) ||
    (analysis.frames && (analysis.frames.rms?.length || 0) > 2);
  if (!hasSignal) return IDENTITY_TUNING;
  return { ...IDENTITY_TUNING, ...MOOD_TUNING[classifyMood(analysis)] };
}

function avg(arr) {
  if (!arr || !arr.length) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}
