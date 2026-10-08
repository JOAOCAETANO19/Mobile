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
import { sfx, vibrate, setSoundEnabled, setHapticsEnabled } from './game/fx.js';
import { createDemoTrackBuffer, DEMO_TRACK_META } from './demo/demotrack.js';
import {
  initializeAuth,
  signUp,
  resendSignupConfirmation,
  signIn,
  signOut,
  onAuthStateChange,
  describeSupabaseError,
} from './core/supabase.js';
import { getLocalRecords, importGuestRecords, saveGameRecord, syncRecords } from './core/records.js';

const app = document.querySelector('#app');
const screens = new Screens(app);

const PLAY_SETTINGS_KEY = 'rhythm-dash.play-settings.v1';
const DEFAULT_PLAY_SETTINGS = {
  mode: MODE.BEAT,
  timingOffsetMs: 0,
  musicVolume: 0.85,
  soundEnabled: true,
  hapticsEnabled: true,
};

function loadPlaySettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(PLAY_SETTINGS_KEY) || '{}');
    return {
      mode: stored.mode === MODE.FREE ? MODE.FREE : MODE.BEAT,
      timingOffsetMs: Math.max(-120, Math.min(120, Number(stored.timingOffsetMs) || 0)),
      musicVolume: Math.max(0, Math.min(1, Number.isFinite(Number(stored.musicVolume)) ? Number(stored.musicVolume) : DEFAULT_PLAY_SETTINGS.musicVolume)),
      soundEnabled: stored.soundEnabled !== false,
      hapticsEnabled: stored.hapticsEnabled !== false,
    };
  } catch {
    return { ...DEFAULT_PLAY_SETTINGS };
  }
}

const playSettings = loadPlaySettings();
function savePlaySettings() {
  try { localStorage.setItem(PLAY_SETTINGS_KEY, JSON.stringify(playSettings)); } catch { /* armazenamento indisponível */ }
}

let currentMode = playSettings.mode;
let engine = null;
let renderer = null;
let player = null;
let level = null;
let activeTrackMeta = null;
let accountUser = null;
let authMode = 'login';
let authBusy = false;
let pendingConfirmationEmail = '';
let authInitializing = true;
let rafId = null;
let judgeState = { text: '', alpha: 0 };
let milestoneState = { text: '', alpha: 0 };
let lastFrameTime = performance.now();

// Contagem regressiva 3-2-1 antes de iniciar/retomar (cenário congelado no ponto de partida).
let countdownActive = false;
let countdown = null;
let pendingStartTime = 0;
let pendingStartLabel = '';
let countdownInterrupted = false;
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
  timingOffset: app.querySelector('#timing-offset'),
  timingOffsetValue: app.querySelector('#timing-offset-value'),
  musicVolume: app.querySelector('#music-volume'),
  musicVolumeValue: app.querySelector('#music-volume-value'),
  soundEnabled: app.querySelector('#sound-enabled'),
  hapticsEnabled: app.querySelector('#haptics-enabled'),
  accountToggle: app.querySelector('#account-toggle'),
  accountPanel: app.querySelector('#account-panel'),
  accountSummary: app.querySelector('#account-summary'),
  authForm: app.querySelector('#auth-form'),
  authTitle: app.querySelector('#auth-title'),
  authDescription: app.querySelector('#auth-description'),
  authNote: app.querySelector('#auth-note'),
  authPasswordHelp: app.querySelector('#auth-password-help'),
  authConfirmation: app.querySelector('#auth-confirmation'),
  authConfirmationEmail: app.querySelector('#auth-confirmation-email'),
  authResend: app.querySelector('#auth-resend'),
  authChangeEmail: app.querySelector('#auth-change-email'),
  authConfirmLogin: app.querySelector('#auth-confirm-login'),
  authSignedOut: app.querySelector('#auth-signed-out'),
  authSignedIn: app.querySelector('#auth-signed-in'),
  authEmail: app.querySelector('#auth-email'),
  authPassword: app.querySelector('#auth-password'),
  authConfirm: app.querySelector('#auth-confirm-password'),
  authConfirmWrap: app.querySelector('#auth-confirm-wrap'),
  authSubmit: app.querySelector('#auth-submit'),
  authModeToggle: app.querySelector('#auth-mode-toggle'),
  authStatus: app.querySelector('#auth-status'),
  accountEmail: app.querySelector('#account-email'),
  authSignout: app.querySelector('#auth-signout-btn'),
  syncRecords: app.querySelector('#sync-records-btn'),
  importLocalRecords: app.querySelector('#import-local-records-btn'),
  localImportHint: app.querySelector('#local-import-hint'),
  recordsList: app.querySelector('#records-list'),
  toast: app.querySelector('#toast'),
};

let toastTimer = null;
function showToast(message, tone = 'info') {
  if (!els.toast) return;
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.dataset.tone = tone;
  els.toast.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  els.toast.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
  els.toast.classList.remove('hidden');
  toastTimer = window.setTimeout(() => els.toast.classList.add('hidden'), 4200);
}

const savedBackend = getBackendConfig();
if (els.backendUrl) els.backendUrl.value = savedBackend.url || '';
if (els.backendKey) els.backendKey.value = savedBackend.key || '';
if (els.modeSelect) els.modeSelect.value = currentMode;
if (els.timingOffset) els.timingOffset.value = String(playSettings.timingOffsetMs);
if (els.timingOffsetValue) els.timingOffsetValue.textContent = `${playSettings.timingOffsetMs > 0 ? '+' : ''}${playSettings.timingOffsetMs} ms`;
if (els.musicVolume) els.musicVolume.value = String(Math.round(playSettings.musicVolume * 100));
if (els.musicVolumeValue) els.musicVolumeValue.textContent = `${Math.round(playSettings.musicVolume * 100)}%`;
if (els.soundEnabled) els.soundEnabled.checked = playSettings.soundEnabled;
if (els.hapticsEnabled) els.hapticsEnabled.checked = playSettings.hapticsEnabled;
setSoundEnabled(playSettings.soundEnabled);
setHapticsEnabled(playSettings.hapticsEnabled);

function setAuthStatus(message = '', tone = 'info') {
  if (!els.authStatus) return;
  els.authStatus.textContent = message;
  if (message) els.authStatus.dataset.tone = tone;
  else delete els.authStatus.dataset.tone;
}

function renderRecordList(records) {
  if (!els.recordsList) return;
  els.recordsList.replaceChildren();
  if (!records?.length) {
    const empty = document.createElement('p');
    empty.className = 'records-empty';
    empty.textContent = 'Ainda não há recordes nesta conta. Jogue uma faixa para salvar o primeiro.';
    els.recordsList.appendChild(empty);
    return;
  }

  for (const record of records.slice(0, 10)) {
    const row = document.createElement('div');
    row.className = 'record-row';
    const track = document.createElement('div');
    track.className = 'record-track';
    const title = document.createElement('strong');
    title.textContent = record.track_title || 'Faixa sem título';
    const artist = document.createElement('span');
    artist.textContent = record.track_artist || (record.completed ? 'Concluída' : 'Recorde pessoal');
    track.append(title, artist);

    const score = document.createElement('div');
    score.className = 'record-score';
    const points = document.createElement('strong');
    points.textContent = `${new Intl.NumberFormat('pt-BR').format(record.score || 0)} pts`;
    const combo = document.createElement('span');
    combo.textContent = `Combo ×${record.best_combo || 0}`;
    score.append(points, combo);
    row.append(track, score);
    els.recordsList.appendChild(row);
  }
}

function setAccountView(user) {
  accountUser = user?.id ? user : null;
  const signedIn = Boolean(accountUser);
  els.authSignedOut?.classList.toggle('hidden', signedIn);
  els.authSignedIn?.classList.toggle('hidden', !signedIn);

  if (signedIn) {
    const records = getLocalRecords(accountUser.id);
    const hasGuestRecords = getLocalRecords().length > 0;
    els.importLocalRecords?.classList.toggle('hidden', !hasGuestRecords);
    els.localImportHint?.classList.toggle('hidden', !hasGuestRecords);
    if (els.accountEmail) els.accountEmail.textContent = accountUser.email || 'Conta conectada';
    if (els.accountToggle) els.accountToggle.textContent = `👤 ${accountUser.email || 'Conta conectada'}`;
    if (els.accountSummary) {
      els.accountSummary.textContent = `${records.length} recorde(s) neste aparelho · conta conectada`;
    }
    renderRecordList(records);
  } else {
    if (authMode !== 'login') setAuthMode('login');
    const records = getLocalRecords();
    els.importLocalRecords?.classList.add('hidden');
    els.localImportHint?.classList.add('hidden');
    if (els.accountToggle) els.accountToggle.textContent = '👤 Entrar';
    if (els.accountSummary) {
      els.accountSummary.textContent = records.length
        ? `${records.length} recorde(s) local(is) · entre e importe-os para a nuvem`
        : 'Entre para salvar seus recordes na nuvem e continuar em outro aparelho.';
    }
    renderRecordList([]);
  }
}

function setAuthMode(mode, { focusEmail = false } = {}) {
  authMode = mode === 'signup' ? 'signup' : 'login';
  pendingConfirmationEmail = '';
  const registering = authMode === 'signup';
  els.authForm?.classList.remove('hidden');
  els.authConfirmation?.classList.add('hidden');
  els.authNote?.classList.remove('hidden');
  els.authPasswordHelp?.classList.toggle('hidden', !registering);
  els.authConfirmWrap?.classList.toggle('hidden', !registering);
  if (els.authTitle) els.authTitle.textContent = registering ? 'Crie sua conta' : 'Entre na sua conta';
  if (els.authDescription) {
    els.authDescription.textContent = registering
      ? 'Cadastre-se para guardar seus recordes e acessá-los em outros aparelhos.'
      : 'Entre para salvar seus recordes e continuar jogando em outro aparelho.';
  }
  if (els.authNote) {
    els.authNote.textContent = registering
      ? 'Enviaremos um link de confirmação para o seu e-mail.'
      : 'Ainda não tem conta? Toque em “Criar conta” para se cadastrar.';
  }
  if (els.authConfirm) {
    els.authConfirm.required = registering;
    els.authConfirm.value = '';
    els.authConfirm.type = 'password';
  }
  if (els.authPassword) {
    els.authPassword.autocomplete = registering ? 'new-password' : 'current-password';
    els.authPassword.placeholder = registering ? 'Mínimo de 8 caracteres' : 'Sua senha';
    if (registering) els.authPassword.setAttribute('aria-describedby', 'auth-password-help');
    else els.authPassword.removeAttribute('aria-describedby');
    els.authPassword.value = '';
    els.authPassword.type = 'password';
  }
  for (const toggle of app.querySelectorAll('.auth-password-toggle')) {
    toggle.textContent = 'Mostrar';
    toggle.setAttribute('aria-pressed', 'false');
    toggle.setAttribute('aria-label', toggle.dataset.passwordTarget === 'auth-password'
      ? 'Mostrar senha'
      : 'Mostrar confirmação da senha');
  }
  if (els.authSubmit) els.authSubmit.textContent = registering ? 'Criar minha conta' : 'Entrar';
  if (els.authModeToggle) els.authModeToggle.textContent = registering ? 'Já tenho conta' : 'Criar conta';
  setAuthStatus('');
  if (focusEmail) els.authEmail?.focus();
}

function showConfirmationView(email, message = 'Quase lá! Confirme o endereço para ativar sua conta.', tone = 'success') {
  pendingConfirmationEmail = String(email || '').trim();
  if (els.authConfirmationEmail) els.authConfirmationEmail.textContent = pendingConfirmationEmail;
  els.authForm?.classList.add('hidden');
  els.authNote?.classList.add('hidden');
  els.authPasswordHelp?.classList.add('hidden');
  els.authConfirmation?.classList.remove('hidden');
  if (els.authTitle) els.authTitle.textContent = 'Quase lá!';
  if (els.authDescription) els.authDescription.textContent = 'Só falta confirmar seu e-mail para proteger sua conta e ativar a sincronização.';
  setAuthStatus(message, tone);
}

function setAuthBusy(busy) {
  authBusy = busy;
  els.authForm?.setAttribute('aria-busy', String(busy));
  els.authConfirmation?.setAttribute('aria-busy', String(busy));
  for (const button of [
    els.authSubmit, els.authModeToggle, els.authResend, els.authChangeEmail, els.authConfirmLogin,
    els.authSignout, els.syncRecords, els.importLocalRecords,
  ]) {
    if (button) button.disabled = busy;
  }
  if (els.authSubmit) {
    els.authSubmit.textContent = busy
      ? (authMode === 'signup' ? 'Criando conta…' : 'Entrando…')
      : (authMode === 'signup' ? 'Criar minha conta' : 'Entrar');
  }
  if (els.authResend) els.authResend.textContent = busy && pendingConfirmationEmail ? 'Enviando link…' : 'Reenviar link';
}

async function refreshCloudRecords({ showStatus = true } = {}) {
  const userId = accountUser?.id;
  if (!userId) return;
  if (showStatus) setAuthStatus('Sincronizando recordes…', 'info');
  try {
    const records = await syncRecords(userId);
    if (accountUser?.id !== userId) return;
    renderRecordList(records);
    if (els.accountSummary) els.accountSummary.textContent = `${records.length} recorde(s) sincronizado(s) na nuvem`;
    if (showStatus) setAuthStatus(`✅ ${records.length} recorde(s) sincronizado(s) com a nuvem.`, 'success');
  } catch (error) {
    if (accountUser?.id !== userId) return;
    renderRecordList(getLocalRecords(userId));
    if (showStatus) setAuthStatus(`⚠️ Não foi possível sincronizar agora. ${describeSupabaseError(error)}`, 'error');
  }
}

els.accountToggle?.addEventListener('click', () => {
  const open = els.accountPanel?.classList.contains('hidden');
  els.accountPanel?.classList.toggle('hidden', !open);
  els.accountToggle?.setAttribute('aria-expanded', String(Boolean(open)));
});

els.authModeToggle?.addEventListener('click', () => {
  setAuthMode(authMode === 'login' ? 'signup' : 'login');
});

app.querySelectorAll('.auth-password-toggle').forEach((button) => {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.passwordTarget);
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.textContent = show ? 'Ocultar' : 'Mostrar';
    button.setAttribute('aria-pressed', String(show));
    button.setAttribute('aria-label', show
      ? (input.id === 'auth-password' ? 'Ocultar senha' : 'Ocultar confirmação da senha')
      : (input.id === 'auth-password' ? 'Mostrar senha' : 'Mostrar confirmação da senha'));
  });
});

els.authResend?.addEventListener('click', async () => {
  if (authBusy || !pendingConfirmationEmail) return;
  setAuthBusy(true);
  setAuthStatus('Enviando novo link de confirmação…', 'info');
  try {
    await resendSignupConfirmation(pendingConfirmationEmail);
    setAuthStatus(`Novo link enviado para ${pendingConfirmationEmail}. Confira também a caixa de spam.`, 'success');
  } catch (error) {
    setAuthStatus(describeSupabaseError(error), 'error');
  } finally {
    setAuthBusy(false);
  }
});

els.authChangeEmail?.addEventListener('click', () => {
  const email = pendingConfirmationEmail;
  if (email && els.authEmail) els.authEmail.value = email;
  setAuthMode('signup', { focusEmail: true });
});

els.authConfirmLogin?.addEventListener('click', () => {
  const email = pendingConfirmationEmail;
  if (email && els.authEmail) els.authEmail.value = email;
  setAuthMode('login');
  els.authPassword?.focus();
});

els.authForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (authBusy) return;
  const email = String(els.authEmail?.value || '').trim();
  const password = String(els.authPassword?.value || '');
  if (!email || !els.authEmail?.validity.valid) {
    setAuthStatus('Informe um endereço de e-mail válido.', 'error');
    els.authEmail?.focus();
    return;
  }
  if (!password || (authMode === 'signup' && password.length < 8)) {
    setAuthStatus(authMode === 'signup' ? 'A senha deve ter pelo menos 8 caracteres.' : 'Informe sua senha.', 'error');
    els.authPassword?.focus();
    return;
  }
  if (authMode === 'signup' && password !== String(els.authConfirm?.value || '')) {
    setAuthStatus('As senhas não coincidem.', 'error');
    els.authConfirm?.focus();
    return;
  }

  setAuthBusy(true);
  setAuthStatus(authMode === 'signup' ? 'Criando sua conta…' : 'Entrando…', 'info');
  let shouldSync = false;
  try {
    if (authMode === 'signup') {
      const result = await signUp(email, password);
      if (els.authPassword) els.authPassword.value = '';
      if (els.authConfirm) els.authConfirm.value = '';
      if (result.session) {
        const user = result.session.user || result.user;
        if (!user?.id) throw new Error('A conta foi criada, mas o Supabase não retornou o usuário da sessão. Tente entrar.');
        setAccountView(user);
        setAuthStatus('✅ Conta criada e conectada. Seus recordes serão sincronizados.', 'success');
        shouldSync = true;
      } else {
        showConfirmationView(email, `Cadastro iniciado. Enviamos um link de confirmação para ${email}.`);
      }
    } else {
      const session = await signIn(email, password);
      if (els.authPassword) els.authPassword.value = '';
      if (!session.user?.id) throw new Error('O Supabase não retornou os dados da conta. Tente novamente.');
      setAccountView(session.user);
      setAuthStatus('✅ Login realizado. Buscando seus recordes na nuvem…', 'success');
      shouldSync = true;
    }
  } catch (error) {
    const emailNeedsConfirmation = error?.code === 'email_not_confirmed'
      || /email not confirmed|email_not_confirmed/i.test(String(error?.message || ''));
    if (authMode === 'login' && emailNeedsConfirmation) {
      if (els.authPassword) els.authPassword.value = '';
      showConfirmationView(email, 'Este e-mail ainda não foi confirmado. Reenvie o link para ativar a conta.', 'info');
    } else {
      setAuthStatus(describeSupabaseError(error), 'error');
    }
  } finally {
    setAuthBusy(false);
  }
  if (shouldSync) await refreshCloudRecords({ showStatus: true });
});

els.authSignout?.addEventListener('click', async () => {
  if (authBusy) return;
  setAuthBusy(true);
  await signOut();
  setAccountView(null);
  setAuthStatus('Sessão encerrada neste aparelho.', 'success');
  setAuthBusy(false);
});

els.syncRecords?.addEventListener('click', () => refreshCloudRecords({ showStatus: true }));

els.importLocalRecords?.addEventListener('click', async () => {
  const userId = accountUser?.id;
  if (!userId || authBusy) return;
  setAuthBusy(true);
  setAuthStatus('Importando e sincronizando os recordes locais…', 'info');
  try {
    const records = await importGuestRecords(userId);
    if (accountUser?.id !== userId) return;
    renderRecordList(records);
    els.importLocalRecords?.classList.add('hidden');
    els.localImportHint?.classList.add('hidden');
    if (els.accountSummary) els.accountSummary.textContent = `${records.length} recorde(s) sincronizado(s) na nuvem`;
    setAuthStatus(`✅ ${records.length} recorde(s) local(is) importado(s) para esta conta.`, 'success');
  } catch (error) {
    setAuthStatus(`⚠️ A importação não terminou. ${describeSupabaseError(error)}`, 'error');
  } finally {
    setAuthBusy(false);
  }
});

onAuthStateChange((session) => {
  const nextUser = session?.user?.id ? session.user : null;
  if ((nextUser?.id || null) === (accountUser?.id || null)) return;
  setAccountView(nextUser);
  if (nextUser?.id && !authBusy && !authInitializing) {
    void refreshCloudRecords({ showStatus: false });
  }
});

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (accountUser?.id) void refreshCloudRecords({ showStatus: false });
  });
}

setAuthMode('login');

async function initializeAccount() {
  const result = await initializeAuth();
  authInitializing = false;
  setAccountView(result.session?.user || null);
  if (result.notice || result.error) {
    els.accountPanel?.classList.remove('hidden');
    els.accountToggle?.setAttribute('aria-expanded', 'true');
  }
  if (result.notice) setAuthStatus(result.notice, 'success');
  else if (result.error) setAuthStatus(describeSupabaseError(result.error), 'error');
  if (result.session?.user?.id) {
    await refreshCloudRecords({ showStatus: !result.notice && !result.error });
  }
}

void initializeAccount().catch((error) => {
  authInitializing = false;
  setAuthStatus(describeSupabaseError(error), 'error');
});

els.modeSelect?.addEventListener('change', () => {
  currentMode = els.modeSelect.value === 'free' ? MODE.FREE : MODE.BEAT;
  playSettings.mode = currentMode;
  savePlaySettings();
});

els.timingOffset?.addEventListener('input', () => {
  playSettings.timingOffsetMs = Number(els.timingOffset.value) || 0;
  if (els.timingOffsetValue) els.timingOffsetValue.textContent = `${playSettings.timingOffsetMs > 0 ? '+' : ''}${playSettings.timingOffsetMs} ms`;
});
els.timingOffset?.addEventListener('change', savePlaySettings);

els.musicVolume?.addEventListener('input', () => {
  playSettings.musicVolume = Math.max(0, Math.min(1, Number(els.musicVolume.value) / 100));
  if (els.musicVolumeValue) els.musicVolumeValue.textContent = `${Math.round(playSettings.musicVolume * 100)}%`;
  player?.setVolume(playSettings.musicVolume);
});
els.musicVolume?.addEventListener('change', savePlaySettings);

els.soundEnabled?.addEventListener('change', () => {
  playSettings.soundEnabled = els.soundEnabled.checked;
  setSoundEnabled(playSettings.soundEnabled);
  savePlaySettings();
});
els.hapticsEnabled?.addEventListener('change', () => {
  playSettings.hapticsEnabled = els.hapticsEnabled.checked;
  setHapticsEnabled(playSettings.hapticsEnabled);
  savePlaySettings();
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
  if (!query) {
    showToast('Digite um artista, uma música ou cole um link para buscar.', 'info');
    els.searchInput?.focus();
    return;
  }
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
    const track = { source: 'direct', id: query, title: 'Link direto', artist: 'Link direto', duration: 0, fullTrackAvailable: true, streamUrl: query };
    els.results.innerHTML = '';
    const card = document.createElement('button');
    card.className = 'track-card';
    card.innerHTML = `<div class="cover-placeholder">🔗</div><div class="track-info"><strong>Tocar link direto</strong><span>${escapeHtmlLocal(query)}</span></div>`;
    card.addEventListener('click', () => pickTrack(track));
    els.results.appendChild(card);
    return;
  }

  try {
    const [backend, sources] = await Promise.all([
      backendSearch(query),
      searchAllSources(query),
    ]);
    screens.renderSearchResults(els.results, { backend, ...sources }, pickTrack);
  } catch (error) {
    console.error('Falha ao buscar faixas:', error);
    els.results.innerHTML = '<p class="empty">Não foi possível concluir a busca. Confira sua conexão e tente novamente.</p>';
    showToast('A busca falhou. Confira sua conexão e tente novamente.', 'error');
  }
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
      screens.show('home');
      showToast('Esta fonte não disponibiliza áudio para jogar. Tente outro resultado ou carregue um arquivo.', 'error');
      return;
    }

    const audioBuffer = await loadAudioBufferFromUrl(url, (p) => screens.setLoadingProgress(0.1 + p * 0.6));
    await runAnalysisAndStart(audioBuffer, track);
  } catch (err) {
    console.error('Não consegui carregar a faixa:', err);
    screens.show('home');
    showToast('Não consegui carregar esta faixa. Confira sua conexão ou tente outra fonte.', 'error');
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
      source: 'youtube',
      id: extractYoutubeId(input) || input,
      title: resolved.title || 'YouTube',
      artist: resolved.artist || '',
      duration: resolved.duration || audioBuffer.duration,
    });
  } catch (err) {
    console.error('Não consegui preparar o áudio do vídeo:', err);
    screens.show('home');
    showToast('Não consegui preparar o áudio deste vídeo. Verifique o link e o servidor de extração.', 'error');
  }
}

async function startGameFromFile(file) {
  try {
    screens.show('loading');
    screens.setLoadingText(`Analisando "${file.name}"…`);
    screens.setLoadingProgress(0.1);
    const audioBuffer = await loadAudioBufferFromFile(file);
    await runAnalysisAndStart(audioBuffer, {
      source: 'file',
      id: `${file.name}:${file.size}`,
      title: file.name,
      artist: 'Arquivo local',
      duration: audioBuffer.duration,
    });
  } catch (err) {
    console.error('Não consegui ler o arquivo de áudio:', err);
    screens.show('home');
    showToast('Não consegui ler esse áudio. Escolha um arquivo MP3, M4A, WAV ou OGG.', 'error');
  } finally {
    // Permite selecionar o mesmo arquivo novamente após um erro ou outra partida.
    if (els.fileInput) els.fileInput.value = '';
  }
}

async function startGameFromDemo() {
  try {
    screens.show('loading');
    screens.setLoadingText('Preparando faixa de demonstração…');
    screens.setLoadingProgress(0.2);
    const ctx = getAudioContext();
    const buffer = createDemoTrackBuffer(ctx);
    await runAnalysisAndStart(buffer, DEMO_TRACK_META);
  } catch (error) {
    console.error('Não consegui iniciar a demo:', error);
    screens.show('home');
    showToast('Não foi possível iniciar a demo neste aparelho. Tente novamente.', 'error');
  }
}

async function runAnalysisAndStart(audioBuffer, trackMeta) {
  screens.setLoadingText('Detectando kicks graves e alinhando o mapa…');
  screens.setLoadingProgress(0.75);
  // Cede o frame para o navegador pintar a barra de progresso antes do trabalho pesado.
  await new Promise((r) => setTimeout(r, 30));

  const analysis = analyzeAudioBuffer(audioBuffer);
  screens.setLoadingProgress(0.9);
  level = generateLevel(analysis, trackMeta, currentMode);
  activeTrackMeta = { ...trackMeta };
  screens.setLoadingProgress(1);

  startGame(audioBuffer, level);
}

// ---------- Jogo ----------

async function persistCurrentRun(completed = false) {
  if (!engine || !activeTrackMeta) return null;
  if (!completed && engine.score <= 0 && engine.bestCombo <= 0) return null;
  const userId = accountUser?.id || null;
  const result = await saveGameRecord({
    trackMeta: activeTrackMeta,
    score: engine.score,
    bestCombo: engine.bestCombo,
    completed,
    userId,
  });
  if (userId && accountUser?.id === userId) {
    renderRecordList(result.records);
    if (els.accountSummary) {
      els.accountSummary.textContent = result.synced
        ? `${result.records.length} recorde(s) sincronizado(s) na nuvem`
        : `${result.records.length} recorde(s) local(is) · sincronização pendente`;
    }
  } else if (!userId && !accountUser) {
    const count = getLocalRecords().length;
    if (els.accountSummary) {
      els.accountSummary.textContent = `${count} recorde(s) local(is) · entre para sincronizar entre aparelhos`;
    }
  }
  if (!result.synced && result.error) console.warn('Recorde salvo localmente; sincronização será tentada depois:', result.error);
  return result;
}

function startGame(audioBuffer, lvl) {
  stopLoop();
  paused = false;
  judgeState = { text: '', alpha: 0 };
  milestoneState = { text: '', alpha: 0 };
  screens.hideOverlay();
  screens.show('game');
  const canvas = app.querySelector('#game-canvas');
  renderer = new Renderer(canvas);
  player = new SyncedPlayer(audioBuffer);
  player.setVolume(playSettings.musicVolume);

  engine = new GameEngine(lvl, {
    onJudge: (judge) => {
      judgeState = { text: judge === 'PERFECT' ? 'PERFEITO!' : 'BOM', alpha: 1 };
      if (judge === 'PERFECT') sfx.perfect();
      else sfx.good();
      vibrate(judge === 'PERFECT' ? 18 : 8);
    },
    onTapMiss: (deltaMs) => {
      judgeState = { text: deltaMs < 0 ? 'CEDO DEMAIS' : 'ATRASADO', alpha: 0.9 };
      sfx.miss();
    },
    onNearMiss: () => {
      sfx.nearMiss();
      judgeState = { text: 'QUASE! 💨', alpha: 1 };
      renderer.shake('light');
      const p = playerScreenPos();
      engine.particles.spawn(p.x + renderer.cellPx * 0.4, p.y, 8, { speed: 160, life: 0.35, color: '#c9d4ff', size: 2.5 });
    },
    onOrb: () => { sfx.orb(); },
    onPad: () => { sfx.pad(); },
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
      void persistCurrentRun(false).catch((error) => console.warn('Não consegui salvar o recorde:', error));
      screens.showOverlay(screens.deathOverlayHtml(checkpoint, { score: engine.score, bestCombo: engine.bestCombo }));
      wireDeathOverlay(checkpoint);
    },
    onSectionChange: () => {},
    onFinish: () => {
      player.stop();
      void persistCurrentRun(true).catch((error) => console.warn('Não consegui salvar o recorde:', error));
      const p = playerScreenPos();
      engine.particles.spawn(renderer.widthCss * 0.3, p.y - renderer.cellPx, 20, { speed: 220, life: 0.8, color: '#4dffea', size: 4 });
      engine.particles.spawn(renderer.widthCss * 0.6, p.y - renderer.cellPx * 1.4, 20, { speed: 220, life: 0.8, color: '#ffd166', size: 4 });
      engine.particles.spawn(renderer.widthCss * 0.8, p.y - renderer.cellPx, 20, { speed: 220, life: 0.8, color: '#ff5d8f', size: 4 });
      screens.showOverlay(screens.finishOverlayHtml({ score: engine.score, bestCombo: engine.bestCombo }));
      wireFinishOverlay();
    },
  }, currentMode);

  // A música só começa após a contagem regressiva 3-2-1, com instrução contextual.
  lastFrameTime = performance.now();
  beginCountdown(0, currentMode === MODE.BEAT ? 'Toque na batida para pular' : 'Toque na tela para pular');
  ensureLoop();
}

/**
 * Contagem regressiva 3-2-1 antes de iniciar/retomar: a cena fica congelada no
 * ponto de partida e o áudio (única fonte de verdade do tempo) só começa no fim.
 */
function beginCountdown(startTime, label) {
  pendingStartTime = startTime;
  pendingStartLabel = label;
  countdownInterrupted = false;
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
  if (loopRunning) return;
  loopRunning = true;
  lastFrameTime = performance.now();
  rafId = requestAnimationFrame(loop);
}

function stopLoop() {
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
  loopRunning = false;
}

function onTap() {
  if (!engine || !player || paused) return;
  if (countdownActive || engine.player.dead || engine.finished) return;
  const wasJumping = engine.player.jumping;
  const timingOffset = engine.mode === MODE.BEAT ? playSettings.timingOffsetMs / 1000 : 0;
  engine.tap(player.getCurrentTime() + timingOffset);
  if (!wasJumping && engine.player.jumping && engine.mode === MODE.FREE) sfx.jump();
}

function onKeydown(e) {
  if (!isGameScreenVisible()) return;
  if (e.code === 'Escape') {
    e.preventDefault();
    togglePause();
    return;
  }
  if (e.code === 'Space' && !e.repeat && !e.target.closest?.('button, input, textarea, select')) {
    e.preventDefault();
    onTap();
  }
}

let paused = false;
function isGameScreenVisible() {
  return !screens.els.game.classList.contains('hidden');
}

function togglePause() {
  if (countdownActive || !engine || engine.player.dead || engine.finished) return;
  paused = !paused;
  if (paused) {
    stopLoop();
    void player.ctx.suspend();
    screens.showOverlay(screens.pauseOverlayHtml());
    wirePauseOverlay();
  } else {
    void player.ctx.resume();
    screens.hideOverlay();
    ensureLoop();
  }
}

function wirePauseOverlay() {
  app.querySelector('#btn-continue')?.addEventListener('click', () => {
    if (!paused || !player) return;
    paused = false;
    void player.ctx.resume();
    screens.hideOverlay();
    ensureLoop();
    app.querySelector('#pause-btn')?.focus({ preventScroll: true });
  });
  app.querySelector('#btn-restart')?.addEventListener('click', () => {
    if (!engine || !player) return;
    player.stop();
    engine.reset(0);
    paused = false;
    screens.hideOverlay();
    beginCountdown(0, currentMode === MODE.BEAT ? 'Toque na batida para pular' : 'Toque na tela para pular');
    ensureLoop();
  });
  app.querySelector('#btn-quit')?.addEventListener('click', quitToMenu);
}

const gameScreen = app.querySelector('#screen-game');
gameScreen?.addEventListener('pointerdown', (event) => {
  if (!isGameScreenVisible() || paused || event.target.closest?.('#pause-btn')) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault();
  onTap();
}, { passive: false });
gameScreen?.addEventListener('contextmenu', (event) => event.preventDefault());
app.querySelector('#pause-btn')?.addEventListener('click', togglePause);
window.addEventListener('keydown', onKeydown);
window.addEventListener('resize', () => renderer?.resize());

function handleVisibilityChange() {
  if (document.hidden) {
    if (countdownActive) {
      countdownActive = false;
      countdown = null;
      countdownInterrupted = true;
      stopLoop();
      screens.hideOverlay();
    } else if (isGameScreenVisible() && !paused && engine && player?.playing && !engine.player.dead && !engine.finished) {
      togglePause();
    }
    return;
  }
  if (countdownInterrupted && isGameScreenVisible() && engine && !engine.player.dead && !engine.finished) {
    beginCountdown(pendingStartTime, pendingStartLabel);
    ensureLoop();
  }
}
document.addEventListener('visibilitychange', handleVisibilityChange);

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
  void persistCurrentRun(false).catch((error) => console.warn('Não consegui salvar o recorde:', error));
  countdownActive = false;
  countdownInterrupted = false;
  countdown = null;
  paused = false;
  stopLoop();
  player?.stop();
  screens.hideOverlay();
  screens.show('home');
  player = null;
  engine = null;
  renderer = null;
  level = null;
  activeTrackMeta = null;
}

function loop() {
  if (paused || !engine || !player || engine.player.dead || engine.finished || !isGameScreenVisible()) {
    loopRunning = false;
    rafId = null;
    return;
  }
  rafId = requestAnimationFrame(loop);

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
    progressPct: Math.max(0, Math.min(100, (currentTime / engine.level.durationSec) * 100)),
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
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

screens.show('home');
