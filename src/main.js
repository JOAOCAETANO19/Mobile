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
import { GameEngine, MODE } from './game/engine.js';
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
let lastFrameTime = performance.now();

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
    onNearMiss: () => { sfx.nearMiss(); },
    onOrb: () => { sfx.orb(); },
    onCollect: () => { sfx.collect(); },
    onDeath: (checkpoint) => {
      sfx.death();
      vibrate([40, 30, 60]);
      player.stop();
      screens.showOverlay(screens.deathOverlayHtml(checkpoint, { score: engine.score, bestCombo: engine.bestCombo }));
      wireDeathOverlay(checkpoint);
    },
    onSectionChange: () => {},
    onFinish: () => {
      player.stop();
      screens.showOverlay(screens.finishOverlayHtml({ score: engine.score, bestCombo: engine.bestCombo }));
      wireFinishOverlay();
    },
  }, currentMode);

  window.addEventListener('resize', () => renderer?.resize());
  canvas.addEventListener('pointerdown', onTap);
  window.addEventListener('keydown', onKeydown);

  player.play(0);
  lastFrameTime = performance.now();
  loop();
}

function onTap() {
  if (!engine || !player) return;
  if (engine.player.dead || engine.finished) return;
  engine.tap(player.getCurrentTime());
  sfx.jump();
}

function onKeydown(e) {
  if (e.code === 'Space') { e.preventDefault(); onTap(); }
  if (e.code === 'Escape') togglePause();
}

let paused = false;
function togglePause() {
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
    player.play(checkpoint.time);
    lastFrameTime = performance.now();
    loop();
  });
  app.querySelector('#btn-restart')?.addEventListener('click', () => {
    screens.hideOverlay();
    engine.reset(0);
    player.play(0);
    lastFrameTime = performance.now();
    loop();
  });
  app.querySelector('#btn-quit')?.addEventListener('click', quitToMenu);
}

function wireFinishOverlay() {
  app.querySelector('#btn-play-again')?.addEventListener('click', () => {
    screens.hideOverlay();
    engine.reset(0);
    player.play(0);
    lastFrameTime = performance.now();
    loop();
  });
  app.querySelector('#btn-quit')?.addEventListener('click', quitToMenu);
}

function quitToMenu() {
  cancelAnimationFrame(rafId);
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

  const currentTime = player.getCurrentTime();
  engine.update(currentTime, dt, renderer.widthCells);

  judgeState.alpha = Math.max(0, judgeState.alpha - dt * 1.5);

  const section = engine.level.sections.find((s) => currentTime >= s.start && currentTime < s.end);
  const beat = engine.nearestBeat(currentTime);
  const beatProgress = 1 - Math.min(1, Math.abs(beat.time - currentTime) / (engine.physics.T / 2));

  renderer.clear();
  renderer.drawBackground(section, beatProgress);
  renderer.drawGround(section);

  for (const col of engine.getVisibleCollectibles(currentTime, renderer.widthCells)) {
    renderer.drawCollectible(col, currentTime);
  }
  for (const ob of engine.getVisibleObstacles(currentTime, renderer.widthCells)) {
    renderer.drawObstacle(ob);
  }
  renderer.drawPlayer(engine.player, engine.mode === MODE.BEAT ? beatProgress : null);
  engine.particles.render(renderer.ctx);
  renderer.drawHud({ combo: engine.combo, score: engine.score, judgeText: judgeState.text, judgeAlpha: judgeState.alpha });
}

// ---------- PWA ----------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

screens.show('home');
