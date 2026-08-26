// Orquestrador: liga UI, busca, análise de áudio, geração de nível e o motor do jogo.

import './style.css';
import { Screens } from './ui/screens.js';
import { searchAllSources } from './core/search.js';
import { backendSearch, getBackendConfig, setBackendConfig, testBackend, backendStreamUrl } from './backend.js';
import { resolveYoutubeAudio, extractYoutubeId } from './core/youtube.js';
import {
  getAudioContext,
  loadAudioBufferFromUrl,
  loadAudioBufferFromFile,
  SyncedPlayer,
} from './core/audio.js';
import { analyzeAudioBuffer } from './core/analysis.js';
import { generateLevel } from './game/levelgen.js';
import { GameEngine, MODE, CELLS_PER_BEAT, multiplierForCombo, PLAYER_SCREEN_X_RATIO } from './game/engine.js';
import { Countdown } from './game/countdown.js';
import { Renderer } from './game/renderer.js';
import { sfx, vibrate } from './game/fx.js';
import { createDemoTrackBuffer, DEMO_TRACK_META } from './demo/demotrack.js';

const app = document.querySelector('#app');
const screens = new Screens(app);

let currentMode = MODE.BEAT;
let engine = null;
let renderer = null;
let player = null;
let level = null;
let rafId = null;
let judgeState = { text: '', alpha: 0 };
let milestoneState = { text: '', alpha: 0 };
let lastFrameTime = performance.now();

// Contagem regressiva 3-2-1 antes de iniciar/retomar (cenário congelado no ponto de partida).
let countdownActive = false;
let countdown = null;
let pendingStartTime = 0;
let loopRunning = false; // garante UMA única cadeia de requestAnimationFrame

/** Posição de tela do centro do cubo (para partículas de efeito). */
function playerScreenPos() {
  const x = renderer.widthCss * PLAYER_SCREEN_X_RATIO;
  const y = renderer.groundY() - engine.player.y * renderer.cellPx - renderer.cellPx * 0.4;
  return { x, y };
}

// ---------- Home: busca ----------

const els = {
  searchInput: app.querySelector('#search-input'),
  searchBtn: app.querySelector('#search-btn'),
  results: app.querySelector('#search-results'),
  fileInput: app.querySelector('#file-input'),
  demoBtn: app.querySelector('#demo-btn'),
  backendUrl: app.querySelector('#backend-url'),
  backendKey: app.querySelector('#backend-key'),
  backendTestBtn: app.querySelector('#backend-test-btn'),
  backendStatus: app.querySelector('#backend-status'),
  modeSelect: app.querySelector('#mode-select'),
};

const savedBackend = getBackendConfig();
if (els.backendUrl) els.backendUrl.value = savedBackend.url || '';
if (els.backendKey) els.backendKey.value = savedBackend.key || '';

els.modeSelect?.addEventListener('change', () => {
  currentMode = els.modeSelect.value === 'free' ? MODE.FREE : MODE.BEAT;
});

els.backendTestBtn?.addEventListener('click', async () => {
  const url = els.backendUrl.value.trim();
  const key = els.backendKey.value.trim();
  if (!url) return;
  els.backendStatus.textContent = 'Testando…';
  setBackendConfig(url, key);
  const result = await testBackend(url, key);
  if (result.ok) {
    els.backendStatus.textContent = result.data.ytdlp
      ? '✅ Conectado (yt-dlp ok)'
      : '⚠️ Conectado, mas yt-dlp não encontrado no servidor';
  } else {
    els.backendStatus.textContent = `❌ ${result.error} — se o preview é HTTPS, use um túnel HTTPS (veja o README).`;
  }
});

async function doSearch(query) {
  screens.setLoadingText || null;
  els.results.innerHTML = '<p class="empty">Buscando…</p>';

  const spotifyLink = /open\.spotify\.com\/track|spotify:track:/.test(query);
  const youtubeLink = extractYoutubeId(query);
  const directAudio = /\.(mp3|m4a|ogg|wav|flac)(\?.*)?$/i.test(query);

  if (youtubeLink) {
    els.results.innerHTML = `<p class="empty">Link do YouTube detectado — clique para extrair.</p>`;
    const card = document.createElement('button');
    card.className = 'track-card';
    card.innerHTML = `<div class="cover-placeholder">▶</div><div class="track-info"><strong>Extrair áudio deste vídeo</strong><span>${escapeHtmlLocal(query)}</span></div>`;
    card.addEventListener('click', () => pickYoutube(query));
    els.results.appendChild(card);
    return;
  }

  if (directAudio) {
    const track = { source: 'direct', id: query, title: 'Link direto', artist: query, duration: 0, fullTrackAvailable: true, streamUrl: query };
    els.results.innerHTML = '';
    const card = document.createElement('button');
    card.className = 'track-card';
    card.innerHTML = `<div class="cover-placeholder">🔗</div><div class="track-info"><strong>Tocar link direto</strong><span>${escapeHtmlLocal(query)}</span></div>`;
    card.addEventListener('click', () => pickTrack(track));
    els.results.appendChild(card);
    return;
  }

  const [backend, sources] = await Promise.all([
    backendSearch(query),
    searchAllSources(query),
  ]);

  screens.renderSearchResults(els.results, { backend, ...sources }, pickTrack);
}

els.searchBtn?.addEventListener('click', () => doSearch(els.searchInput.value.trim()));
els.searchInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch(els.searchInput.value.trim());
});

els.fileInput?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  await startGameFromFile(file);
});

els.demoBtn?.addEventListener('click', () => startGameFromDemo());

function escapeHtmlLocal(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------- Seleção de faixa ----------

async function pickTrack(track) {
  try {
    screens.show('loading');
    screens.setLoadingText(`Carregando "${track.title}"…`);
    screens.setLoadingProgress(0.05);

    let url = track.streamUrl || track.previewUrl;

    // Tenta música completa via backend próprio primeiro, se disponível e a faixa não já veio de lá.
    if (!url && track.id) {
      const backendUrl = backendStreamUrl(track.id);
      if (backendUrl) url = backendUrl;
    }

    if (!url) {
      alert('Essa fonte não tem áudio jogável disponível (sem prévia nem stream). Tente outro resultado.');
      screens.show('home');
      return;
    }

    const audioBuffer = await loadAudioBufferFromUrl(url, (p) => screens.setLoadingProgress(0.1 + p * 0.6));
    await runAnalysisAndStart(audioBuffer, track);
  } catch (err) {
    console.error(err);
    alert(`Não consegui carregar essa música: ${err.message || err}`);
    screens.show('home');
  }
}

async function pickYoutube(input) {
  try {
    screens.show('loading');
    screens.setLoadingText('Extraindo áudio do YouTube…');
    screens.setLoadingProgress(0.1);
    const resolved = await resolveYoutubeAudio(input);
    screens.setLoadingText(`Baixando "${resolved.title || 'faixa'}"…`);
    const audioBuffer = await loadAudioBufferFromUrl(resolved.streamUrl, (p) => screens.setLoadingProgress(0.2 + p * 0.6));
    await runAnalysisAndStart(audioBuffer, {
      title: resolved.title || 'YouTube',
      artist: resolved.artist || '',
      duration: resolved.duration || audioBuffer.duration,
    });
  } catch (err) {
    console.error(err);
    alert(`${err.message || err}`);
    screens.show('home');
  }
}

async function startGameFromFile(file) {
  try {
    screens.show('loading');
    screens.setLoadingText(`Analisando "${file.name}"…`);
    screens.setLoadingProgress(0.1);
    const audioBuffer = await loadAudioBufferFromFile(file);
    await runAnalysisAndStart(audioBuffer, { title: file.name, artist: 'Arquivo local', duration: audioBuffer.duration });
  } catch (err) {
    console.error(err);
    alert(`Não consegui ler esse arquivo: ${err.message || err}`);
    screens.show('home');
  }
}

async function startGameFromDemo() {
  screens.show('loading');
  screens.setLoadingText('Gerando faixa demo (128 BPM)…');
  screens.setLoadingProgress(0.2);
  const ctx = getAudioContext();
  const buffer = createDemoTrackBuffer(ctx);
  await runAnalysisAndStart(buffer, DEMO_TRACK_META);
}

async function runAnalysisAndStart(audioBuffer, trackMeta) {
  screens.setLoadingText('Detectando batidas e BPM…');
  screens.setLoadingProgress(0.75);
  // Cede o frame para o navegador pintar a barra de progresso antes do trabalho pesado.
  await new Promise((r) => setTimeout(r, 30));

  const analysis = analyzeAudioBuffer(audioBuffer);
  screens.setLoadingProgress(0.9);
  level = generateLevel(analysis, trackMeta);
  screens.setLoadingProgress(1);

  startGame(audioBuffer, level);
}

// ---------- Jogo ----------

function startGame(audioBuffer, lvl) {
  screens.show('game');
  const canvas = app.querySelector('#game-canvas');
  renderer = new Renderer(canvas);
  player = new SyncedPlayer(audioBuffer);

  engine = new GameEngine(lvl, {
    onJudge: (judge, combo) => {
      judgeState = { text: judge === 'PERFECT' ? 'PERFEITO!' : 'BOM', alpha: 1 };
      if (judge === 'PERFECT') { sfx.perfect(); vibrate(15); } else { sfx.good(); }
    },
    onNearMiss: () => {
      sfx.nearMiss();
      judgeState = { text: 'QUASE! 💨', alpha: 1 };
      renderer.shake('light');
      const p = playerScreenPos();
      engine.particles.spawn(p.x + renderer.cellPx * 0.4, p.y, 8, { speed: 160, life: 0.35, color: '#c9d4ff', size: 2.5 });
    },
    onOrb: () => { sfx.orb(); },
    onCollect: () => {
      sfx.collect();
      const p = playerScreenPos();
      engine.particles.spawn(p.x, p.y - renderer.cellPx * 0.8, 10, { speed: 130, life: 0.45, color: '#4de0ff', size: 3 });
    },
    onComboMilestone: (m) => {
      milestoneState = { text: `MARCO DE COMBO ×${m.mult}!`, alpha: 1.4 };
      sfx.milestone();
      vibrate([20, 30, 20]);
      const p = playerScreenPos();
      engine.particles.spawn(p.x, p.y - renderer.cellPx, 18, { speed: 200, life: 0.6, color: '#ffd166', size: 3.5 });
    },
    onShieldPickup: () => {
      sfx.shieldPickup();
      vibrate(25);
      const p = playerScreenPos();
      engine.particles.spawn(p.x, p.y, 14, { speed: 150, life: 0.5, color: '#4dff88', size: 3 });
    },
    onShieldBreak: () => {
      sfx.shieldBreak();
      vibrate([30, 20, 40]);
      renderer.shake('medium');
      const p = playerScreenPos();
      engine.particles.spawn(p.x, p.y, 22, { speed: 220, life: 0.55, color: '#4dff88', size: 4 });
    },
    onDeath: (checkpoint) => {
      sfx.death();
      vibrate([40, 30, 60]);
      renderer.shake('strong');
      const p = playerScreenPos();
      engine.particles.spawn(p.x, p.y, 34, { speed: 260, life: 0.8, color: '#ff5d8f', size: 4.5 });
      engine.particles.spawn(p.x, p.y, 18, { speed: 180, life: 0.7, color: '#ffffff', size: 3 });
      player.stop();
      screens.showOverlay(screens.deathOverlayHtml(checkpoint, { score: engine.score, bestCombo: engine.bestCombo }));
      wireDeathOverlay(checkpoint);
    },
    onSectionChange: () => {},
    onFinish: () => {
      player.stop();
      const p = playerScreenPos();
      engine.particles.spawn(renderer.widthCss * 0.3, p.y - renderer.cellPx, 20, { speed: 220, life: 0.8, color: '#4dffea', size: 4 });
      engine.particles.spawn(renderer.widthCss * 0.6, p.y - renderer.cellPx * 1.4, 20, { speed: 220, life: 0.8, color: '#ffd166', size: 4 });
      engine.particles.spawn(renderer.widthCss * 0.8, p.y - renderer.cellPx, 20, { speed: 220, life: 0.8, color: '#ff5d8f', size: 4 });
      screens.showOverlay(screens.finishOverlayHtml({ score: engine.score, bestCombo: engine.bestCombo }));
      wireFinishOverlay();
    },
  }, currentMode);

  window.addEventListener('resize', () => renderer?.resize());
  canvas.addEventListener('pointerdown', onTap);
  window.addEventListener('keydown', onKeydown);
  // Correção: o botão de pausa existia no HTML mas nunca tinha o listener conectado.
  app.querySelector('#pause-btn')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    togglePause();
  });

  // A música só começa após a contagem regressiva 3-2-1.
  lastFrameTime = performance.now();
  beginCountdown(0, 'Prepare-se!');
  ensureLoop();
}

/**
 * Contagem regressiva 3-2-1 antes de iniciar/retomar: a cena fica congelada no
 * ponto de partida e o áudio (única fonte de verdade do tempo) só começa no fim.
 */
function beginCountdown(startTime, label) {
  pendingStartTime = startTime;
  countdownActive = true;
  countdown = new Countdown({
    onNumber: (n) => {
      screens.showCountdown(screens.countdownHtml(n, label));
      sfx.countdownTick();
    },
    onDone: () => {
      countdownActive = false;
      countdown = null;
      screens.hideOverlay();
      sfx.countdownGo();
      player.play(pendingStartTime);
      lastFrameTime = performance.now();
    },
  });
  countdown.start(performance.now());
}

/** Garante uma única cadeia de rAF (retry/retomar não criam loops paralelos). */
function ensureLoop() {
  if (!loopRunning) {
    loopRunning = true;
    lastFrameTime = performance.now();
    rafId = requestAnimationFrame(loop);
  }
}

function onTap() {
  if (!engine || !player) return;
  if (countdownActive || engine.player.dead || engine.finished) return;
  engine.tap(player.getCurrentTime());
  sfx.jump();
}

function onKeydown(e) {
  if (e.code === 'Space') { e.preventDefault(); onTap(); }
  if (e.code === 'Escape') togglePause();
}

let paused = false;
function togglePause() {
  if (countdownActive) return; // sem pausar no meio da contagem 3-2-1
  if (!engine || engine.player.dead || engine.finished) return;
  paused = !paused;
  if (paused) {
    player.ctx.suspend();
    screens.showOverlay(screens.pauseOverlayHtml());
    wirePauseOverlay();
  } else {
    player.ctx.resume();
    screens.hideOverlay();
  }
}

function wirePauseOverlay() {
  app.querySelector('#btn-continue')?.addEventListener('click', () => { paused = false; player.ctx.resume(); screens.hideOverlay(); });
  app.querySelector('#btn-mode-toggle')?.addEventListener('click', () => {
    currentMode = currentMode === MODE.BEAT ? MODE.FREE : MODE.BEAT;
    engine.mode = currentMode;
  });
  app.querySelector('#btn-quit')?.addEventListener('click', quitToMenu);
}

function wireDeathOverlay(checkpoint) {
  app.querySelector('#btn-resume-checkpoint')?.addEventListener('click', () => {
    screens.hideOverlay();
    engine.reset(checkpoint.time);
    beginCountdown(checkpoint.time, `Retomando do ${checkpoint.label.toUpperCase()} · ${checkpoint.progressPct}%`);
    ensureLoop();
  });
  app.querySelector('#btn-restart')?.addEventListener('click', () => {
    screens.hideOverlay();
    engine.reset(0);
    beginCountdown(0, 'Recomeçando…');
    ensureLoop();
  });
  app.querySelector('#btn-quit')?.addEventListener('click', quitToMenu);
}

function wireFinishOverlay() {
  app.querySelector('#btn-play-again')?.addEventListener('click', () => {
    screens.hideOverlay();
    engine.reset(0);
    beginCountdown(0, 'De novo!');
    ensureLoop();
  });
  app.querySelector('#btn-quit')?.addEventListener('click', quitToMenu);
}

function quitToMenu() {
  countdownActive = false;
  countdown = null;
  cancelAnimationFrame(rafId);
  loopRunning = false;
  player?.stop();
  screens.hideOverlay();
  screens.show('home');
}

function loop() {
  rafId = requestAnimationFrame(loop);
  if (paused || !engine || !player) return;

  const now = performance.now();
  const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  judgeState.alpha = Math.max(0, judgeState.alpha - dt * 1.5);
  milestoneState.alpha = Math.max(0, milestoneState.alpha - dt * 0.9);

  // Contagem 3-2-1 ativa: cena congelada no ponto de partida (a música começa no onDone).
  if (countdownActive && countdown) {
    countdown.update(now);
    renderFrame(pendingStartTime);
    return;
  }

  const currentTime = player.getCurrentTime();
  engine.update(currentTime, dt, renderer.widthCells);
  renderer.updateShake(dt);

  renderFrame(currentTime);
}

function renderFrame(currentTime) {
  const section = engine.level.sections.find((s) => currentTime >= s.start && currentTime < s.end);
  const beat = engine.nearestBeat(currentTime);
  const beatProgress = 1 - Math.min(1, Math.abs(beat.time - currentTime) / (engine.physics.T / 2));
  const worldX = currentTime * CELLS_PER_BEAT * (level.bpm / 60);

  renderer.clear();
  renderer.beginScene();
  renderer.drawBackground(section, beatProgress, currentTime, worldX);
  renderer.drawGround(section, beatProgress, worldX);
  renderer.drawHitLine(beatProgress, section?.glow || '#4dffea');

  for (const col of engine.getVisibleCollectibles(currentTime, renderer.widthCells)) {
    renderer.drawCollectible(col, currentTime);
  }
  for (const ob of engine.getVisibleObstacles(currentTime, renderer.widthCells)) {
    renderer.drawObstacle(ob, currentTime, beatProgress);
  }
  renderer.drawPlayer(engine.player, engine.mode === MODE.BEAT ? beatProgress : null, {
    trail: engine.trail,
    shieldActive: engine.shieldActive,
    time: currentTime,
  });
  engine.particles.render(renderer.ctx);
  renderer.endScene();

  renderer.drawHud({
    score: engine.score,
    combo: engine.combo,
    multiplier: multiplierForCombo(engine.combo),
    sectionLabel: engine.currentSectionLabel,
    sectionColor: section?.color,
    sectionGlow: section?.glow,
    judgeText: judgeState.text,
    judgeAlpha: judgeState.alpha,
    milestoneText: milestoneState.text,
    milestoneAlpha: milestoneState.alpha,
    shieldActive: engine.shieldActive,
  });
}

// ---------- PWA ----------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

screens.show('home');
