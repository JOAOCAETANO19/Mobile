import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, THEME_NAMES, applyThemeToSections, getThemeName, setThemeName } from '../src/game/themes.js';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

const sections = [
  { label: 'intro', start: 0, end: 4, color: '#111', glow: '#222' },
  { label: 'drop', start: 4, end: 8, color: '#333', glow: '#444' },
  { label: 'flow', start: 8, end: 12, color: '#555', glow: '#666' },
];

test('tema recolore as seções pela paleta, mantendo estrutura', () => {
  const out = applyThemeToSections(sections, 'sunset');
  assert.equal(out[0].color, THEMES.sunset.intro[0]);
  assert.equal(out[0].glow, THEMES.sunset.intro[1]);
  assert.equal(out[1].color, THEMES.sunset.drop[0]);
  assert.equal(out[0].start, 0); // estrutura intacta
  assert.equal(out[2].label, 'flow');
});

test("'auto' / tema desconhecido mantém as seções originais", () => {
  assert.equal(applyThemeToSections(sections, 'auto'), sections);
  assert.equal(applyThemeToSections(sections, 'nao-existe'), sections);
});

test('seção sem entrada na paleta usa o fallback "flow"', () => {
  const out = applyThemeToSections([{ label: 'solo', start: 0, end: 1 }], 'matrix');
  assert.equal(out[0].color, THEMES.matrix.flow[0]);
});

test('preferência de tema persiste e valida valores', () => {
  const storage = fakeStorage();
  assert.equal(getThemeName(storage), 'auto'); // padrão
  setThemeName('vulcao', storage);
  assert.equal(getThemeName(storage), 'vulcao');
  setThemeName('hack', storage); // inválido → volta para auto
  assert.equal(getThemeName(storage), 'auto');
  assert.ok(THEME_NAMES.includes('auto'));
});
