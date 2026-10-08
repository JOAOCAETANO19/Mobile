// Telas do app: home (busca/link/arquivo), loading (análise), jogo (HUD/canvas) e overlays
// (pausa, morte com checkpoint, vitória). Gerência simples de visibilidade por classe CSS.

export class Screens {
  constructor(root) {
    this.root = root;
    this.els = {
      home: root.querySelector('#screen-home'),
      loading: root.querySelector('#screen-loading'),
      game: root.querySelector('#screen-game'),
      overlay: root.querySelector('#overlay'),
    };
    this.els.overlay?.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const focusable = [...this.els.overlay.querySelectorAll(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
      )];
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  show(name) {
    for (const [key, el] of Object.entries(this.els)) {
      if (!el || key === 'overlay') continue;
      el.classList.toggle('hidden', key !== name);
    }
  }

  setLoadingText(text) {
    const el = this.root.querySelector('#loading-text');
    if (el) el.textContent = text;
  }

  setLoadingProgress(pct) {
    const bar = this.root.querySelector('#loading-bar');
    if (bar) bar.style.width = `${Math.round(pct * 100)}%`;
  }

  showOverlay(html) {
    const overlay = this.els.overlay;
    overlay.innerHTML = html;
    overlay.classList.remove('hidden', 'overlay-countdown');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    const heading = overlay.querySelector('.overlay-card h2');
    if (heading) overlay.setAttribute('aria-label', heading.textContent.trim());
    overlay.querySelector('.overlay-actions button')?.focus({ preventScroll: true });
  }

  /** Overlay mais leve (a cena congelada aparece por trás) para a contagem 3-2-1. */
  showCountdown(html) {
    const overlay = this.els.overlay;
    overlay.innerHTML = html;
    overlay.classList.remove('hidden');
    overlay.classList.add('overlay-countdown');
    overlay.setAttribute('aria-live', 'assertive');
    overlay.setAttribute('aria-atomic', 'true');
  }

  hideOverlay() {
    const overlay = this.els.overlay;
    overlay.classList.add('hidden');
    overlay.classList.remove('overlay-countdown');
    overlay.removeAttribute('role');
    overlay.removeAttribute('aria-modal');
    overlay.removeAttribute('aria-label');
    overlay.removeAttribute('aria-live');
    overlay.removeAttribute('aria-atomic');
  }

  countdownHtml(number, label) {
    return `
      <div class="countdown-box">
        ${label ? `<p class="countdown-label">${label}</p>` : ''}
        <div class="countdown-num">${number}</div>
      </div>
    `;
  }

  renderSearchResults(container, groups, onPick) {
    container.innerHTML = '';

    const renderGroup = (title, items, badge) => {
      if (!items || !items.length) return;
      const section = document.createElement('div');
      section.className = 'result-group';
      const heading = document.createElement('h3');
      heading.textContent = title;
      section.appendChild(heading);

      for (const track of items) {
        const card = document.createElement('button');
        card.className = 'track-card';
        card.innerHTML = `
          ${track.cover ? `<img src="${track.cover}" alt="" loading="lazy" />` : '<div class="cover-placeholder">🎵</div>'}
          <div class="track-info">
            <strong>${escapeHtml(track.title || 'Sem título')}</strong>
            <span>${escapeHtml(track.artist || '')}</span>
            ${badge ? `<em class="badge">${badge}</em>` : ''}
          </div>
        `;
        card.addEventListener('click', () => onPick(track));
        section.appendChild(card);
      }
      container.appendChild(section);
    };

    renderGroup('🖥️ Seu servidor', groups.backend, 'Música completa');
    renderGroup('🌐 Música completa (Audius/Archive)', groups.fullTrack, 'Completa · aberta');
    renderGroup('🎧 Spotify', groups.spotify, 'Prévia 30s / ▶▶ completa');
    renderGroup('Deezer', groups.deezer, 'Prévia 30s');
    renderGroup('iTunes', groups.itunes, 'Prévia 30s');

    if (!container.children.length) {
      container.innerHTML = '<p class="empty">Nenhum resultado. Tente outro termo, cole um link, ou envie um arquivo.</p>';
    }
  }

  deathOverlayHtml({ time, label, progressPct }, { score, bestCombo }) {
    return `
      <div class="overlay-card">
        <h2>💥 Você caiu!</h2>
        <p>Pontuação: <strong>${score}</strong> · Melhor combo: <strong>${bestCombo}x</strong></p>
        <div class="overlay-actions">
          <button id="btn-resume-checkpoint">Retomar do ${label.toUpperCase()} · ${progressPct}%</button>
          <button id="btn-restart" class="secondary">Recomeçar do início</button>
          <button id="btn-quit" class="secondary">Voltar ao menu</button>
        </div>
      </div>
    `;
  }

  pauseOverlayHtml() {
    return `
      <div class="overlay-card">
        <span class="overlay-eyebrow">RHYTHM DASH</span>
        <h2>⏸️ Jogo pausado</h2>
        <p>A música está em pausa. Quando voltar, toque na tela no ritmo para pular.</p>
        <div class="overlay-actions">
          <button id="btn-continue">Continuar jogando</button>
          <button id="btn-restart" class="secondary">Recomeçar faixa</button>
          <button id="btn-quit" class="secondary">Voltar ao menu</button>
        </div>
      </div>
    `;
  }

  finishOverlayHtml({ score, bestCombo }) {
    return `
      <div class="overlay-card">
        <h2>🏁 Música concluída!</h2>
        <p>Pontuação final: <strong>${score}</strong> · Melhor combo: <strong>${bestCombo}x</strong></p>
        <div class="overlay-actions">
          <button id="btn-play-again">Jogar de novo</button>
          <button id="btn-quit" class="secondary">Voltar ao menu</button>
        </div>
      </div>
    `;
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
