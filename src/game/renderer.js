// Renderer Canvas 2D — palco synthwave adaptado à música:
// paleta espectral por seção, montanhas e cidade procedural em parallax, pista em
// perspectiva, pickups facetados, obstáculos 3D com brilho/acento e HUD translúcido.

import { PLAYER_SCREEN_X_RATIO } from './engine.js';

const SCORE_FORMATTER = new Intl.NumberFormat('pt-BR');

function sectionHue(section) {
  if (Number.isFinite(section?.hue)) return ((section.hue % 360) + 360) % 360;
  const match = /hsl\(\s*(\d+(?:\.\d+)?)/i.exec(section?.color || '');
  return match ? Number(match[1]) : 260;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function seededNoise(value, salt = 0) {
  let hash = (Math.imul(value | 0, 374761393) + Math.imul(salt | 0, 668265263)) | 0;
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cellPx = 64; // tamanho de 1 célula em pixels (ajustado no resize)
    this.shakeAmp = 0;
    this.shakeDur = 1;
    this.shakeT = 0;
    this._shakeX = 0;
    this._shakeY = 0;
    this.resize();
  }

  resize() {
    const canvas = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.widthCss = rect.width;
    this.heightCss = rect.height;
    const safeArea = typeof getComputedStyle === 'function' ? getComputedStyle(canvas) : null;
    this.safeTop = parseFloat(safeArea?.getPropertyValue('--game-safe-top')) || 0;
    this.safeRight = parseFloat(safeArea?.getPropertyValue('--game-safe-right')) || 0;
    this.cellPx = rect.height / 6; // 6 células de altura visível
    this.widthCells = this.widthCss / this.cellPx;
  }

  clear(bgColor) {
    const { ctx, widthCss, heightCss } = this;
    ctx.fillStyle = bgColor || '#06030f';
    ctx.fillRect(0, 0, widthCss, heightCss);
  }

  horizonY() {
    return this.heightCss * 0.6;
  }

  groundY() {
    return this.heightCss - this.cellPx * 1.2;
  }

  worldToScreenX(screenXCells) {
    return screenXCells * this.cellPx;
  }

  // ---------- Screen shake (leve/médio/forte) ----------

  shake(intensity = 'light') {
    const amps = { light: 5, medium: 12, strong: 22 };
    const amp = (amps[intensity] ?? 8) * (this.cellPx / 64);
    const dur = intensity === 'strong' ? 0.6 : 0.35;
    if (amp >= this.shakeAmp * (this.shakeT / this.shakeDur || 0)) {
      this.shakeAmp = amp;
      this.shakeDur = dur;
      this.shakeT = dur;
    }
  }

  updateShake(dt) {
    if (this.shakeT > 0) this.shakeT = Math.max(0, this.shakeT - dt);
  }

  beginScene() {
    const k = this.shakeT > 0 ? this.shakeAmp * (this.shakeT / this.shakeDur) : 0;
    this._shakeX = (Math.random() * 2 - 1) * k;
    this._shakeY = (Math.random() * 2 - 1) * k;
    this.ctx.save();
    this.ctx.translate(this._shakeX, this._shakeY);
  }

  endScene() {
    this.ctx.restore();
  }

  // ---------- Fundo synthwave ----------

  drawBackground(section, beatPulse, time, worldX) {
    const { ctx, widthCss } = this;
    const horizonY = this.horizonY();
    const hue = sectionHue(section);
    const color = section?.color || `hsl(${hue},70%,45%)`;
    const glow = section?.glow || `hsl(${hue},80%,65%)`;
    const intensity = clamp01(section?.intensity ?? section?.energy ?? 0.5);
    const secondaryHue = (hue + 34) % 360;

    // O ambiente muda com a cor e a energia da seção, não fica preso a um fundo único.
    const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
    sky.addColorStop(0, '#05040d');
    sky.addColorStop(0.56, `hsl(${hue}, 58%, ${8 + intensity * 5}%)`);
    sky.addColorStop(1, shade(color, -36));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, widthCss, horizonY + 1);

    // Estrelas em camadas, com cintilação determinística e brilho sutil no drop.
    ctx.save();
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 54; i++) {
      const sx = (((i * 733) % 997) / 997) * widthCss;
      const sy = (((i * 419) % 991) / 991) * horizonY * 0.72;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin((time || 0) * 0.8 + i * 1.7));
      ctx.globalAlpha = (0.1 + 0.35 * tw) * (0.7 + intensity * 0.45);
      const size = i % 9 === 0 ? 2.4 : 1.3;
      ctx.fillRect(sx, sy, size, size);
    }
    ctx.restore();

    // Sol/portal do palco: sua paleta acompanha o tema espectral da faixa.
    const cx = widthCss * 0.63;
    const cy = horizonY - this.cellPx * 0.85;
    const R = this.cellPx * (1.22 + intensity * 0.18) * (1 + 0.07 * beatPulse);

    ctx.save();
    const halo = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, R * 2.1);
    halo.addColorStop(0, `hsla(${secondaryHue}, 96%, 66%, ${0.16 + 0.28 * beatPulse})`);
    halo.addColorStop(1, `hsla(${secondaryHue}, 96%, 55%, 0)`);
    ctx.fillStyle = halo;
    ctx.fillRect(cx - R * 2.2, cy - R * 2.2, R * 4.4, R * 4.4);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    const sun = ctx.createLinearGradient(0, cy - R, 0, cy + R);
    sun.addColorStop(0, `hsl(${(secondaryHue + 25) % 360}, 98%, 78%)`);
    sun.addColorStop(0.52, `hsl(${secondaryHue}, 92%, 59%)`);
    sun.addColorStop(1, `hsl(${(hue + 325) % 360}, 88%, 48%)`);
    ctx.fillStyle = sun;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    // Listras synthwave clássicas, sincronizadas e dimensionadas para a tela.
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 6; i++) {
      const bandY = cy + R * (0.06 + i * 0.155);
      const bandH = (2 + i * 2.1) * (this.cellPx / 64);
      ctx.fillRect(cx - R, bandY, R * 2, bandH);
    }
    ctx.restore();

    // Montanhas e arquitetura em parallax criam camadas de profundidade no cenário.
    const scroll = (worldX || 0) * this.cellPx;
    this.drawMountainLayer(scroll * 0.1, horizonY, `hsl(${(hue + 42) % 360}, 56%, 18%)`, (wx) =>
      this.cellPx * (0.5 + 0.45 * Math.sin(wx * 0.0042 + 1.2) + 0.2 * Math.sin(wx * 0.0113 + 0.5) + 0.08 * Math.sin(wx * 0.0263 + 2.1))
    );
    this.drawMountainLayer(scroll * 0.26, horizonY, `hsl(${(hue + 72) % 360}, 58%, 11%)`, (wx) =>
      this.cellPx * (0.2 + 0.3 * Math.sin(wx * 0.0061 + 4.0) + 0.14 * Math.sin(wx * 0.0171 + 1.9))
    );
    this.drawSkyline(scroll * 0.13, horizonY, hue, 0, intensity);
    this.drawSkyline(scroll * 0.3, horizonY, hue, 1, intensity);
  }

  drawMountainLayer(scrollPx, horizonY, fill, heightAt) {
    const { ctx, widthCss } = this;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(-12, horizonY + 2);
    for (let px = -12; px <= widthCss + 12; px += 8) {
      ctx.lineTo(px, horizonY - heightAt(px + scrollPx));
    }
    ctx.lineTo(widthCss + 12, horizonY + 2);
    ctx.closePath();
    ctx.fill();
  }

  /** Silhuetas de cidade procedural: determinísticas, contínuas e com janelas neon. */
  drawSkyline(scrollPx, horizonY, baseHue, layer, intensity) {
    const { ctx, widthCss, cellPx } = this;
    const far = layer === 0;
    const scale = far ? 0.62 : 0.9;
    const unit = cellPx * (far ? 0.72 : 0.96);
    const camera = scrollPx;
    const firstBuilding = Math.floor(camera / unit) - 2;
    const lastBuilding = firstBuilding + Math.ceil(widthCss / unit) + 4;
    const hue = (baseHue + (far ? 218 : 250)) % 360;
    const lightness = far ? 12 : 9;

    ctx.save();
    ctx.globalAlpha = far ? 0.62 : 0.9;
    for (let building = firstBuilding; building <= lastBuilding; building++) {
      const n = seededNoise(building, layer + 3);
      const x = building * unit - camera;
      const width = unit * (0.46 + seededNoise(building, layer + 19) * 0.43);
      const height = cellPx * (0.38 + n * 1.18) * scale;
      const top = horizonY - height;
      ctx.fillStyle = `hsl(${hue}, 50%, ${lightness}%)`;
      ctx.fillRect(x, top, width, height + 3);
      ctx.fillStyle = `hsla(${(baseHue + 8) % 360}, 85%, 68%, ${0.16 + intensity * 0.16})`;
      ctx.fillRect(x, top, width, Math.max(1, cellPx * 0.018));

      // Janelas esparsas com padrão fixo: nenhuma cintilação aleatória entre frames.
      const windowW = Math.max(1.5, unit * 0.045);
      const windowH = Math.max(2, cellPx * 0.045);
      for (let wx = x + unit * 0.14, column = 0; wx < x + width - windowW; wx += unit * 0.2, column++) {
        for (let wy = top + cellPx * 0.16, row = 0; wy < horizonY - windowH; wy += cellPx * 0.19, row++) {
          if (seededNoise(building * 13 + column * 3 + row, layer + 29) < 0.58) continue;
          ctx.globalAlpha = 0.22 + intensity * 0.32;
          ctx.fillStyle = `hsl(${(baseHue + 32) % 360}, 96%, 72%)`;
          ctx.fillRect(wx, wy, windowW, windowH);
        }
      }
      ctx.globalAlpha = far ? 0.62 : 0.9;
    }
    ctx.restore();
  }

  /** Grade em perspectiva no chão, pulsando com a música (linhas horizontais rolam na batida). */
  drawGround(section, beatPulse, worldX) {
    const { ctx, widthCss, heightCss, cellPx } = this;
    const horizonY = this.horizonY();
    const bottom = heightCss;
    const glow = section?.glow || '#ff4dd8';
    const color = section?.color || '#7c5cff';

    const grad = ctx.createLinearGradient(0, horizonY, 0, bottom);
    grad.addColorStop(0, shade(color, -46));
    grad.addColorStop(1, '#04020a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, horizonY, widthCss, bottom - horizonY);

    // Horizonte brilhante (pulsa na batida).
    ctx.save();
    ctx.strokeStyle = glow;
    ctx.lineWidth = 2 + 2 * beatPulse;
    ctx.globalAlpha = 0.85;
    ctx.shadowColor = glow;
    ctx.shadowBlur = 16 + 14 * beatPulse;
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    ctx.lineTo(widthCss, horizonY);
    ctx.stroke();
    ctx.restore();

    // Bordas de uma pista luminosa reforçam a perspectiva e dão leitura de rota.
    const cx = widthCss / 2;
    ctx.save();
    ctx.strokeStyle = glow;
    ctx.globalAlpha = 0.22 + 0.15 * beatPulse;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = glow;
    ctx.shadowBlur = 8;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + side * cellPx * 0.13, horizonY + 1);
      ctx.lineTo(cx + side * Math.min(widthCss * 0.58, cellPx * 2.9), bottom);
      ctx.stroke();
    }
    ctx.restore();

    // Linhas verticais convergindo para o ponto de fuga central.
    const V = 14;
    ctx.save();
    ctx.strokeStyle = glow;
    ctx.globalAlpha = 0.16 + 0.3 * beatPulse;
    ctx.lineWidth = 1;
    for (let k = -V; k <= V; k++) {
      ctx.beginPath();
      ctx.moveTo(cx + k * cellPx * 0.14, horizonY);
      ctx.lineTo(cx + k * cellPx * 1.7, bottom);
      ctx.stroke();
    }
    ctx.restore();

    // Linhas horizontais em perspectiva, rolando em direção ao jogador (1 linha a cada 2 células de mundo).
    const phase = ((worldX || 0) / 2) % 1;
    const H = 16;
    ctx.save();
    ctx.strokeStyle = glow;
    for (let i = 0; i <= H; i++) {
      const t = (i + phase) / (H + 1);
      const y = horizonY + (bottom - horizonY) * Math.pow(t, 2.1);
      ctx.globalAlpha = (0.1 + 0.5 * t) * (0.55 + 0.45 * beatPulse);
      ctx.lineWidth = 1 + t * 1.6;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(widthCss, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- Entidades ----------

  /**
   * Linha de hit: a vertical fixa no x do jogador, onde o julgamento
   * clique↔batida acontece. Pulsa com o acento para dar o "alvo" visual do toque.
   */
  drawHitLine(beatPulse, color = '#4dffea') {
    const { ctx, widthCss } = this;
    const pulse = Math.max(0, Math.min(1, beatPulse));
    const x = widthCss * PLAYER_SCREEN_X_RATIO;
    const top = this.horizonY();
    const bottom = this.heightCss;

    ctx.save();
    ctx.globalAlpha = 0.12 + 0.28 * pulse;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 + 1.5 * pulse;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8 + 14 * pulse;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();

    // Nó no ponto de contato (onde o cubo toca a linha no chão).
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.45 + 0.5 * pulse;
    ctx.fillStyle = color;
    const r = (2.5 + 2.5 * pulse) * (this.cellPx / 64);
    ctx.beginPath();
    ctx.arc(x, this.groundY(), r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawObstacle(ob, time = 0, beatPulse = 0) {
    const { ctx } = this;
    const x = this.worldToScreenX(ob.screenX);
    const gy = this.groundY();
    const s = this.cellPx * 0.8;
    const hue = Number.isFinite(ob.hue) ? ob.hue : sectionHue(ob);
    const glow = ob.glow || ob.color || '#b39dff';
    const pulse = Math.max(clamp01(beatPulse), clamp01(ob.accent) * 0.82);
    const variant = Number(ob.variant) || 0;

    // Sombra de contato e halo de seção dão peso visual sem alterar hitbox.
    if (['spike', 'block', 'pad'].includes(ob.type)) {
      ctx.save();
      ctx.globalAlpha = 0.14 + 0.14 * pulse;
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.ellipse(x, gy + 1, s * (0.46 + pulse * 0.08), s * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (ob.type === 'spike') {
      ctx.save();
      ctx.shadowColor = '#ff477d';
      ctx.shadowBlur = 9 + 16 * pulse;
      const g = ctx.createLinearGradient(0, gy - s, 0, gy);
      g.addColorStop(0, '#fff0f6');
      g.addColorStop(0.16, '#ff8fb5');
      g.addColorStop(1, variant === 2 ? '#a91558' : '#c81d4e');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.52, gy);
      ctx.lineTo(x - s * 0.04, gy - s * 0.94);
      ctx.lineTo(x + s * 0.52, gy);
      ctx.closePath();
      ctx.fill();
      // Facetas claras/escuras dão volume e melhor leitura em telas pequenas.
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.beginPath();
      ctx.moveTo(x - s * 0.04, gy - s * 0.94);
      ctx.lineTo(x - s * 0.04, gy);
      ctx.lineTo(x - s * 0.42, gy);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(48,5,31,0.2)';
      ctx.beginPath();
      ctx.moveTo(x - s * 0.04, gy - s * 0.94);
      ctx.lineTo(x + s * 0.52, gy);
      ctx.lineTo(x - s * 0.04, gy);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = `hsla(${hue}, 95%, 82%, 0.75)`;
      ctx.lineWidth = Math.max(1, this.cellPx * 0.018);
      ctx.beginPath();
      ctx.moveTo(x - s * 0.52, gy);
      ctx.lineTo(x - s * 0.04, gy - s * 0.94);
      ctx.lineTo(x + s * 0.52, gy);
      ctx.stroke();
      ctx.restore();
    } else if (ob.type === 'block') {
      const d = s * 0.18;
      ctx.save();
      ctx.shadowColor = glow;
      ctx.shadowBlur = 9 + 15 * pulse;
      const g = ctx.createLinearGradient(x - s / 2, gy - s, x + s / 2, gy);
      g.addColorStop(0, `hsl(${(hue + 10) % 360}, 94%, 79%)`);
      g.addColorStop(1, `hsl(${(hue + 345) % 360}, 76%, 39%)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - s / 2, gy - s, s, s);
      // Tampo facetado e lateral escura para uma caixa 3D mais sólida.
      ctx.beginPath();
      ctx.moveTo(x - s / 2, gy - s);
      ctx.lineTo(x - s / 2 + d, gy - s - d);
      ctx.lineTo(x + s / 2 + d, gy - s - d);
      ctx.lineTo(x + s / 2, gy - s);
      ctx.closePath();
      ctx.fillStyle = `hsl(${(hue + 14) % 360}, 96%, 86%)`;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + s / 2, gy - s);
      ctx.lineTo(x + s / 2 + d, gy - s - d);
      ctx.lineTo(x + s / 2 + d, gy - d);
      ctx.lineTo(x + s / 2, gy);
      ctx.closePath();
      ctx.fillStyle = `hsl(${(hue + 350) % 360}, 72%, 27%)`;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(x - s / 2, gy - s, s, s);
      // Painel interno e travessas mudam com a variante, sem mexer no tamanho da colisão.
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = Math.max(1, this.cellPx * 0.016);
      ctx.strokeRect(x - s * 0.32, gy - s * 0.78, s * 0.64, s * 0.56);
      ctx.beginPath();
      if (variant === 1) {
        ctx.moveTo(x - s * 0.27, gy - s * 0.5);
        ctx.lineTo(x + s * 0.27, gy - s * 0.5);
      } else {
        ctx.moveTo(x, gy - s * 0.72);
        ctx.lineTo(x, gy - s * 0.28);
      }
      ctx.stroke();
      ctx.restore();
    } else if (ob.type === 'pad') {
      // O pad só aparece em frase na batida: sua seta deixa o impulso legível.
      ctx.save();
      ctx.shadowColor = '#ffd166';
      ctx.shadowBlur = 10 + 16 * pulse;
      const g = ctx.createLinearGradient(0, gy - s * 0.32, 0, gy);
      g.addColorStop(0, '#fff6a8');
      g.addColorStop(0.42, '#ffe05a');
      g.addColorStop(1, '#ff9f31');
      ctx.fillStyle = g;
      roundRectPath(ctx, x - s * 0.54, gy - s * 0.32, s * 1.08, s * 0.32, s * 0.1);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.86)';
      ctx.lineWidth = Math.max(1.5, this.cellPx * 0.025);
      ctx.beginPath();
      ctx.moveTo(x - s * 0.4, gy - s * 0.29);
      ctx.lineTo(x, gy - s * 0.34);
      ctx.lineTo(x + s * 0.4, gy - s * 0.29);
      ctx.stroke();
      for (let arrow = -1; arrow <= 1; arrow++) {
        const ax = x + arrow * s * 0.24;
        ctx.beginPath();
        ctx.moveTo(ax - s * 0.08, gy - s * 0.07);
        ctx.lineTo(ax, gy - s * 0.2);
        ctx.lineTo(ax + s * 0.08, gy - s * 0.07);
        ctx.stroke();
      }
      ctx.restore();
    } else if (ob.type === 'orb') {
      const bob = Math.sin(time * 3 + (ob.beatIndex || 0)) * s * 0.1;
      const cy = gy - s * 0.95 + bob;
      const r = s * 0.34;
      ctx.save();
      ctx.shadowColor = '#4dffea';
      ctx.shadowBlur = 12 + 16 * pulse;
      const g = ctx.createRadialGradient(x - r * 0.3, cy - r * 0.3, r * 0.1, x, cy, r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.42, '#a7fff4');
      g.addColorStop(1, 'rgba(39,214,219,0.18)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.translate(x, cy);
      ctx.rotate(time * (variant === 1 ? -1.4 : 1.4));
      ctx.strokeStyle = 'rgba(255,255,255,0.78)';
      ctx.lineWidth = Math.max(1.2, this.cellPx * 0.02);
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.42, r * 0.62, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.58, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (ob.type === 'shield') {
      const bob = Math.sin(time * 2.4 + (ob.beatIndex || 0) * 0.7) * s * 0.12;
      const cy = gy - s * 1.0 + bob;
      const R = s * 0.52;
      ctx.save();
      ctx.shadowColor = '#4dff88';
      ctx.shadowBlur = 12 + 13 * pulse;
      const g = ctx.createRadialGradient(x, cy, R * 0.2, x, cy, R);
      g.addColorStop(0, 'rgba(77,255,136,0.55)');
      g.addColorStop(1, 'rgba(77,255,136,0.05)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, cy, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#4dff88';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, cy, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(6,32,18,0.92)';
      ctx.beginPath();
      ctx.arc(x, cy, R * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(x, cy);
      ctx.rotate(time * 0.7);
      ctx.setLineDash([R * 0.28, R * 0.2]);
      ctx.strokeStyle = 'rgba(209,255,219,0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.05, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      this.drawShieldIcon(x, cy, R * 0.85, '#4dff88');
      ctx.restore();
    }
  }

  /** Ícone de escudo clássico (traçado em torno do centro cx,cy). */
  drawShieldIcon(cx, cy, size, color) {
    const { ctx } = this;
    const w = size * 0.62;
    const h = size * 0.78;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.moveTo(0, -h / 2);
    ctx.bezierCurveTo(w * 0.4, -h * 0.52, w * 0.62, -h * 0.44, w * 0.62, -h * 0.3);
    ctx.lineTo(w * 0.62, h * 0.02);
    ctx.bezierCurveTo(w * 0.62, h * 0.38, w * 0.3, h * 0.52, 0, h * 0.58);
    ctx.bezierCurveTo(-w * 0.3, h * 0.52, -w * 0.62, h * 0.38, -w * 0.62, h * 0.02);
    ctx.lineTo(-w * 0.62, -h * 0.3);
    ctx.bezierCurveTo(-w * 0.62, -h * 0.44, -w * 0.4, -h * 0.52, 0, -h / 2);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  drawCollectible(col, t = 0) {
    const { ctx } = this;
    const x = this.worldToScreenX(col.screenX);
    const groundY = this.groundY();
    const bob = Math.sin(t * 6) * this.cellPx * 0.055;
    const pulse = 1 + 0.08 * Math.sin(t * 4.5);
    const size = this.cellPx * 0.3 * pulse;
    const color = col.color || '#4de0ff';

    ctx.save();
    ctx.translate(x, groundY - this.cellPx * 1.6 + bob);
    ctx.rotate(Math.PI / 4 + Math.sin(t * 2) * 0.12);
    ctx.shadowColor = color;
    ctx.shadowBlur = col.trail ? 18 : 13;
    const gem = ctx.createLinearGradient(-size / 2, -size / 2, size / 2, size / 2);
    gem.addColorStop(0, '#ffffff');
    gem.addColorStop(0.28, color);
    gem.addColorStop(1, shade(color, -18));
    ctx.fillStyle = gem;
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.shadowBlur = 0;
    // Faceta central transforma o pickup em uma joia, com contorno de alto contraste.
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    ctx.moveTo(-size * 0.5, -size * 0.5);
    ctx.lineTo(size * 0.5, -size * 0.5);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.82)';
    ctx.lineWidth = Math.max(1.2, this.cellPx * 0.02);
    ctx.strokeRect(-size / 2, -size / 2, size, size);
    ctx.restore();
  }

  /**
   * Cubo do jogador: gradiente diagonal, rosto simples (olhos; "X" ao morrer),
   * rastro neon de posições recentes e halo verde giratório com escudo ativo.
   */
  drawPlayer(player, beatRingProgress, opts = {}) {
    const { ctx } = this;
    const { trail = [], shieldActive = false, time = 0 } = opts;
    const x = this.widthCss * PLAYER_SCREEN_X_RATIO;
    const gy = this.groundY();
    const s = this.cellPx * 0.8;
    const cy = gy - player.y * this.cellPx - s / 2;

    // Rastro neon: posições recentes desenhadas atrás do cubo, mais fortes perto dele.
    if (trail.length > 1 && !player.dead) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < trail.length; i++) {
        const back = trail.length - 1 - i; // 0 = posição atual
        if (back === 0) continue;
        const f = (i + 1) / trail.length; // 0..1 (mais novo = 1)
        const px = x - back * this.cellPx * 0.14;
        const py = gy - trail[i].y * this.cellPx - s / 2;
        const r = s * (0.1 + 0.28 * f);
        ctx.globalAlpha = 0.03 + 0.18 * f;
        ctx.fillStyle = '#4dffea';
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Anel de expectativa da batida (fecha exatamente na batida).
    if (beatRingProgress != null && !player.dead) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 2.5;
      const radius = s * (1.55 - 0.55 * beatRingProgress);
      ctx.globalAlpha = 0.3 + 0.55 * beatRingProgress;
      ctx.beginPath();
      ctx.arc(x, gy - s / 2, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Halo giratório verde quando o escudo está ativo.
    if (shieldActive && !player.dead) {
      ctx.save();
      ctx.translate(x, cy);
      ctx.rotate((time || 0) * 1.6);
      ctx.strokeStyle = 'rgba(77,255,136,0.9)';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#4dff88';
      ctx.shadowBlur = 12;
      ctx.setLineDash([s * 0.32, s * 0.2]);
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.78, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(x, cy);
    ctx.rotate((player.rotation * Math.PI) / 180);
    const scaleX = player.squash;
    const scaleY = 2 - player.squash;
    ctx.scale(scaleX, scaleY);

    // Gradiente diagonal (roxo → ciano); acinzentado na morte.
    ctx.shadowColor = player.dead ? '#000000' : '#7c5cff';
    ctx.shadowBlur = 18;
    const g = ctx.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2);
    if (player.dead) {
      g.addColorStop(0, '#6a6a78');
      g.addColorStop(1, '#2e2e3a');
    } else {
      g.addColorStop(0, '#9d7bff');
      g.addColorStop(1, '#4dffea');
    }
    ctx.fillStyle = g;
    roundRectPath(ctx, -s / 2, -s / 2, s, s, s * 0.18);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = player.dead ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    roundRectPath(ctx, -s / 2, -s / 2, s, s, s * 0.18);
    ctx.stroke();

    // Rosto simples: olhos + sorriso (ou olhos "X" + boca aberta ao morrer).
    const eyeY = -s * 0.1;
    const eyeDx = s * 0.17;
    const e = s * 0.11;
    ctx.fillStyle = '#141428';
    ctx.strokeStyle = '#141428';
    ctx.lineWidth = s * 0.055;
    ctx.lineCap = 'round';
    if (player.dead) {
      for (const dir of [-1, 1]) {
        const ex = dir * eyeDx;
        ctx.beginPath();
        ctx.moveTo(ex - e * 0.6, eyeY - e * 0.6);
        ctx.lineTo(ex + e * 0.6, eyeY + e * 0.6);
        ctx.moveTo(ex + e * 0.6, eyeY - e * 0.6);
        ctx.lineTo(ex - e * 0.6, eyeY + e * 0.6);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, s * 0.28, s * 0.09, 0, Math.PI * 2);
      ctx.fill();
    } else {
      roundRectPath(ctx, -eyeDx - e * 0.7, eyeY - e, e * 1.4, e * 2, e * 0.7);
      ctx.fill();
      roundRectPath(ctx, eyeDx - e * 0.7, eyeY - e, e * 1.4, e * 2, e * 0.7);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, s * 0.14, s * 0.16, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- HUD ----------

  drawHud(state) {
    const { ctx, widthCss, heightCss } = this;
    const {
      score,
      combo,
      multiplier = 1,
      progressPct = 0,
      sectionLabel,
      sectionColor,
      sectionGlow,
      judgeText,
      judgeAlpha = 0,
      milestoneText,
      milestoneAlpha = 0,
      shieldActive = false,
    } = state;

    const F_DISPLAY = (w, s) => `${w} ${s}px "Space Grotesk", system-ui, sans-serif`;
    const F_TEXT = (w, s) => `${w} ${s}px "Poppins", system-ui, sans-serif`;

    ctx.save();

    const panel = (x, y, w, h, stroke) => {
      roundRectPath(ctx, x, y, w, h, 12);
      ctx.fillStyle = 'rgba(12, 8, 28, 0.72)';
      ctx.fill();
      ctx.strokeStyle = stroke || 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    const top = this.safeTop + 10;
    const scoreText = score >= 1000000
      ? `${(score / 1000000).toFixed(1).replace('.', ',')} mi`
      : score >= 10000
        ? `${(score / 1000).toFixed(1).replace('.', ',')} mil`
        : SCORE_FORMATTER.format(score);

    // Dois cartões laterais mantêm uma faixa central livre até em telas estreitas.
    {
      const w = Math.min(widthCss * 0.4, 124);
      panel(12, top, w, 44, 'rgba(152,120,255,0.36)');
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      ctx.font = F_TEXT(600, 9);
      ctx.fillText('PONTOS', 23, top + 14);
      ctx.fillStyle = '#ffffff';
      ctx.font = F_DISPLAY(700, 19);
      ctx.fillText(scoreText, 23, top + 36, w - 47);
      if (multiplier > 1) {
        ctx.textAlign = 'right';
        ctx.fillStyle = '#ffd166';
        ctx.font = F_DISPLAY(700, 12);
        ctx.fillText(`×${multiplier}`, 12 + w - 10, top + 17);
      }
    }

    {
      const pauseRight = Math.max(14, this.safeRight);
      const rightEdge = widthCss - pauseRight - 48 - 8;
      const w = Math.min(94, Math.max(76, widthCss * 0.28));
      const x = rightEdge - w;
      panel(x, top, w, 44, shieldActive ? 'rgba(77,255,136,0.56)' : undefined);
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      ctx.font = F_TEXT(600, 9);
      ctx.fillText('COMBO', x + 12, top + 14);
      ctx.fillStyle = combo > 0 ? '#ffe14d' : 'rgba(255,255,255,0.5)';
      ctx.font = F_DISPLAY(700, 19);
      ctx.textAlign = 'right';
      ctx.fillText(`${combo}×`, x + w - 11, top + 36, Math.max(28, w - 35));
      if (shieldActive) this.drawShieldIcon(x + 19, top + 32, 14, '#4dff88');
    }

    // A seção fica numa segunda linha para não colidir com os cartões em aparelhos compactos.
    if (sectionLabel) {
      const label = String(sectionLabel).toUpperCase();
      ctx.font = F_TEXT(700, 10);
      const labelWidth = Math.min(ctx.measureText(label).width, widthCss - 52);
      const w = Math.min(widthCss - 32, labelWidth + 30);
      const x = (widthCss - w) / 2;
      const y = top + 53;
      panel(x, y, w, 23, 'rgba(255,255,255,0.11)');
      ctx.fillStyle = sectionColor || '#7c5cff';
      ctx.beginPath();
      ctx.arc(x + 11, y + 11.5, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = sectionGlow || '#ffffff';
      ctx.textAlign = 'left';
      ctx.font = F_TEXT(700, 10);
      ctx.fillText(label, x + 20, y + 15, Math.max(0, w - 25));
    }

    // Trilha fina de progresso: informa quanto da música já foi percorrido.
    {
      const x = 12;
      const y = top + 83;
      const w = Math.max(0, widthCss - 24);
      roundRectPath(ctx, x, y, w, 3, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fill();
      const fillWidth = w * Math.max(0, Math.min(1, progressPct / 100));
      if (fillWidth > 0) {
        roundRectPath(ctx, x, y, fillWidth, 3, 2);
        const progressGradient = ctx.createLinearGradient(x, y, x + Math.max(1, fillWidth), y);
        progressGradient.addColorStop(0, '#9d7bff');
        progressGradient.addColorStop(1, '#4dffea');
        ctx.fillStyle = progressGradient;
        ctx.fill();
      }
    }

    // Banner de julgamento: PERFEITO! / BOM / QUASE! 💨
    if (judgeText && judgeAlpha > 0) {
      const isQuase = judgeText.includes('QUASE');
      const color = isQuase ? '#9aa5ff' : judgeText === 'PERFEITO!' ? '#4dffea' : '#ffe14d';
      const y = heightCss * 0.3;
      const scale = 1 + 0.25 * judgeAlpha;
      ctx.save();
      ctx.translate(widthCss / 2, y);
      ctx.scale(scale, scale);
      ctx.globalAlpha = Math.min(1, judgeAlpha * 1.4);
      ctx.font = F_DISPLAY(800, 30);
      ctx.textAlign = 'center';
      ctx.shadowColor = color;
      ctx.shadowBlur = 16;
      ctx.fillStyle = color;
      ctx.fillText(judgeText, 0, 0);
      ctx.restore();
    }

    // Banner de marco de combo (2x/3x/4x).
    if (milestoneText && milestoneAlpha > 0) {
      const y = heightCss * 0.16;
      const scale = 1 + 0.3 * Math.min(1, milestoneAlpha);
      ctx.save();
      ctx.translate(widthCss / 2, y);
      ctx.scale(scale, scale);
      ctx.globalAlpha = Math.min(1, milestoneAlpha);
      ctx.font = F_DISPLAY(800, 32);
      ctx.textAlign = 'center';
      ctx.shadowColor = '#ffd166';
      ctx.shadowBlur = 22;
      const g = ctx.createLinearGradient(-90, -12, 90, 12);
      g.addColorStop(0, '#ffe27a');
      g.addColorStop(1, '#ff9a4d');
      ctx.fillStyle = g;
      ctx.fillText(milestoneText, 0, 0);
      ctx.restore();
    }

    ctx.restore();
  }
}

/** Caminho de retângulo com cantos arredondados (com fallback para o roundRect nativo). */
function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, rr);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function shade(hslOrHex, amount) {
  // Aceita 'hsl(h,s%,l%)' e ajusta a luminosidade; hex cai para um fallback simples.
  const m = /hsl\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)%,\s*(\d+(?:\.\d+)?)%\)/.exec(hslOrHex);
  if (m) {
    const h = parseFloat(m[1]);
    const s = parseFloat(m[2]);
    let l = parseFloat(m[3]) + amount;
    l = Math.max(0, Math.min(100, l));
    return `hsl(${h}, ${s}%, ${l}%)`;
  }
  return hslOrHex;
}
