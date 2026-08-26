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
    this.els.overlay.innerHTML = html;
    this.els.overlay.classList.remove('hidden');
  }

  hideOverlay() {
    this.els.overlay.classList.add('hidden');
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
        <h2>⏸️ Pausado</h2>
        <div class="overlay-actions">
          <button id="btn-continue">Continuar</button>
          <button id="btn-mode-toggle" class="secondary">Trocar modo</button>
          <button id="btn-quit" class="secondary">Sair para o menu</button>
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
