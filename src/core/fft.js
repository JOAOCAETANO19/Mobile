// FFT radix-2 (Cooley-Tukey) implementada em JS puro, sem dependências.
// Roda igual no navegador e no Node -> permite testar o pipeline de áudio com `node --test`.

/** Verifica se n é potência de 2. */
export function isPowerOfTwo(n) {
  return n > 0 && (n & (n - 1)) === 0;
}

/** Próxima potência de 2 >= n. */
export function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * FFT in-place radix-2 Cooley-Tukey.
 * @param {Float64Array} re parte real (tamanho N, potência de 2)
 * @param {Float64Array} im parte imaginária (tamanho N)
 */
export function fft(re, im) {
  const n = re.length;
  if (!isPowerOfTwo(n)) {
    throw new Error(`fft: tamanho deve ser potência de 2, recebido ${n}`);
  }
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      let tr = re[i]; re[i] = re[j]; re[j] = tr;
      let ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  // Butterfly
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curWr = 1, curWi = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curWr - im[i + k + len / 2] * curWi;
        const vIm = re[i + k + len / 2] * curWi + im[i + k + len / 2] * curWr;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextWr = curWr * wr - curWi * wi;
        const nextWi = curWr * wi + curWi * wr;
        curWr = nextWr;
        curWi = nextWi;
      }
    }
  }
}

/** Janela de Hann (reduz vazamento espectral). */
export function hannWindow(size) {
  const w = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  return w;
}

/**
 * Calcula o espectro de magnitude de um bloco de samples (aplica janela + FFT).
 * @param {Float32Array|Float64Array} samples tamanho = fftSize
 * @param {Float64Array} window janela pré-computada (mesmo tamanho)
 * @returns {Float64Array} magnitudes (tamanho fftSize/2)
 */
export function magnitudeSpectrum(samples, window) {
  const n = samples.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    re[i] = samples[i] * window[i];
  }
  fft(re, im);
  const half = n >> 1;
  const mags = new Float64Array(half);
  for (let i = 0; i < half; i++) {
    mags[i] = Math.hypot(re[i], im[i]);
  }
  return mags;
}
