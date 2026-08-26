// Pool simples de partículas (sem alocação por frame) para faíscas de near-miss,
// explosão de morte e brilho de coleta.

export class ParticlePool {
  constructor(maxParticles = 300) {
    this.max = maxParticles;
    this.x = new Float32Array(maxParticles);
    this.y = new Float32Array(maxParticles);
    this.vx = new Float32Array(maxParticles);
    this.vy = new Float32Array(maxParticles);
    this.life = new Float32Array(maxParticles);
    this.maxLife = new Float32Array(maxParticles);
    this.color = new Array(maxParticles).fill('#ffffff');
    this.size = new Float32Array(maxParticles);
    this.alive = new Uint8Array(maxParticles);
    this.cursor = 0;
  }

  spawn(x, y, count, { speed = 120, life = 0.5, color = '#ffffff', size = 3, spread = Math.PI * 2 } = {}) {
    for (let i = 0; i < count; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const angle = Math.random() * spread - spread / 2;
      const s = speed * (0.5 + Math.random() * 0.5);
      this.x[idx] = x;
      this.y[idx] = y;
      this.vx[idx] = Math.cos(angle) * s;
      this.vy[idx] = Math.sin(angle) * s;
      this.life[idx] = life;
      this.maxLife[idx] = life;
      this.color[idx] = color;
      this.size[idx] = size * (0.6 + Math.random() * 0.8);
      this.alive[idx] = 1;
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (!this.alive[i]) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alive[i] = 0;
        continue;
      }
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.vy[i] += 300 * dt; // leve gravidade nas partículas
      this.vx[i] *= 1 - 2 * dt;
    }
  }

  render(ctx) {
    for (let i = 0; i < this.max; i++) {
      if (!this.alive[i]) continue;
      const t = this.life[i] / this.maxLife[i];
      ctx.globalAlpha = Math.max(0, t);
      ctx.fillStyle = this.color[i];
      ctx.beginPath();
      ctx.arc(this.x[i], this.y[i], this.size[i] * t, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
