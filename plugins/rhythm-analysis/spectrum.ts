/** Original radix-2 FFT for the small fixed-size analysis window. No runtime dependencies. */
export function spectrumTransform(size: number) {
  const real = new Float64Array(size),
    imag = new Float64Array(size),
    cos = new Float64Array(size / 2),
    sin = new Float64Array(size / 2);
  for (let i = 0; i < size / 2; i++) {
    cos[i] = Math.cos((-2 * Math.PI * i) / size);
    sin[i] = Math.sin((-2 * Math.PI * i) / size);
  }
  return {
    real,
    magnitude() {
      imag.fill(0);
      for (let i = 1, j = 0; i < size; i++) {
        let bit = size >> 1;
        while (j & bit) {
          j ^= bit;
          bit >>= 1;
        }
        j ^= bit;
        if (i < j) {
          const temp = real[i];
          real[i] = real[j];
          real[j] = temp;
        }
      }
      for (let length = 2; length <= size; length <<= 1) {
        const half = length / 2,
          stride = size / length;
        for (let start = 0; start < size; start += length)
          for (let j = 0; j < half; j++) {
            const a = start + j,
              b = a + half,
              k = j * stride;
            const re = real[b] * cos[k] - imag[b] * sin[k],
              im = real[b] * sin[k] + imag[b] * cos[k];
            real[b] = real[a] - re;
            imag[b] = imag[a] - im;
            real[a] += re;
            imag[a] += im;
          }
      }
      const result = new Float64Array(size / 2 + 1);
      for (let i = 0; i < result.length; i++)
        result[i] = (Math.hypot(real[i], imag[i]) * 2) / size;
      return result;
    },
  };
}
