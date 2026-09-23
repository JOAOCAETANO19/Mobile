// Modo paisagem (landscape) no celular:
// - overlay "Gire o celular" cobre a tela quando um aparelho touch está em pé (retrato);
// - screen.orientation.lock('landscape') ao iniciar o jogo (o Chrome Android exige
//   tela cheia para permitir o travamento; em PWA instalado funciona direto);
// - desbloqueio ao voltar ao menu.
// Navegadores sem suporte ao lock (ex.: Safari do iOS) ficam cobertos pelo overlay.
// Módulo sem efeitos colaterais no import (seguro para testes em Node).

/** True em aparelhos com ponteiro "grosseiro" (touch) — celulares/tablets. */
export function isCoarsePointer() {
  try {
    if (window.matchMedia?.('(pointer: coarse)')?.matches) return true;
  } catch {
    /* matchMedia indisponível — cai nos fallbacks */
  }
  try {
    return 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
  } catch {
    return false;
  }
}

/** True quando a viewport está mais alta do que larga (retrato). */
export function isPortrait() {
  try {
    if (window.matchMedia?.('(orientation: portrait)')?.matches) return true;
    if (window.matchMedia?.('(orientation: landscape)')?.matches) return false;
  } catch {
    /* fallback geométrico abaixo */
  }
  return window.innerHeight >= window.innerWidth;
}

/** Mostra/esconde o overlay "Gire o celular" (só em aparelho touch em pé). */
export function updateRotateOverlay(el) {
  if (!el) return;
  el.classList.toggle('visible', isCoarsePointer() && isPortrait());
}

/**
 * Liga/desliga o overlay conforme a orientação da viewport.
 * Retorna a função de atualização (útil para forçar uma checagem).
 */
export function initRotateOverlay(el) {
  const update = () => updateRotateOverlay(el);
  update();
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  try {
    // Alguns navegadores disparam 'resize' antes da viewport atualizar.
    screen.orientation?.addEventListener?.('change', update);
  } catch {
    /* Screen Orientation API indisponível — resize/orientationchange bastam */
  }
  return update;
}

/**
 * Tenta travar a tela em paisagem. No Chrome Android o lock só vale com a página
 * em tela cheia — daí o requestFullscreen antes. Qualquer falha é engolida:
 * o overlay "Gire o celular" assume como fallback (ex.: Safari do iOS).
 * Retorna true se a orientação ficou travada em paisagem.
 */
export async function lockLandscape() {
  if (!isCoarsePointer()) return false;
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
  } catch {
    /* tela cheia negada/sem gesto do usuário — o lock ainda pode valer em PWA */
  }
  try {
    if (screen.orientation?.lock) {
      await screen.orientation.lock('landscape');
      return true;
    }
  } catch {
    /* sem suporte ao lock — o overlay cobre esses navegadores */
  }
  return false;
}

/** Desfaz o travamento e sai da tela cheia (volta ao menu / fim de jogo). */
export async function unlockLandscape() {
  try {
    screen.orientation?.unlock?.();
  } catch {
    /* noop */
  }
  try {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
  } catch {
    /* noop */
  }
}
