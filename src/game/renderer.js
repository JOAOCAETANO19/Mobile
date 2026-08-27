// Renderer Canvas 2D — estética "synthwave":
// sol pulsante sincronizado com a batida, duas camadas de montanhas em parallax,
// grade em perspectiva no chão pulsando com a música, cubo com gradiente diagonal
// + rosto, rastro neon, halo de escudo, obstáculos com gradiente/profundidade por
// tipo e HUD com painéis translúcidos (score/combo/seção/banners de julgamento).

import { PLAYER_SCREEN_X_RATIO } from './engine.js';

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
    const color = section?.color || 'hsl(260,70%,45%)';
    const glow = section?.glow || 'hsl(260,70%,65%)';

    // Céu: gradiente noturno tingido pela cor da seção musical.
    const grad = ctx.createLinearGradient(0, 0, 0, horizonY);
    grad.addColorStop(0, '#06030f');
    grad.addColorStop(0.6, '#170a30');
    grad.addColorStop(1, shade(color, -38));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, widthCss, horizonY + 1);

    // Estrelas (fixas, com cintilação suave).
    ctx.save();
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 42; i++) {
      const sx = (((i * 733) % 997) / 997) * widthCss;
      const sy = (((i * 419) % 991) / 991) * horizonY * 0.72;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin((time || 0) * 0.8 + i * 1.7));
      ctx.globalAlpha = 0.15 + 0.4 * tw;
      ctx.fillRect(sx, sy, 2, 2);
    }
    ctx.restore();

    // Sol synthwave pulsante, sincronizado com a batida.
    const cx = widthCss * 0.63;
    const cy = horizonY - this.cellPx * 0.85;
    const R = this.cellPx * 1.35 * (1 + 0.09 * beatPulse);

    ctx.save();
    const halo = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, R * 2.1);
    halo.addColorStop(0, `rgba(255, 120, 90, ${0.22 + 0.3 * beatPulse})`);
    halo.addColorStop(1, 'rgba(255, 120, 90, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(cx - R * 2.2, cy - R * 2.2, R * 4.4, R * 4.4);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    const sun = ctx.createLinearGradient(0, cy - R, 0, cy + R);
    sun.addColorStop(0, '#ffe27a');
    sun.addColorStop(0.5, '#ff9a4d');
    sun.addColorStop(1, '#ff3d81');
    ctx.fillStyle = sun;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    // Listras horizontais clássicas (mais grossas em direção à base).
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 6; i++) {
      const bandY = cy + R * (0.06 + i * 0.155);
      const bandH = (2 + i * 2.1) * (this.cellPx / 64);
      ctx.fillRect(cx - R, bandY, R * 2, bandH);
    }
    ctx.restore();

    // Duas camadas de montanhas em parallax (rolam com o mundo em velocidades distintas).
    const scroll = (worldX || 0) * this.cellPx;
    this.drawMountainLayer(scroll * 0.1, horizonY, '#2b1552', (wx) =>
      this.cellPx * (0.5 + 0.45 * Math.sin(wx * 0.0042 + 1.2) + 0.2 * Math.sin(wx * 0.0113 + 0.5) + 0.08 * Math.sin(wx * 0.0263 + 2.1))
    );
    this.drawMountainLayer(scroll * 0.26, horizonY, '#170b2e', (wx) =>
      this.cellPx * (0.2 + 0.3 * Math.sin(wx * 0.0061 + 4.0) + 0.14 * Math.sin(wx * 0.0171 + 1.9))
    );
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

    // Linhas verticais convergindo para o ponto de fuga central.
    const cx = widthCss / 2;
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

    // Glow pulsante sincronizado com a batida: o brilho "acende" no acento.
    const pulse = Math.max(0, Math.min(1, beatPulse));

    if (ob.type === 'spike') {
      ctx.save();
      ctx.shadowColor = '#ff3d6e';
      ctx.shadowBlur = 10 + 18 * pulse;
      const g = ctx.createLinearGradient(0, gy - s, 0, gy);
      g.addColorStop(0, '#ff8fb5');
      g.addColorStop(1, '#c81d4e');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - s / 2, gy);
      ctx.lineTo(x, gy - s);
      ctx.lineTo(x + s / 2, gy);
      ctx.closePath();
      ctx.fill();
      // Bico interno claro dá profundidade.
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.beginPath();
      ctx.moveTo(x - s * 0.18, gy);
      ctx.lineTo(x, gy - s * 0.82);
      ctx.lineTo(x + s * 0.18, gy);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else if (ob.type === 'block') {
      const d = s * 0.2; // deslocamento pseudo-3D
      ctx.save();
      ctx.shadowColor = '#7c5cff';
      ctx.shadowBlur = 10 + 16 * pulse;
      const g = ctx.createLinearGradient(0, gy - s, 0, gy);
      g.addColorStop(0, '#a37dff');
      g.addColorStop(1, '#5b2fd4');
      ctx.fillStyle = g;
      ctx.fillRect(x - s / 2, gy - s, s, s);
      // Topo (mais claro) e lateral (mais escura) criam volume.
      ctx.beginPath();
      ctx.moveTo(x - s / 2, gy - s);
      ctx.lineTo(x - s / 2 + d, gy - s - d);
      ctx.lineTo(x + s / 2 + d, gy - s - d);
      ctx.lineTo(x + s / 2, gy - s);
      ctx.closePath();
      ctx.fillStyle = '#c9adff';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + s / 2, gy - s);
      ctx.lineTo(x + s / 2 + d, gy - s - d);
      ctx.lineTo(x + s / 2 + d, gy - d);
      ctx.lineTo(x + s / 2, gy);
      ctx.closePath();
      ctx.fillStyle = '#3a1d8f';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - s / 2, gy - s, s, s);
      ctx.restore();
    } else if (ob.type === 'pad') {
      // O pad também "respira" na batida (antes pulsava fora do compasso).
      const padPulse = 0.35 + 0.65 * pulse;
      ctx.save();
      ctx.shadowColor = '#ffd166';
      ctx.shadowBlur = 10 + 14 * padPulse;
      const g = ctx.createLinearGradient(0, gy - s * 0.3, 0, gy);
      g.addColorStop(0, '#ffe97a');
      g.addColorStop(1, '#ffb03d');
      ctx.fillStyle = g;
      roundRectPath(ctx, x - s / 2, gy - s * 0.3, s, s * 0.3, s * 0.1);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(x - s * 0.4, gy - s * 0.3, s * 0.8, 2);
      ctx.restore();
    } else if (ob.type === 'orb') {
      const bob = Math.sin(time * 3 + (ob.beatIndex || 0)) * s * 0.1;
      const cy = gy - s * 0.95 + bob;
      const r = s * 0.34;
      ctx.save();
      ctx.shadowColor = '#4dffea';
      ctx.shadowBlur = 12 + 14 * pulse;
      const g = ctx.createRadialGradient(x - r * 0.3, cy - r * 0.3, r * 0.1, x, cy, r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.4, '#4dffea');
      g.addColorStop(1, 'rgba(77,255,234,0.12)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, cy, r * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (ob.type === 'shield') {
      const bob = Math.sin(time * 2.4 + (ob.beatIndex || 0) * 0.7) * s * 0.12;
      const cy = gy - s * 1.0 + bob;
      const R = s * 0.52;
      ctx.save();
      ctx.shadowColor = '#4dff88';
      ctx.shadowBlur = 12 + 12 * pulse;
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
      // Disco escuro + ícone de escudo.
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(6,32,18,0.92)';
      ctx.beginPath();
      ctx.arc(x, cy, R * 0.62, 0, Math.PI * 2);
      ctx.fill();
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
    const bob = Math.sin(t * 6) * 6;
    const size = this.cellPx * 0.28;

    ctx.save();
    ctx.translate(x, groundY - this.cellPx * 1.6 + bob);
    ctx.rotate(Math.PI / 4 + Math.sin(t * 2) * 0.25);
    ctx.fillStyle = '#4de0ff';
    ctx.shadowColor = '#4de0ff';
    ctx.shadowBlur = 16;
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-size / 2, -size / 2, size, size);
    ctx.restore();
  }

  /**
   * Cubo do jogador: gradiente diagonal, rosto simples (olhos; "X" ao morrer),
   * rastro neon de posições recentes e halo verde giratório com escudo ativo.
   */
  /**
   * "Replay da morte": anel pulsante vermelho + ☠ sobre o obstáculo que matou,
   * exibido por ~1s enquanto a cena fica congelada (antes do overlay de morte).
   */
  drawDeathMarker(screenXCells, pulseTime = 0) {
    const { ctx } = this;
    const x = this.worldToScreenX(screenXCells);
    const gy = this.groundY();
    const s = this.cellPx * 0.8;
    const wave = 0.5 + 0.5 * Math.sin(pulseTime * 12); // pulsação rápida

    ctx.save();
    ctx.strokeStyle = `rgba(255, 61, 110, ${0.55 + 0.45 * wave})`;
    ctx.lineWidth = 4;
    ctx.shadowColor = '#ff3d6e';
    ctx.shadowBlur = 14 + 14 * wave;
    ctx.beginPath();
    ctx.arc(x, gy - s * 0.55, s * (0.95 + 0.2 * wave), 0, Math.PI * 2);
    ctx.stroke();

    ctx.font = `700 ${Math.round(s * 0.75)}px Poppins, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd166';
    ctx.shadowColor = '#ffd166';
    ctx.shadowBlur = 12;
    ctx.fillText('☠', x, gy - s * (1.75 + 0.1 * wave));
    ctx.restore();
  }

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
      ctx.fillStyle = 'rgba(12, 8, 28, 0.55)';
      ctx.fill();
      ctx.strokeStyle = stroke || 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    // Painel de pontuação (topo esquerdo) — mostra o multiplicador ativo.
    {
      const value = String(score);
      ctx.font = F_DISPLAY(700, 20);
      const valueW = ctx.measureText(value).width;
      const w = Math.max(112, valueW + 74 + (multiplier > 1 ? 30 : 0));
      panel(12, 12, w, 46);
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = F_TEXT(600, 10);
      ctx.fillText('PONTOS', 24, 28);
      ctx.fillStyle = '#ffffff';
      ctx.font = F_DISPLAY(700, 20);
      ctx.fillText(value, 24, 50);
      if (multiplier > 1) {
        ctx.fillStyle = '#ffd166';
        ctx.font = F_DISPLAY(700, 16);
        ctx.fillText(`×${multiplier}`, 30 + valueW, 49);
      }
    }

    // Painel de combo (topo direito) — moldura verde com escudo ativo.
    {
      const value = `${combo}×`;
      ctx.font = F_DISPLAY(700, 20);
      const valueW = ctx.measureText(value).width;
      const w = Math.max(96, valueW + 64);
      const x = widthCss - 12 - w;
      panel(x, 12, w, 46, shieldActive ? 'rgba(77,255,136,0.5)' : undefined);
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = F_TEXT(600, 10);
      ctx.fillText('COMBO', x + 14, 28);
      ctx.fillStyle = combo > 0 ? '#ffe14d' : 'rgba(255,255,255,0.35)';
      ctx.font = F_DISPLAY(700, 20);
      ctx.textAlign = 'right';
      ctx.fillText(value, x + w - 14, 50);
      if (shieldActive) {
        this.drawShieldIcon(x + 21, 43, 16, '#4dff88');
      }
    }

    // Nome da seção musical atual (topo central).
    if (sectionLabel) {
      const label = String(sectionLabel).toUpperCase();
      ctx.font = F_TEXT(700, 11);
      const tw = ctx.measureText(label).width;
      const w = tw + 34;
      const x = (widthCss - w) / 2;
      panel(x, 12, w, 26);
      ctx.fillStyle = sectionColor || '#7c5cff';
      ctx.beginPath();
      ctx.arc(x + 12, 25, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = sectionGlow || '#ffffff';
      ctx.textAlign = 'left';
      ctx.fillText(label, x + 22, 29);
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
