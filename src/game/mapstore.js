// Editor de mapas + temas visuais por música: lógica pura e testável.
// Um "mapa" personalizado é a lista de obstáculos/coletáveis ancorados em
// MEIAS-BATIDAS (índice int — compacto para salvar e para o link de compartilhar),
// mais o tema visual. As conversões para o nível jogável ficam aqui.

const STORAGE_KEY = 'rhythm-dash-maps-v1';

/** Tipos de obstáculo editáveis e seus códigos de 1 letra (para o link). */
export const OBSTACLE_TYPES = ['spike', 'block', 'pad', 'orb', 'shield'];
const TYPE_CODE = { spike: 's', block: 'b', pad: 'p', orb: 'o', shield: 'h' };
const CODE_TYPE = Object.fromEntries(Object.entries(TYPE_CODE).map(([k, v]) => [v, k]));

/** Segundos por meia-batida (a grade do editor). */
export function halfBeatSec(bpm) {
  return 30 / bpm;
}

/** Encaixa um tempo na grade de meias-batidas. */
export function snapToGrid(time, bpm) {
  const h = halfBeatSec(bpm);
  return Math.round(time / h) * h;
}

/** Nível jogável → mapa editável (índices de meia-batida). */
export function mapFromLevel(level) {
  const h = halfBeatSec(level.bpm);
  return {
    bpm: level.bpm,
    obstacles: level.obstacles
      .map((o) => [Math.round(o.time / h), o.type])
      .filter(([, t]) => OBSTACLE_TYPES.includes(t)),
    collectibles: level.collectibles.map((c) => Math.round(c.time / h)),
  };
}

function sectionAt(sections, time) {
  for (const s of sections) {
    if (time < s.end) return s;
  }
  return sections[sections.length - 1] || null;
}

/**
 * Mapa editável → nível jogável: reconstrói obstáculos/coletáveis com ids novos
 * e cores da seção (aplicando o tema, se houver). O restante do nível é mantido.
 */
export function applyMapToLevel(level, data) {
  const bpm = data.bpm || level.bpm;
  const h = halfBeatSec(bpm);
  const sections =
    data.theme && data.theme !== 'auto' ? applyThemeToSections(level.sections, data.theme) : level.sections;

  const obstacles = (data.obstacles || [])
    .filter(([idx, type]) => Number.isFinite(idx) && OBSTACLE_TYPES.includes(type))
    .map(([idx, type], i) => {
      const time = idx * h;
      const s = sectionAt(sections, time) || { label: 'flow', color: '#7c5cff', glow: '#b39dff' };
      return { id: `ob_e_${i}`, type, time, section: s.label, color: s.color, glow: s.glow };
    })
    .filter((o) => o.time <= level.durationSec)
    .sort((a, b) => a.time - b.time);

  const collectibles = (data.collectibles || [])
    .filter((idx) => Number.isFinite(idx))
    .map((idx, i) => {
      const time = idx * h;
      const s = sectionAt(sections, time) || { label: 'flow' };
      return { id: `col_e_${i}`, time, section: s.label };
    })
    .filter((c) => c.time <= level.durationSec)
    .sort((a, b) => a.time - b.time);

  return { ...level, sections, obstacles, collectibles };
}

/** Codifica o mapa numa string compacta e segura para URL (base64url do JSON). */
export function encodeMap(data) {
  const payload = {
    v: 1,
    b: data.bpm,
    th: data.theme || 'auto',
    o: data.obstacles.map(([idx, type]) => [idx, TYPE_CODE[type]]),
    c: data.collectibles,
  };
  const json = JSON.stringify(payload);
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decodifica o link. Retorna null se inválido/corrompido. */
export function decodeMap(str) {
  try {
    const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64));
    if (payload?.v !== 1 || !Number.isFinite(payload.b) || !Array.isArray(payload.o)) return null;
    return {
      bpm: payload.b,
      theme: typeof payload.th === 'string' ? payload.th : 'auto',
      obstacles: payload.o
        .filter(([idx, code]) => Number.isFinite(idx) && CODE_TYPE[code])
        .map(([idx, code]) => [idx, CODE_TYPE[code]]),
      collectibles: Array.isArray(payload.c) ? payload.c.filter((n) => Number.isFinite(n)) : [],
    };
  } catch {
    return null;
  }
}

// ---------- Persistência por música (localStorage) ----------

export function loadMaps(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') return obj;
    }
  } catch {
    /* storage indisponível */
  }
  return {};
}

export function saveMapFor(key, data, storage = globalThis.localStorage, now = Date.now()) {
  try {
    const all = loadMaps(storage);
    all[key] = { ...data, updatedAt: now };
    storage?.setItem(STORAGE_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

export function loadMapFor(key, storage = globalThis.localStorage) {
  const m = loadMaps(storage)[key];
  return m ? { bpm: m.bpm, theme: m.theme, obstacles: m.obstacles, collectibles: m.collectibles } : null;
}

export function deleteMapFor(key, storage = globalThis.localStorage) {
  try {
    const all = loadMaps(storage);
    if (!(key in all)) return false;
    delete all[key];
    storage?.setItem(STORAGE_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

// ---------- Temas visuais (personalização por tipo de música) ----------

/**
 * Cada tema define [color, glow] por seção musical; a paleta recolore fundo,
 * chão, linha de hit e obstáculos (o renderer já lê section.color/glow).
 * 'auto' = cores originais da análise do áudio (sem override).
 */
export const THEMES = {
  neon: {
    intro: ['#7c5cff', '#b39dff'],
    build: ['#4d9fff', '#9fd0ff'],
    pre: ['#ff4dd8', '#ff9ae4'],
    drop: ['#4dffea', '#b6fff4'],
    break: ['#3d4787', '#8891d1'],
    outro: ['#ffd166', '#ffe6a8'],
    flow: ['#7c5cff', '#b39dff'],
  },
  sunset: {
    intro: ['#ff9a4d', '#ffd3ad'],
    build: ['#ff5d8f', '#ffa3c2'],
    pre: ['#ffd166', '#ffe6a8'],
    drop: ['#ff6b3d', '#ffb08f'],
    break: ['#7a4d8f', '#c39bd8'],
    outro: ['#ffe27a', '#fff3c2'],
    flow: ['#ff8f6b', '#ffcbb8'],
  },
  ocean: {
    intro: ['#2ec4ff', '#a4e5ff'],
    build: ['#3ddad7', '#a5f2ef'],
    pre: ['#4dffb8', '#b2ffdf'],
    drop: ['#4dffea', '#b6fff4'],
    break: ['#2a5d8f', '#7fa8c9'],
    outro: ['#9fb7ff', '#d4deff'],
    flow: ['#3db6ff', '#a8e0ff'],
  },
  vulcao: {
    intro: ['#ff4d2e', '#ff9d85'],
    build: ['#ff8f3d', '#ffc79e'],
    pre: ['#ffd166', '#ffe6a8'],
    drop: ['#ffdd3d', '#fff0a8'],
    break: ['#8f2a3d', '#c97f8f'],
    outro: ['#ff6b4d', '#ffb3a1'],
    flow: ['#ff5d3d', '#ffae99'],
  },
  matrix: {
    intro: ['#4dff88', '#b0ffcd'],
    build: ['#22cc66', '#8aebb2'],
    pre: ['#baffd1', '#e4ffee'],
    drop: ['#6bff5e', '#c4ffb8'],
    break: ['#1f7a4d', '#6bb894'],
    outro: ['#d1ffd1', '#eefeee'],
    flow: ['#3dd67a', '#a2efc3'],
  },
};

export const THEME_NAMES = ['auto', ...Object.keys(THEMES)];

/** Recolore as seções com a paleta do tema ('auto'/desconhecido = mantém original). */
export function applyThemeToSections(sections, themeName) {
  const pal = THEMES[themeName];
  if (!pal) return sections;
  return sections.map((s) => {
    const [color, glow] = pal[s.label] || pal.flow;
    return { ...s, color, glow };
  });
}
