// Temas visuais: paletas por seção musical que recolorem cenário, chão, linha de
// hit e obstáculos (o renderer já lê section.color/glow). 'auto' = cores que a
// própria análise do áudio escolheu (sinestesia via centroide espectral).
//
// Escolha nas ⚙️ configurações da tela inicial — vale para qualquer música.

const STORAGE_KEY = 'rhythm-dash-theme';

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
    drop: ['#ff7847', '#ffb38f'],
    break: ['#7d4a6f', '#c490b5'],
    outro: ['#ffcf5c', '#ffe9ae'],
    flow: ['#ff9a4d', '#ffd3ad'],
  },
  ocean: {
    intro: ['#4dd6ff', '#a8ecff'],
    build: ['#4da3ff', '#a3ccff'],
    pre: ['#6dffcf', '#b8ffe6'],
    drop: ['#57ffb0', '#b8ffdd'],
    break: ['#2e4a7a', '#7a90bd'],
    outro: ['#7de3ff', '#c6f3ff'],
    flow: ['#4dd6ff', '#a8ecff'],
  },
  vulcao: {
    intro: ['#ff5c5c', '#ffa3a3'],
    build: ['#ff8a3d', '#ffc29e'],
    pre: ['#ffd166', '#ffe6a8'],
    drop: ['#ff3d3d', '#ff9e9e'],
    break: ['#6e2f2f', '#b57777'],
    outro: ['#ffb03d', '#ffdba8'],
    flow: ['#ff5c5c', '#ffa3a3'],
  },
  matrix: {
    intro: ['#39ff6e', '#a3ffc2'],
    build: ['#2ee6a8', '#9ef5d8'],
    pre: ['#d4ff5c', '#ecffad'],
    drop: ['#57ff57', '#b8ffb8'],
    break: ['#1f5c38', '#5c9e77'],
    outro: ['#a8ff4d', '#d8ffa8'],
    flow: ['#39ff6e', '#a3ffc2'],
  },
};

export const THEME_NAMES = ['auto', ...Object.keys(THEMES)];

/**
 * Aplica a paleta do tema às seções da música (mantém tempos/labels).
 * Tema 'auto' ou desconhecido → seções originais (cores da análise).
 */
export function applyThemeToSections(sections, themeName) {
  const t = THEMES[themeName];
  if (!t) return sections;
  return sections.map((s) => {
    const [color, glow] = t[s.label] || t.flow;
    return { ...s, color, glow };
  });
}

export function getThemeName(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try {
    const v = storage?.getItem(STORAGE_KEY);
    return THEME_NAMES.includes(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function setThemeName(name, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  const v = THEMES[name] ? name : 'auto';
  try {
    storage?.setItem(STORAGE_KEY, v);
  } catch {
    /* sem storage disponível */
  }
  return v;
}
