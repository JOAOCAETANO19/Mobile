// Mulberry32 - PRNG determinístico, rápido e com boa distribuição para geração de níveis.
// A mesma seed sempre produz a mesma sequência -> mapas reprodutíveis para a mesma música.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash simples (djb2) de string -> uint32, usado como seed a partir do nome/duração da faixa.
export function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

// Cria um gerador determinístico a partir de metadados da faixa (título+artista+duração).
export function seedFromTrack(track) {
  const key = `${track?.title || ''}|${track?.artist || ''}|${Math.round(track?.duration || 0)}`;
  return hashString(key);
}

export function createRng(seedValue) {
  const seed = typeof seedValue === 'number' ? seedValue >>> 0 : hashString(String(seedValue));
  return mulberry32(seed);
}
