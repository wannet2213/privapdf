/** Helper murni untuk pipeline hapus latar AI (dipakai worker + test). */

/** Ukuran input square u2netp (px). */
export const U2NETP_INPUT_SIZE = 320;

/**
 * Normalisasi min-max output matte ke rentang 0–1.
 * Mengembalikan array baru; bila rentang nol (flat), kembalikan nol semua.
 */
export function minMaxNormalize(matte: Float32Array): Float32Array {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < matte.length; i++) {
    const v = matte[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  const out = new Float32Array(matte.length);
  if (range <= 0) return out;
  for (let i = 0; i < matte.length; i++) out[i] = (matte[i] - min) / range;
  return out;
}
