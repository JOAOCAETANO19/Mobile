// Editor de mapas: linha do tempo da música em Canvas 2D — seções coloridas,
// grade de meias-batidas, toque adiciona (com snap), toque no obstáculo apaga,
// arrastar rola a linha. O editor trabalha com o formato compacto de mapstore.

import { OBSTACLE_TYPES, THEMES, applyThemeToSections, halfBeatSec } from '../game/mapstore.js';

const PX_PER_BEAT = 26; // zoom horizontal
const GROUND_Y = 148;
const CANVAS_H = 190;
const TAP_DRAG_TOLERANCE = 8; // px: abaixo disso é toque, acima é rolagem

const TOOL_GLYPH = {
  spike: { color: '#ff5d8f', shape: 'tri' },
  block: { color: '#a37dff', shape: 'rect' },
  pad: { color: '#ffd166', shape: 'pad' },
  orb: { color: '#4d9fff', shape: 'circle' },
  shield: { color: '#4dff88', shape: 'ring' },
  coin: { color: '#4dffea', shape: 'diamond' },
};

export class MapEditor {
  /**
   * @param {HTMLElement} root seção #screen-editor
   * @param {{onClose,onTest,onSave,onShare,onResetAuto,onDeleteSaved}} callbacks
   */
  constructor(root, callbacks) {
    this.root = root;
    this.cb = callbacks;
    this.canvas = root.querySelector('#editor-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.meta = null; // {bpm, durationSec, beats, sections, physics}
    this.state = null; // {obstacles:[[idx,type]], collectibles:[idx], theme, tool, scrollPx}
    this._ptr = null;

    root.querySelector('#editor-close')?.addEventListener('click', () => this.cb.onClose?.());
    root.querySelector('#editor-test')?.addEventListener('click', () => this.cb.onTest?.(this.buildMapData()));
    root.querySelector('#editor-save')?.addEventListener('click', () => this.cb.onSave?.(this.buildMapData()));
    root.querySelector('#editor-share')?.addEventListener('click', () => this.cb.onShare?.(this.buildMapData()));
    root.querySelector('#editor-reset')?.addEventListener('click', () => this.cb.onResetAuto?.());
    root.querySelector('#editor-theme')?.addEventListener('change', (e) => {
      if (this.state) this.state.theme = e.target.value;
      this.render();
    });
    root.querySelector('#editor-tools')?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-tool]');
      if (!btn || !this.state) return;
      this.state.tool = btn.dataset.tool;
      this.root.querySelectorAll('#editor-tools button').forEach((b) => b.classList.toggle('active', b === btn));
    });

    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onUp(e));
    this.canvas.addEventListener('pointercancel', () => { this._ptr = null; });
  }

  /**
   * Abre o editor com os dados do nível atual.
   * @param {object} meta {bpm, durationSec, beats, sections, physics}
   * @param {object} map formato mapstore {obstacles, collectibles, theme?}
   * @param {string} title título da música
   */
  open(meta, map, title) {
    this.meta = meta;
    this.state = {
      obstacles: map.obstacles.map(([i, t]) => [i, t]),
      collectibles: [...map.collectibles],
      theme: map.theme || 'auto',
      tool: 'spike',
      scrollPx: 0,
    };
    const themeSel = this.root.querySelector('#editor-theme');
    if (themeSel) themeSel.value = THEMES[this.state.theme] ? this.state.theme : 'auto';
    const titleEl = this.root.querySelector('#editor-title');
    if (titleEl) titleEl.textContent = `🛠️ Editor — ${title || 'música'}`;
    this.root.querySelectorAll('#editor-tools button').forEach((b) => b.classList.toggle('active', b.dataset.tool === 'spike'));
    this.resize();
    this.render();
  }

  /** Mapa atual no formato mapstore (bpm + tema + índices de meia-batida). */
  buildMapData() {
    const s = this.state;
    return {
      bpm: this.meta.bpm,
      theme: s.theme,
      obstacles: [...s.obstacles].sort((a, b) => a[0] - b[0]),
      collectibles: [...s.collectibles].sort((a, b) => a - b),
    };
  }

  /** Recarrega o conteúdo (ex.: "↺ Refazer auto"). */
  setMap(map) {
    this.state.obstacles = map.obstacles.map(([i, t]) => [i, t]);
    this.state.collectibles = [...map.collectibles];
    if (map.theme) this.state.theme = map.theme;
    this.state.scrollPx = 0;
    this.render();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth || this.canvas.parentElement.clientWidth || 600;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = CANVAS_H * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.viewW = w;
    this.pxPerSec = PX_PER_BEAT / this.meta.physics.T;
  }

  contentWidth() {
    return this.meta.durationSec * this.pxPerSec;
  }

  hIdx() { return halfBeatSec(this.meta.bpm); } // segundos por 1 índice

  timeToX(time) { return time * this.pxPerSec - this.state.scrollPx; }

  // ---------- Interação ----------

  onDown(e) {
    if (!this.state) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    this._ptr = { x: e.offsetX, y: e.offsetY, scroll0: this.state.scrollPx, moved: false };
  }

  onMove(e) {
    if (!this._ptr || !this.state) return;
    const dx = e.offsetX - this._ptr.x;
    if (!this._ptr.moved && Math.abs(dx) > TAP_DRAG_TOLERANCE) this._ptr.moved = true;
    if (this._ptr.moved) {
      const max = Math.max(0, this.contentWidth() - this.viewW);
      this.state.scrollPx = Math.min(max, Math.max(0, this._ptr.scroll0 - dx));
      this.render();
    }
  }

  onUp(e) {
    if (!this._ptr || !this.state) { this._ptr = null; return; }
    const wasDrag = this._ptr.moved;
    this._ptr = null;
    if (wasDrag) return;

    // Toque: converte para grade de meia-batida e adiciona/remove.
    const worldX = e.offsetX + this.state.scrollPx;
    const time = worldX / this.pxPerSec;
    const h = this.hIdx();
    const idx = Math.round(time / h);
    if (idx < 0 || idx * h > this.meta.durationSec) return;

    const s = this.state;
    if (s.tool === 'coin') {
      const i = s.collectibles.indexOf(idx);
      if (i >= 0) s.collectibles.splice(i, 1);
      else s.collectibles.push(idx);
    } else {
      const i = s.obstacles.findIndex(([oi]) => oi === idx);
      if (i >= 0) s.obstacles.splice(i, 1);
      else if (OBSTACLE_TYPES.includes(s.tool)) s.obstacles.push([idx, s.tool]);
    }
    this.cb.onEdit?.(this.buildMapData());
    this.render();
  }

  // ---------- Desenho ----------

  render() {
    const { ctx, meta, state } = this;
    if (!meta || !state) return;
    const W = this.viewW || this.canvas.clientWidth || 600;

    ctx.clearRect(0, 0, W, CANVAS_H);
    ctx.fillStyle = '#0a0618';
    ctx.fillRect(0, 0, W, CANVAS_H);

    // Faixas das seções (BUILD/DROP…) — já com o tema escolhido aplicado.
    const sections = state.theme !== 'auto' ? applyThemeToSections(meta.sections, state.theme) : meta.sections;
    for (const s of sections) {
      const x0 = this.timeToX(s.start);
      const x1 = this.timeToX(s.end);
      if (x1 < 0 || x0 > W) continue;
      ctx.fillStyle = hexA(s.color || '#7c5cff', s.label === 'drop' ? 0.26 : 0.16);
      ctx.fillRect(Math.max(0, x0), 0, x1 - x0, CANVAS_H);
      ctx.fillStyle = hexA('#ffffff', 0.5);
      ctx.font = '600 10px "Space Grotesk", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(String(s.label || '').toUpperCase(), Math.max(4, x0 + 5), 14);
    }

    // Grade: meias-batidas (bem fraquinhas) e batidas.
    const h = this.hIdx();
    const beatT = meta.physics.T;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let idx = 0; idx * h <= meta.durationSec; idx++) {
      const x = this.timeToX(idx * h);
      if (x < 0 || x > W) continue;
      if (idx % 2 !== 0) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_H);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    for (const b of meta.beats) {
      const x = this.timeToX(b.time);
      if (x < 0 || x > W) continue;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_H);
      ctx.stroke();
    }

    // Chão.
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    ctx.lineTo(W, GROUND_Y);
    ctx.stroke();

    // Coletáveis (diamantes) um pouco acima do chão.
    for (const idx of state.collectibles) {
      const x = this.timeToX(idx * h);
      if (x < -10 || x > W + 10) continue;
      drawGlyph(ctx, 'coin', x, GROUND_Y - 34);
    }
    // Obstáculos no chão.
    for (const [idx, type] of state.obstacles) {
      const x = this.timeToX(idx * h);
      if (x < -12 || x > W + 12) continue;
      drawGlyph(ctx, type, x, GROUND_Y - 12);
    }

    // Barra de rolagem (indicador).
    const total = this.contentWidth();
    if (total > W) {
      const barW = Math.max(30, (W / total) * W);
      const barX = (state.scrollPx / (total - W)) * (W - barW);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(barX, CANVAS_H - 6, barW, 3);
    }
  }
}

function drawGlyph(ctx, type, x, y) {
  const g = TOOL_GLYPH[type] || TOOL_GLYPH.spike;
  ctx.save();
  ctx.fillStyle = g.color;
  ctx.strokeStyle = g.color;
  ctx.lineWidth = 2;
  if (g.shape === 'tri') {
    ctx.beginPath();
    ctx.moveTo(x - 7, y + 6);
    ctx.lineTo(x, y - 8);
    ctx.lineTo(x + 7, y + 6);
    ctx.closePath();
    ctx.fill();
  } else if (g.shape === 'rect') {
    ctx.fillRect(x - 6, y - 8, 12, 14);
  } else if (g.shape === 'pad') {
    ctx.fillRect(x - 8, y + 1, 16, 5);
  } else if (g.shape === 'circle') {
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
  } else if (g.shape === 'ring') {
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (g.shape === 'diamond') {
    ctx.beginPath();
    ctx.moveTo(x, y - 7);
    ctx.lineTo(x + 6, y);
    ctx.lineTo(x, y + 7);
    ctx.lineTo(x - 6, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** '#rrggbb' + alfa → rgba() */
function hexA(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return `rgba(124,92,255,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
