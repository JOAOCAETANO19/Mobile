// Parser do yt-dlp + rankeamento por duração (testável sem precisar do binário instalado).

/**
 * Faz o parse da saída JSON de `yt-dlp --dump-json` (uma linha por resultado) para o
 * formato usado pela API do backend.
 */
export function parseYtDlpJsonLines(stdout) {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const results = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      results.push({
        id: obj.id,
        title: obj.title,
        artist: obj.uploader || obj.channel || '',
        duration: obj.duration || 0,
        thumbnail: obj.thumbnail || (obj.thumbnails?.[obj.thumbnails.length - 1]?.url ?? null),
        webpageUrl: obj.webpage_url || obj.original_url || null,
      });
    } catch (e) {
      // ignora linhas inválidas (avisos do yt-dlp podem ir para stdout em alguns casos)
    }
  }
  return results;
}

/**
 * Rankeia resultados de busca por proximidade da duração alvo (quando fornecida), para
 * o "▶▶" priorizar a versão de estúdio/álbum em vez de covers/lives muito diferentes.
 */
export function rankByDuration(results, targetDurationSec) {
  if (!targetDurationSec) return results;
  return [...results].sort((a, b) => {
    const da = Math.abs((a.duration || 0) - targetDurationSec);
    const db = Math.abs((b.duration || 0) - targetDurationSec);
    return da - db;
  });
}

/** Constrói os argumentos de busca do yt-dlp para N resultados de um termo. */
export function buildSearchArgs(query, limit = 8) {
  return [
    `ytsearch${limit}:${query}`,
    '--dump-json',
    '--no-playlist',
    '--skip-download',
    '--no-warnings',
  ];
}

/** Constrói os argumentos para extrair a melhor URL de áudio de um vídeo específico. */
export function buildStreamArgs(videoIdOrUrl) {
  const url = /^https?:\/\//.test(videoIdOrUrl)
    ? videoIdOrUrl
    : `https://www.youtube.com/watch?v=${videoIdOrUrl}`;
  return [url, '-f', 'bestaudio/best', '--no-playlist', '-g', '--no-warnings'];
}
