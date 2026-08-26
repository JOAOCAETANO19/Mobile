// Renderer Canvas 2D estilo neon: parallax, pulso na batida, partículas, HUD.

import { PLAYER_SCREEN_X_RATIO } from './engine.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cellPx = 64; // tamanho de 1 célula em pixels (ajustado no resize)
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
    ctx.fillStyle = bgColor || '#0a0a14';
    ctx.fillRect(0, 0, widthCss, heightCss);
  }

  drawBackground(section, beatPulse) {
    const { ctx, widthCss, heightCss } = this;
    const color = section?.color || 'hsl(260,70%,45%)';
    const glow = section?.glow || 'hsl(260,70%,65%)';

    const grad = ctx.createLinearGradient(0, 0, 0, heightCss);
    grad.addColorStop(0, '#05050a');
    grad.addColorStop(1, shade(color, -30));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, widthCss, heightCss);

    // Grid de fundo com parallax leve, pulsando na batida.
    ctx.save();
    ctx.globalAlpha = 0.15 + beatPulse * 0.15;
    ctx.strokeStyle = glow;
    ctx.lineWidth = 1;
    const gridSize = this.cellPx * 2;
    const offset = (performance.now() / 40) % gridSize;
    for (let x = -offset; x < widthCss; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, heightCss);
      ctx.stroke();
    }
    ctx.restore();
  }

  groundY() {
    return this.heightCss - this.cellPx * 1.2;
  }

  drawGround(section) {
    const { ctx, widthCss } = this;
    const y = this.groundY();
    const color = section?.color || '#7c5cff';
    ctx.fillStyle = shade(color, -50);
    ctx.fillRect(0, y, widthCss, this.heightCss - y);
    ctx.strokeStyle = section?.glow || color;
    ctx.lineWidth = 2;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(widthCss, y);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  worldToScreenX(screenXCells) {
    return screenXCells * this.cellPx;
  }

  drawObstacle(ob) {
    const { ctx } = this;
    const x = this.worldToScreenX(ob.screenX);
    const groundY = this.groundY();
    const size = this.cellPx * 0.8;

    ctx.save();
    ctx.shadowColor = ob.glow || '#fff';
    ctx.shadowBlur = 14;

    if (ob.type === 'spike') {
      ctx.fillStyle = ob.color || '#ff3d5a';
      ctx.beginPath();
      ctx.moveTo(x - size / 2, groundY);
      ctx.lineTo(x, groundY - size);
      ctx.lineTo(x + size / 2, groundY);
      ctx.closePath();
      ctx.fill();
    } else if (ob.type === 'block') {
      ctx.fillStyle = ob.color || '#5c7cff';
      ctx.fillRect(x - size / 2, groundY - size, size, size);
    } else if (ob.type === 'pad') {
      ctx.fillStyle = '#ffe14d';
      ctx.fillRect(x - size / 2, groundY - size * 0.2, size, size * 0.2);
    } else if (ob.type === 'orb') {
      ctx.fillStyle = '#4dffea';
      ctx.beginPath();
      ctx.arc(x, groundY - size * 0.9, size * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawCollectible(col, t) {
    const { ctx } = this;
    const x = this.worldToScreenX(col.screenX);
    const groundY = this.groundY();
    const bob = Math.sin(t * 6) * 6;
    const size = this.cellPx * 0.28;

    ctx.save();
    ctx.translate(x, groundY - this.cellPx * 1.6 + bob);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#4de0ff';
    ctx.shadowColor = '#4de0ff';
    ctx.shadowBlur = 16;
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.restore();
  }

  drawPlayer(player, beatRingProgress) {
    const { ctx } = this;
    const x = this.widthCss * PLAYER_SCREEN_X_RATIO;
    const groundY = this.groundY();
    const size = this.cellPx * 0.8;
    const y = groundY - player.y * this.cellPx - size / 2;

    // Anel de expectativa da batida (fecha exatamente na batida).
    if (beatRingProgress != null && !player.dead) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 3;
      const radius = size * (1.6 - 0.6 * beatRingProgress);
      ctx.globalAlpha = 0.5 + 0.5 * beatRingProgress;
      ctx.beginPath();
      ctx.arc(x, groundY - size / 2, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(x, y + size / 2);
    ctx.rotate((player.rotation * Math.PI) / 180);
    const scaleX = player.squash;
    const scaleY = 2 - player.squash;
    ctx.scale(scaleX, scaleY);
    ctx.fillStyle = player.dead ? '#555' : '#ffffff';
    ctx.shadowColor = player.dead ? '#000' : '#7c5cff';
    ctx.shadowBlur = 20;
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.restore();
  }

  drawHud({ combo, score, judgeText, judgeAlpha }) {
    const { ctx, widthCss } = this;
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.font = '600 20px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`✨ ${score}`, 16, 32);
    if (combo > 1) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffe14d';
      ctx.font = '700 24px system-ui, sans-serif';
      ctx.fillText(`${combo}x`, widthCss - 16, 32);
    }
    if (judgeText && judgeAlpha > 0) {
      ctx.globalAlpha = judgeAlpha;
      ctx.textAlign = 'center';
      ctx.font = '800 28px system-ui, sans-serif';
      ctx.fillStyle = judgeText === 'PERFEITO' ? '#4dffea' : '#ffe14d';
      ctx.fillText(judgeText, widthCss / 2, 80);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
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
