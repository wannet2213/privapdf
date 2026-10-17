import { describe, expect, it } from 'vitest';
import { applyKey, alphaFor, colorDistance, cornerColor, flattenOnColor } from '../../src/lib/remove-bg';
import { imglyErrorMessage } from '../../src/lib/remove-bg-imgly';

const REF: [number, number, number] = [255, 255, 255];

function makeImage(width: number, height: number, fill: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fill(x, y);
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return data;
}

const alphaAt = (data: Uint8ClampedArray, x: number, y: number) => data[(y * 8 + x) * 4 + 3];

describe('alphaFor & colorDistance', () => {
  it('jarak warna hitam ke putih ~441', () => {
    expect(colorDistance(0, 0, 0, REF)).toBeCloseTo(441.67, 1);
  });
  it('alpha: 0 di bawah toleransi, 1 di atas pita, parsial di pita', () => {
    expect(alphaFor(10, 40, 20)).toBe(0);
    expect(alphaFor(40, 40, 20)).toBe(0);
    expect(alphaFor(50, 40, 20)).toBeCloseTo(0.5);
    expect(alphaFor(60, 40, 20)).toBe(1);
    expect(alphaFor(200, 40, 20)).toBe(1);
  });
});

describe('cornerColor', () => {
  it('gambar polos menghasilkan warna persis', () => {
    const data = makeImage(8, 8, () => [10, 200, 30]);
    expect(cornerColor(data, 8, 8)).toEqual([10, 200, 30]);
  });
  it('mengabaikan objek di tengah pada gambar besar (patch terbatas ke sudut)', () => {
    const data = makeImage(40, 40, (x, y) => (x >= 15 && x <= 24 && y >= 15 && y <= 24 ? [200, 0, 0] : [255, 255, 255]));
    expect(cornerColor(data, 40, 40)).toEqual([255, 255, 255]);
  });
});

describe('applyKey', () => {
  it('mode edges: latar putih tepi hilang, kotak putih di tengah bertahan', () => {
    // Latar putih + pulau putih 2×2 di tengah (dikelilingi merah).
    const data = makeImage(8, 8, (x, y) => {
      if (x >= 3 && x <= 4 && y >= 3 && y <= 4) return [255, 255, 255]; // pulau sewarna
      if (x >= 2 && x <= 5 && y >= 2 && y <= 5) return [200, 0, 0]; // bingkai merah
      return REF; // latar putih
    });
    applyKey(data, 8, 8, { ref: REF, tolerance: 30, softness: 0, mode: 'edges' });
    expect(alphaAt(data, 0, 0)).toBe(0); // latar hilang
    expect(alphaAt(data, 3, 3)).toBe(255); // pulau sewarna utuh
    expect(alphaAt(data, 2, 2)).toBe(255); // bingkai merah utuh
  });

  it('mode global: semua piksel serupa latar hilang termasuk di tengah', () => {
    const data = makeImage(8, 8, (x, y) => {
      if (x >= 3 && x <= 4 && y >= 3 && y <= 4) return [255, 255, 255]; // objek berbeda warna
      return [10, 10, 10]; // latar gelap
    });
    applyKey(data, 8, 8, { ref: [10, 10, 10], tolerance: 30, softness: 0, mode: 'global' });
    expect(alphaAt(data, 0, 0)).toBe(0);   // latar hilang
    expect(alphaAt(data, 3, 3)).toBe(255); // objek di tengah tetap
    expect(alphaAt(data, 0, 3)).toBe(0);
  });

  it('softness memberi alpha parsial di tepi', () => {
    // Gradien horizontal putih → abu 200; toleransi 10, softness 100.
    const data = makeImage(8, 1, (x) => [255 - x * 10, 255 - x * 10, 255 - x * 10]);
    applyKey(data, 8, 1, { ref: REF, tolerance: 10, softness: 60, mode: 'global' });
    expect(alphaAt(data, 0, 0)).toBe(0);
    expect(alphaAt(data, 7, 0)).toBe(255);
    const mid = alphaAt(data, 4, 0);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(255);
  });
});

describe('flattenOnColor', () => {
  it('composites each pixel over the background by its alpha and makes it opaque', () => {
    // transparan penuh, opak penuh, dan tepi setengah transparan
    const data = new Uint8ClampedArray([0, 0, 0, 0, 10, 20, 30, 255, 200, 100, 0, 128]);
    flattenOnColor(data, [255, 0, 0]);
    expect([...data]).toEqual([255, 0, 0, 255, 10, 20, 30, 255, 227, 50, 0, 255]);
  });
});

describe('imglyErrorMessage', () => {
  it('explains missing model assets instead of the raw size mismatch', () => {
    expect(imglyErrorMessage('Failed to fetch /models/isnet with size 4194304 but got 948', 'isnet')).toMatch(/"Maksimal" belum terpasang lengkap.*setup:imgly/);
    expect(imglyErrorMessage('Resource /models/isnet_fp16 not found. Ensure that the config.publicPath is configured correctly.', 'isnet_fp16')).toMatch(/"Seimbang"/);
    expect(imglyErrorMessage('out of memory', 'isnet')).toBe('out of memory');
  });
});
