// SFX sintetizados via Web Audio (sem arquivos de áudio externos).

let sharedCtx = null;
function getCtx() {
  if (!sharedCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    sharedCtx = new AC();
  }
  return sharedCtx;
}

function beep({ freq = 440, duration = 0.08, type = 'sine', gain = 0.2, sweepTo = null }) {
  try {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (sweepTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), ctx.currentTime + duration);
    }
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  } catch (e) {
    // Ambientes sem AudioContext (ex: testes em Node) simplesmente ignoram.
  }
}

export const sfx = {
  jump: () => beep({ freq: 520, sweepTo: 880, duration: 0.09, type: 'triangle', gain: 0.18 }),
  perfect: () => beep({ freq: 880, sweepTo: 1400, duration: 0.12, type: 'sine', gain: 0.22 }),
  good: () => beep({ freq: 660, sweepTo: 900, duration: 0.1, type: 'sine', gain: 0.18 }),
  nearMiss: () => beep({ freq: 300, sweepTo: 200, duration: 0.06, type: 'sawtooth', gain: 0.1 }),
  death: () => beep({ freq: 220, sweepTo: 40, duration: 0.35, type: 'sawtooth', gain: 0.25 }),
  collect: () => beep({ freq: 1046, sweepTo: 1568, duration: 0.1, type: 'sine', gain: 0.15 }),
  orb: () => beep({ freq: 700, sweepTo: 1200, duration: 0.1, type: 'square', gain: 0.16 }),
  shieldPickup: () => beep({ freq: 520, sweepTo: 1040, duration: 0.14, type: 'sine', gain: 0.22 }),
  shieldBreak: () => beep({ freq: 320, sweepTo: 90, duration: 0.28, type: 'square', gain: 0.24 }),
  milestone: () => {
    beep({ freq: 660, duration: 0.09, type: 'triangle', gain: 0.2 });
    setTimeout(() => beep({ freq: 990, duration: 0.14, type: 'triangle', gain: 0.22 }), 90);
  },
  uiClick: () => beep({ freq: 500, duration: 0.04, type: 'sine', gain: 0.08 }),
  countdownTick: () => beep({ freq: 660, duration: 0.09, type: 'sine', gain: 0.16 }),
  countdownGo: () => beep({ freq: 990, sweepTo: 1320, duration: 0.18, type: 'triangle', gain: 0.2 }),
};

export function vibrate(pattern) {
  if (navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch (e) { /* noop */ }
  }
}
