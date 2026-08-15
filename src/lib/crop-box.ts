/** Utilitas kotak crop (satuan: point PDF). Dipakai CropPanel & PageViewer agar perilaku identik. */

export interface Box { x: number; y: number; w: number; h: number }
export type CropHandle = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Ukuran sisi minimum kotak crop (pt). */
export const CROP_MIN = 24;

/** Jepit kotak di dalam halaman. Jika `ratio` (w/h) diberikan, rasio dipertahankan. */
export function clampCropBox(x: number, y: number, w: number, h: number, pageW: number, pageH: number, ratio: number | null, min = CROP_MIN): Box {
  if (ratio) {
    // Perkecil agar muat halaman dengan rasio tetap
    if (w > pageW) { w = pageW; h = w / ratio; }
    if (h > pageH) { h = pageH; w = h * ratio; }
    if (w < min) { w = min; h = w / ratio; }
    if (h < min) { h = min; w = h * ratio; }
    // Setelah koreksi minimum, mungkin melebihi halaman lagi → kecilkan paksa
    if (w > pageW) { w = pageW; h = w / ratio; }
    if (h > pageH) { h = pageH; w = h * ratio; }
  } else {
    w = Math.max(min, Math.min(w, pageW));
    h = Math.max(min, Math.min(h, pageH));
  }
  x = Math.max(0, Math.min(x, pageW - w));
  y = Math.max(0, Math.min(y, pageH - h));
  return { x, y, w, h };
}

/**
 * Hitung kotak berikutnya dari drag pada `handle`.
 * dx/dy dalam point, relatif terhadap posisi pointer saat mulai (drag.start).
 * Semua pegangan dijamin tetap di dalam halaman.
 */
export function resizeCropBox(start: Box, handle: CropHandle, dx: number, dy: number, pageW: number, pageH: number, ratio: number | null, min = CROP_MIN): Box {
  if (handle === 'move') {
    const x = Math.max(0, Math.min(start.x + dx, pageW - start.w));
    const y = Math.max(0, Math.min(start.y + dy, pageH - start.h));
    return { x, y, w: start.w, h: start.h };
  }

  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');

  // Kandidat ukuran baru dari delta pointer
  let w = start.w + (east ? dx : west ? -dx : 0);
  let h = start.h + (south ? dy : north ? -dy : 0);

  if (ratio) {
    if (handle === 'n' || handle === 's') {
      // Tinggi memandu; lebar mengikuti rasio, pusat horizontal dipertahankan
      h = Math.max(min, h);
      w = h * ratio;
    } else if (handle === 'e' || handle === 'w') {
      w = Math.max(min, w);
      h = w / ratio;
    } else {
      // Sudut: sumbu dengan pergerakan dominan memandu
      const hFromW = Math.abs(w) / ratio;
      if (hFromW > Math.abs(h)) { w = Math.max(min, w); h = w / ratio; }
      else { h = Math.max(min, h); w = h * ratio; }
    }
  } else {
    w = Math.max(min, w);
    h = Math.max(min, h);
  }

  // Posisikan ulang sisi yang berlawanan (jangkar)
  let x = start.x;
  let y = start.y;
  if (west) x = start.x + start.w - w;
  if (north) y = start.y + start.h - h;
  if (handle === 'n' || handle === 's') x = start.x + (start.w - w) / 2;
  if (handle === 'e' || handle === 'w') y = start.y + (start.h - h) / 2;

  return clampCropBox(x, y, w, h, pageW, pageH, ratio, min);
}

/** Rasio (w/h) dari preset id, atau null untuk Bebas. */
export function presetRatio(presetId: string): number | null {
  switch (presetId) {
    case 'a4': return 595 / 842;
    case 'letter': return 612 / 792;
    default: return null;
  }
}

/** Margin crop: jarak area pertahankan dari tiap tepi halaman (point). */
export interface Margins { top: number; bottom: number; left: number; right: number }

/** Kotak crop dari margin; margin null/undefined = seluruh halaman. */
export function boxFromMargins(m: Margins | null | undefined, pageW: number, pageH: number): Box {
  if (!m) return { x: 0, y: 0, w: pageW, h: pageH };
  return { x: m.left, y: m.top, w: pageW - m.left - m.right, h: pageH - m.top - m.bottom };
}

/** Margin dari kotak crop (koordinat y dari atas halaman). */
export function marginsFromBox(b: Box, pageW: number, pageH: number): Margins {
  return { top: b.y, bottom: pageH - b.y - b.h, left: b.x, right: pageW - b.x - b.w };
}

/** True jika semua margin nol (kotak = seluruh halaman). */
export function isZeroMargins(m: Margins, eps = 1e-6): boolean {
  return m.top < eps && m.bottom < eps && m.left < eps && m.right < eps;
}
