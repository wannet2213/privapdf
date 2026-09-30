/**
 * Penghapus latar berbasis warna (chroma-key) untuk latar solid.
 * Murni operasi typed-array — mudah diuji tanpa DOM.
 */

export interface BgKeyOptions {
  /** Warna latar referensi (RGB 0-255). */
  ref: [number, number, number];
  /** Jarak warna maksimum yang dianggap latar (0-255). */
  tolerance: number;
  /** Lebar pita transisi alpha di sekitar toleransi (anti-alias tepi). */
  softness: number;
  /** 'edges': flood-fill dari tepi (aman untuk objek sewarna di tengah); 'global': semua piksel serupa. */
  mode: 'edges' | 'global';
}

/** Jarak Euclidean piksel ke warna referensi. */
export function colorDistance(r: number, g: number, b: number, ref: [number, number, number]): number {
  const dr = r - ref[0], dg = g - ref[1], db = b - ref[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** Faktor alpha (0-1) untuk jarak warna tertentu — 1 di dalam pita soft memberi tepi lembut. */
export function alphaFor(distance: number, tolerance: number, softness: number): number {
  if (distance <= tolerance) return 0;
  if (softness <= 0 || distance >= tolerance + softness) return 1;
  return (distance - tolerance) / softness;
}

/**
 * Warna latar otomatis: rata-rata empat patch sudut (10×10) — asumsi latar
 * menyentuh tepi gambar.
 */
export function cornerColor(data: Uint8ClampedArray, width: number, height: number): [number, number, number] {
  const patch = Math.min(10, width, height);
  let r = 0, g = 0, b = 0, count = 0;
  const sample = (px: number, py: number) => {
    const i = (py * width + px) * 4;
    r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
  };
  const corner = (cx: number, cy: number) => {
    for (let y = 0; y < patch; y++) for (let x = 0; x < patch; x++) sample(cx + x, cy + y);
  };
  corner(0, 0);
  corner(width - patch, 0);
  corner(0, height - patch);
  corner(width - patch, height - patch);
  return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
}

/**
 * Terapkan key langsung pada kanal alpha ImageData (in-place).
 * Mode 'edges': BFS dari seluruh piksel tepi yang serupa latar — pulau
 * berwarna sama di tengah gambar tetap utuh. Mode 'global': semua piksel
 * dalam toleransi hilang. Piksel pada pita softness mendapat alpha parsial.
 */
export function applyKey(data: Uint8ClampedArray, width: number, height: number, opts: BgKeyOptions): void {
  const n = width * height;
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    dist[i] = colorDistance(data[p], data[p + 1], data[p + 2], opts.ref);
  }
  const alpha = (d: number) => alphaFor(d, opts.tolerance, opts.softness);

  if (opts.mode === 'global') {
    for (let i = 0; i < n; i++) data[i * 4 + 3] = Math.round(data[i * 4 + 3] * alpha(dist[i]));
    return;
  }

  // Flood-fill 4-arah dari tepi melewati piksel yang jelas latar.
  const removed = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;
  const push = (i: number) => {
    if (!removed[i] && dist[i] <= opts.tolerance) {
      removed[i] = 1;
      stack[sp++] = i;
    }
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % width;
    if (x > 0) push(i - 1);
    if (x < width - 1) push(i + 1);
    if (i >= width) push(i - width);
    if (i < n - width) push(i + width);
  }

  for (let i = 0; i < n; i++) {
    if (removed[i]) {
      data[i * 4 + 3] = 0;
      continue;
    }
    // Cincin tepi: piksel bertetangga dengan area terhapus mendapat alpha parsial.
    const x = i % width;
    const touches =
      (x > 0 && removed[i - 1]) ||
      (x < width - 1 && removed[i + 1]) ||
      (i >= width && removed[i - width]) ||
      (i < n - width && removed[i + width]);
    if (touches && dist[i] <= opts.tolerance + opts.softness) {
      data[i * 4 + 3] = Math.round(data[i * 4 + 3] * alpha(dist[i]));
    }
  }
}
