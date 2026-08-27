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
import { initRotateOverlay, lockLandscape, unlockLandscape } from './core/orientation.js';
import { emptyTurma, normalizePlayerName, restartRound, sortTurmaResults, medalFor } from './game/turma.js';
import { getAudioOffsetMs, setAudioOffsetMs, averageOffset, matchTapsToTicks } from './core/latency.js';
import { trackKey, loadStats, saveStats, applyRunToStats, topPlayed } from './game/stats.js';
import { sampleGhost, ghostYAt, saveGhostFor, loadGhostFor } from './game/ghost.js';

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

// Badge da música + replay da morte + modo turma.
let currentTrackMeta = null; // {title, artist, duration} da faixa em jogo
let lastGameBuffers = null; // {audioBuffer, level} — "jogar a mesma música" (turma)
let deathCam = null; // {killerId, t, elapsed, checkpoint} — congela e marca o assassino
let latestProgressPct = 0; // maior progresso da tentativa (para o placar da turma)
let turmaRunRecorded = false; // evita registrar a mesma tentativa duas vezes
let runStatsSaved = false; // garante 1 registro de recorde por partida
let ghostRec = []; // amostras [t, y] da corrida atual (para o fantasma)
let ghostBest = null; // fantasma carregado da melhor corrida DESTA música
let deferredInstallPrompt = null; // evento beforeinstallprompt guardado
let calibration = null; // calibração de latência em andamento

/** Estado da turma salvo no aparelho (sobrevive a refresh). */
function loadTurma() {
  try {
    const raw = localStorage.getItem('rhythm-dash-turma');
    if (raw) return { ...emptyTurma(), ...JSON.parse(raw) };
  } catch {
    /* sem localStorage (modo privado etc.) — turma fica só em memória */
  }
  return emptyTurma();
}
function saveTurma() {
  try {
    localStorage.setItem('rhythm-dash-turma', JSON.stringify(turma));
  } catch {
    /* noop */
  }
}
let turma = loadTurma();

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
  currentTrackMeta = trackMeta; // usado no badge da música durante o jogo
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
  // Modo paisagem: tenta travar a orientação (fire-and-forget; o overlay
  // "Gire o celular" cobre os navegadores sem suporte ao lock, ex.: iOS).
  lockLandscape();

  // Estado por partida: badge da música, replay da morte, turma, recordes e fantasma.
  lastGameBuffers = { audioBuffer, lvl };
  deathCam = null;
  latestProgressPct = 0;
  turmaRunRecorded = false;
  runStatsSaved = false;
  ghostRec = [];
  ghostBest = currentTrackMeta ? loadGhostFor(trackKey(currentTrackMeta)) : null;
  const badge = app.querySelector('#song-badge');
  if (badge && currentTrackMeta) {
    const title = currentTrackMeta.title || 'Música';
    const artist = currentTrackMeta.artist ? ` — ${currentTrackMeta.artist}` : '';
    badge.textContent = `🎵 ${title}${artist}`;
    badge.classList.remove('hidden');
  }

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
      // Replay da morte: ~1s de cena congelada com o obstáculo assassino marcado;
      // o overlay de morte só aparece quando o tempinho acaba (no loop).
      deathCam = { killerId: engine.lastKiller?.id ?? null, t: 0.95, elapsed: 0, checkpoint };
    },
    onSectionChange: () => {},
    onFinish: () => {
      player.stop();
      const p = playerScreenPos();
      engine.particles.spawn(renderer.widthCss * 0.3, p.y - renderer.cellPx, 20, { speed: 220, life: 0.8, color: '#4dffea', size: 4 });
      engine.particles.spawn(renderer.widthCss * 0.6, p.y - renderer.cellPx * 1.4, 20, { speed: 220, life: 0.8, color: '#ffd166', size: 4 });
      engine.particles.spawn(renderer.widthCss * 0.8, p.y - renderer.cellPx, 20, { speed: 220, life: 0.8, color: '#ff5d8f', size: 4 });
      const recs = finalizeRun(true); // recordes locais + salva fantasma se foi a melhor
      if (turma.active) {
        // Modo Turma: registra 100% para o jogador da vez e já chama o próximo (ou o pódio).
        recordTurmaResult(100, true);
        showTurmaAfterRun();
      } else {
        screens.showOverlay(screens.finishOverlayHtml({
          score: engine.score,
          bestCombo: engine.bestCombo,
          record: !!(recs && (recs.score || recs.combo || recs.progress)),
        }));
        wireFinishOverlay();
      }
    },
  }, currentMode);

  // Compensação de latência do áudio (calibrada nas configurações): os julgamentos
  // PERFEITO/BOM passam a comparar o toque com o que o jogador realmente ouviu.
  engine.audioOffsetSec = getAudioOffsetMs() / 1000;

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
  // Modo Turma: sair da partida (morte/pausa) encerra a tentativa do jogador da vez.
  const recordedNow =
    turma.active &&
    engine &&
    player &&
    !turmaRunRecorded &&
    !countdownActive &&
    recordTurmaResult(Math.round(latestProgressPct), false);

  finalizeRun(false); // recordes locais (melhor progresso conta mesmo sem terminar)

  countdownActive = false;
  countdown = null;
  deathCam = null;
  cancelAnimationFrame(rafId);
  loopRunning = false;
  player?.stop();
  unlockLandscape();
  screens.hideOverlay();
  app.querySelector('#song-badge')?.classList.add('hidden');
  screens.show('home');
  renderTurmaUI();

  // Se foi uma vez de turma, já chama o próximo jogador (ou o pódio final).
  if (recordedNow) showTurmaAfterRun();
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

  // Grava amostras da corrida para o futuro "fantasma" da melhor tentativa.
  if (!engine.player.dead && !engine.finished) {
    sampleGhost(ghostRec, currentTime, engine.player.y);
  }

  renderFrame(currentTime);

  // Maior progresso da tentativa (placar do modo turma).
  if (level?.durationSec && !engine.finished) {
    latestProgressPct = Math.max(
      latestProgressPct,
      Math.min(100, (currentTime / level.durationSec) * 100)
    );
  }

  // Replay da morte: marca o obstáculo assassino por ~1s antes do overlay.
  if (deathCam) {
    deathCam.elapsed += dt;
    deathCam.t -= dt;
    if (deathCam.killerId != null) {
      const killer = engine
        .getVisibleObstacles(currentTime, renderer.widthCells)
        .find((o) => o.id === deathCam.killerId);
      if (killer) renderer.drawDeathMarker(killer.screenX, deathCam.elapsed);
    }
    if (deathCam.t <= 0) {
      const { checkpoint } = deathCam;
      deathCam = null;
      screens.showOverlay(screens.deathOverlayHtml(checkpoint, { score: engine.score, bestCombo: engine.bestCombo }));
      wireDeathOverlay(checkpoint);
    }
  }
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
  // Fantasma da melhor tentativa correndo junto (mesma música, dado local).
  if (ghostBest) {
    const ghostY = ghostYAt(ghostBest, currentTime);
    if (ghostY != null) renderer.drawGhost(ghostY);
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

// ---------- Modo Turma (placar no mesmo celular) ----------

const turmaEls = {
  name: app.querySelector('#turma-name'),
  add: app.querySelector('#turma-add'),
  list: app.querySelector('#turma-list'),
  toggle: app.querySelector('#turma-toggle'),
  clear: app.querySelector('#turma-clear'),
  status: app.querySelector('#turma-status'),
};

/** Registra o resultado do jogador da vez e avança para o próximo. */
function recordTurmaResult(progressPct, finished) {
  if (!turma.active || !turma.players.length || turma.current >= turma.players.length) return false;
  const name = turma.players[turma.current];
  turma.results = turma.results.filter((r) => r.name !== name); // 1 resultado por jogador por rodada
  turma.results.push({
    name,
    score: engine?.score ?? 0,
    bestCombo: engine?.bestCombo ?? 0,
    progressPct,
    finished,
  });
  turma.current += 1;
  turmaRunRecorded = true;
  saveTurma();
  return true;
}

/** Após uma vez de turma: próximo jogador ("passe o celular") ou pódio final. */
function showTurmaAfterRun() {
  if (turma.current < turma.players.length) {
    screens.showOverlay(
      screens.turmaHandoffHtml({
        name: turma.players[turma.current],
        position: turma.current + 1,
        total: turma.players.length,
      })
    );
    app.querySelector('#btn-turma-play')?.addEventListener('click', () => {
      screens.hideOverlay();
      // Rejoga a MESMA música (buffers ainda em memória) para ser justo.
      if (lastGameBuffers) startGame(lastGameBuffers.audioBuffer, lastGameBuffers.lvl);
    });
    app.querySelector('#btn-turma-end')?.addEventListener('click', () => {
      // Encerrar antes da última vez: fecha a rodada com o placar parcial.
      turma.current = turma.players.length;
      saveTurma();
      if (turma.results.length) {
        showTurmaAfterRun();
      } else {
        turma.active = false;
        saveTurma();
        screens.hideOverlay();
        renderTurmaUI();
      }
    });
  } else {
    const rowsHtml = sortTurmaResults(turma.results)
      .map((r, i) => screens.turmaPodiumRowHtml({ medal: medalFor(i), ...r }))
      .join('');
    screens.showOverlay(screens.turmaPodiumHtml(rowsHtml));
    app.querySelector('#btn-turma-rematch')?.addEventListener('click', () => {
      turma = { ...restartRound(turma), active: true };
      saveTurma();
      screens.hideOverlay();
      renderTurmaUI();
      if (lastGameBuffers) startGame(lastGameBuffers.audioBuffer, lastGameBuffers.lvl);
    });
    app.querySelector('#btn-turma-done')?.addEventListener('click', () => {
      turma.active = false;
      turma.current = 0;
      turma.results = [];
      saveTurma();
      quitToMenu(); // já registrado — a flag impede registro duplo
    });
  }
}

/** Atualiza lista de jogadores, botão de ativação e o status na home. */
function renderTurmaUI() {
  if (!turmaEls.list) return;
  turmaEls.list.innerHTML = '';
  turma.players.forEach((name, i) => {
    const li = document.createElement('li');
    if (turma.active && i === turma.current) li.classList.add('current');
    const span = document.createElement('span');
    span.textContent = turma.active && i === turma.current ? `▶ ${name}` : name;
    li.appendChild(span);
    const rm = document.createElement('button');
    rm.textContent = '✕';
    rm.title = `Remover ${name}`;
    rm.setAttribute('aria-label', `Remover ${name}`);
    rm.addEventListener('click', () => {
      turma.players.splice(i, 1);
      turma.results = turma.results.filter((r) => r.name !== name);
      if (turma.current >= turma.players.length) turma.current = 0;
      saveTurma();
      renderTurmaUI();
    });
    li.appendChild(rm);
    turmaEls.list.appendChild(li);
  });
  turmaEls.toggle.textContent = turma.active ? '⏸ Desativar modo turma' : '▶ Ativar modo turma';
  let status;
  if (!turma.players.length) status = 'Adicione os jogadores para montar a turma.';
  else if (turma.active && turma.current < turma.players.length) {
    status = `Turma ativa — vez de: ${turma.players[turma.current]} (${turma.current + 1}/${turma.players.length}). Escolha a música e jogue!`;
  } else if (turma.active) status = 'Rodada completa! Ative de novo para revanche ou limpe a turma.';
  else status = `${turma.players.length} jogador(es) na turma. Ative e escolha uma música!`;
  turmaEls.status.textContent = status;
}

function addTurmaPlayer() {
  const name = normalizePlayerName(turmaEls.name.value);
  if (!name) return;
  if (!turma.players.includes(name)) turma.players.push(name);
  turmaEls.name.value = '';
  saveTurma();
  renderTurmaUI();
}

turmaEls.add?.addEventListener('click', addTurmaPlayer);
turmaEls.name?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addTurmaPlayer();
});
turmaEls.toggle?.addEventListener('click', () => {
  if (turma.active) {
    turma.active = false;
  } else {
    if (!turma.players.length) {
      turmaEls.status.textContent = 'Adicione pelo menos 1 jogador primeiro 🙂';
      return;
    }
    turma.active = true;
    turma.current = 0;
    turma.results = [];
  }
  saveTurma();
  renderTurmaUI();
});
turmaEls.clear?.addEventListener('click', () => {
  turma = emptyTurma();
  saveTurma();
  renderTurmaUI();
});

// Se o app perde o foco no meio da música, pausa sozinho (evita dessincronia
// entre o relógio do áudio e o jogo ao voltar).
document.addEventListener('visibilitychange', () => {
  if (
    document.hidden &&
    engine &&
    player &&
    !paused &&
    !countdownActive &&
    !engine.player.dead &&
    !engine.finished
  ) {
    togglePause();
  }
});

// ---------- Recordes locais + fantasma ----------

/**
 * Registra o resultado da partida nos recordes locais da música (1x por partida).
 * Se foi a melhor corrida em progresso, salva também o "fantasma" (trajetória).
 * Retorna as flags de recorde (para destacar no overlay de vitória).
 */
function finalizeRun(finished) {
  if (runStatsSaved || !currentTrackMeta || !engine) return null;
  runStatsSaved = true;
  const key = trackKey(currentTrackMeta);
  const progress = finished ? 100 : Math.round(latestProgressPct);
  const { stats, records } = applyRunToStats(loadStats(), key, {
    score: engine.score,
    bestCombo: engine.bestCombo,
    progressPct: progress,
    finished,
  });
  saveStats(stats);
  if (records.progress && progress >= 5 && ghostRec.length > 4) {
    saveGhostFor(key, ghostRec);
  }
  renderRecords();
  return records;
}

/** Seção "🏆 Seus recordes" na home (as 5 músicas mais recentes). */
function renderRecords() {
  const el = app.querySelector('#home-records');
  if (!el) return;
  const top = topPlayed(loadStats(), 5);
  if (!top.length) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML = '<h3>🏆 Seus recordes</h3>';
  const ul = document.createElement('ul');
  for (const [key, s] of top) {
    const [title, artist] = key.split('•');
    const li = document.createElement('li');
    const track = document.createElement('span');
    track.className = 'rec-track';
    track.textContent = `🎵 ${title}${artist ? ' — ' + artist : ''}`;
    const st = document.createElement('span');
    st.className = 'rec-stats';
    st.textContent = `${s.bestProgressPct}% · ${s.bestScore} pts · ${s.bestCombo}x${s.finishes ? ' · 🏁' : ''}`;
    li.append(track, st);
    ul.appendChild(li);
  }
  el.appendChild(ul);
}

// ---------- Calibração de latência ----------

const latencyValueEl = app.querySelector('#latency-value');
function refreshLatencyLabel() {
  if (latencyValueEl) latencyValueEl.textContent = `${getAudioOffsetMs()} ms`;
}

function startLatencyCalibration() {
  if (calibration) return;
  const ctx = getAudioContext();
  ctx.resume?.();

  const N = 8;
  const interval = 0.6; // 100 BPM
  const startAt = ctx.currentTime + 0.8;
  const tickTimes = [];
  const tapTimes = [];

  // Agenda os bipes (o 1º mais agudo, como referência de "começou").
  const master = ctx.createGain();
  master.gain.value = 0.25;
  master.connect(ctx.destination);
  for (let i = 0; i < N; i++) {
    const t = startAt + i * interval;
    tickTimes.push(t);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = i === 0 ? 1400 : 1000;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.8, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  screens.showOverlay(`
    <div class="overlay-card calibration">
      <h2>🎧 Calibrar latência</h2>
      <p>Toque em qualquer lugar NO RITMO dos ${N} bipes…</p>
      <div class="cal-count"><span id="cal-count">0</span>/${N}</div>
      <button id="btn-cal-cancel" class="secondary">Cancelar</button>
    </div>`);

  const overlayEl = app.querySelector('#overlay');
  const onTap = () => {
    if (!calibration) return;
    const tNow = ctx.currentTime;
    if (tNow < startAt - 0.45 || tNow > startAt + (N - 1) * interval + 0.4) return;
    tapTimes.push(tNow);
    const c = app.querySelector('#cal-count');
    if (c) c.textContent = String(tapTimes.length);
    sfx.jump(); // feedback imediato do toque registrado
  };
  overlayEl.addEventListener('pointerdown', onTap);

  const msUntilFinish = (startAt + (N - 1) * interval + 0.6 - ctx.currentTime) * 1000;
  const finishTimer = setTimeout(finish, msUntilFinish);

  function cleanup() {
    calibration = null;
    clearTimeout(finishTimer);
    overlayEl.removeEventListener('pointerdown', onTap);
    try { master.disconnect(); } catch { /* noop */ }
  }
  function finish() {
    const offsets = matchTapsToTicks(tapTimes, tickTimes);
    const avg = averageOffset(offsets);
    const saved = offsets.length ? setAudioOffsetMs(avg) : getAudioOffsetMs();
    cleanup();
    screens.showOverlay(screens.calibrateResultHtml({ offsetMs: saved, used: offsets.length, total: N }));
    app.querySelector('#btn-cal-close')?.addEventListener('click', () => screens.hideOverlay());
    refreshLatencyLabel();
  }
  calibration = {
    cancel: () => { cleanup(); screens.hideOverlay(); },
  };

  app.querySelector('#btn-cal-cancel')?.addEventListener('click', () => calibration?.cancel());
}

app.querySelector('#calibrate-btn')?.addEventListener('click', startLatencyCalibration);

// ---------- Botão "Instalar app" (PWA) ----------

const installBtn = app.querySelector('#install-btn');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  installBtn?.classList.remove('hidden');
});
installBtn?.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  try {
    await deferredInstallPrompt.userChoice;
  } catch {
    /* escolha cancelada/indisponível */
  }
  deferredInstallPrompt = null;
  installBtn?.classList.add('hidden');
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  installBtn?.classList.add('hidden');
});

// ---------- PWA ----------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// Overlay "Gire o celular": cobre a tela em aparelho touch em pé (retrato).
initRotateOverlay(app.querySelector('#rotate-overlay'));

renderTurmaUI();
renderRecords();
refreshLatencyLabel();
screens.show('home');
