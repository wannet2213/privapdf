import { describe, expect, it } from 'vitest';
import { boxFromMargins, clampCropBox, isZeroMargins, marginsFromBox, presetRatio, resizeCropBox, type Box } from '../../src/lib/crop-box';

const PAGE = { w: 595, h: 842 }; // A4

describe('clampCropBox', () => {
  it('menjepit kotak di dalam halaman', () => {
    const b = clampCropBox(-50, -50, 700, 900, PAGE.w, PAGE.h, null);
    expect(b.x).toBe(0);
    expect(b.y).toBe(0);
    expect(b.w).toBeLessThanOrEqual(PAGE.w);
    expect(b.h).toBeLessThanOrEqual(PAGE.h);
  });

  it('menjaga ukuran minimum', () => {
    const b = clampCropBox(100, 100, 5, 5, PAGE.w, PAGE.h, null);
    expect(b.w).toBeGreaterThanOrEqual(24);
    expect(b.h).toBeGreaterThanOrEqual(24);
  });

  it('mempertahankan rasio saat penjepitan', () => {
    const r = presetRatio('a4')!;
    const b = clampCropBox(0, 0, PAGE.w * 2, 10, PAGE.w, PAGE.h, r);
    expect(b.w).toBeCloseTo(PAGE.w, 0);
    expect(b.w / b.h).toBeCloseTo(r, 2);
  });
});

describe('resizeCropBox', () => {
  const start: Box = { x: 100, y: 100, w: 200, h: 300 };

  it('memindah kotak tanpa mengubah ukuran', () => {
    const b = resizeCropBox(start, 'move', 50, 40, PAGE.w, PAGE.h, null);
    expect(b).toEqual({ x: 150, y: 140, w: 200, h: 300 });
  });

  it('memindah kotak tidak keluar halaman', () => {
    const b = resizeCropBox(start, 'move', 5000, 5000, PAGE.w, PAGE.h, null);
    expect(b.x + b.w).toBeLessThanOrEqual(PAGE.w);
    expect(b.y + b.h).toBeLessThanOrEqual(PAGE.h);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
  });

  it('resize sudut se (bebas) mengikuti delta', () => {
    const b = resizeCropBox(start, 'se', 30, 50, PAGE.w, PAGE.h, null);
    expect(b.x).toBe(100);
    expect(b.y).toBe(100);
    expect(b.w).toBeCloseTo(230, 5);
    expect(b.h).toBeCloseTo(350, 5);
  });

  it('resize sisi barat menjangkar sisi timur', () => {
    const b = resizeCropBox(start, 'w', 50, 0, PAGE.w, PAGE.h, null);
    expect(b.x).toBeCloseTo(150, 5);   // x bergeser
    expect(b.w).toBeCloseTo(150, 5);   // menyusut dari barat
    expect(b.y).toBe(100);
    expect(b.h).toBe(300);
  });

  it('resize sisi utara menjangkar sisi selatan', () => {
    const b = resizeCropBox(start, 'n', 0, 60, PAGE.w, PAGE.h, null);
    expect(b.y).toBeCloseTo(160, 5);
    expect(b.h).toBeCloseTo(240, 5);
  });

  it('tidak bisa menyusut di bawah minimum', () => {
    const b = resizeCropBox(start, 'se', -1000, -1000, PAGE.w, PAGE.h, null);
    expect(b.w).toBeGreaterThanOrEqual(24);
    expect(b.h).toBeGreaterThanOrEqual(24);
  });

  it('resize sudut TIDAK keluar dari halaman (nol atau lebih)', () => {
    const b = resizeCropBox(start, 'nw', 5000, 5000, PAGE.w, PAGE.h, null);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x + b.w).toBeLessThanOrEqual(PAGE.w);
    expect(b.y + b.h).toBeLessThanOrEqual(PAGE.h);
  });

  it('resize sudut TIDAK keluar arah negatif', () => {
    const b = resizeCropBox(start, 'se', -5000, -5000, PAGE.w, PAGE.h, null);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
  });
});

describe('resizeCropBox dengan rasio terkunci', () => {
  const r = presetRatio('a4')!;
  const start: Box = { x: 100, y: 100, w: 200, h: 200 / r };

  it('rasio tetap saat resize sudut se', () => {
    const b = resizeCropBox(start, 'se', 100, 1, PAGE.w, PAGE.h, r);
    expect(b.w / b.h).toBeCloseTo(r, 3);
  });

  it('rasio tetap saat resize sudut nw', () => {
    const b = resizeCropBox(start, 'nw', -80, 10, PAGE.w, PAGE.h, r);
    expect(b.w / b.h).toBeCloseTo(r, 3);
  });

  it('rasio tetap saat resize sisi timur (tinggi mengikuti, pusat vertikal dipertahankan)', () => {
    const b = resizeCropBox(start, 'e', 60, 0, PAGE.w, PAGE.h, r);
    expect(b.w / b.h).toBeCloseTo(r, 3);
    expect(b.y + b.h / 2).toBeCloseTo(start.y + start.h / 2, 3);
  });

  it('rasio tetap saat resize sisi selatan (lebar mengikuti, pusat horizontal dipertahankan)', () => {
    const b = resizeCropBox(start, 's', 0, 100, PAGE.w, PAGE.h, r);
    expect(b.w / b.h).toBeCloseTo(r, 3);
    expect(b.x + b.w / 2).toBeCloseTo(start.x + start.w / 2, 3);
  });

  it('rasio tetap saat dipaksa mengecil keluar halaman', () => {
    const b = resizeCropBox(start, 'se', 10000, 10000, PAGE.w, PAGE.h, r);
    expect(b.w / b.h).toBeCloseTo(r, 2);
    expect(b.w).toBeLessThanOrEqual(PAGE.w);
    expect(b.h).toBeLessThanOrEqual(PAGE.h);
  });

  it('move tetap bebas (tidak mengubah rasio)', () => {
    const b = resizeCropBox(start, 'move', 77, 33, PAGE.w, PAGE.h, r);
    expect(b.w).toBe(start.w);
    expect(b.h).toBe(start.h);
  });
});

describe('presetRatio', () => {
  it('mengembalikan rasio A4 dan Letter, null untuk bebas', () => {
    expect(presetRatio('a4')).toBeCloseTo(595 / 842, 6);
    expect(presetRatio('letter')).toBeCloseTo(612 / 792, 6);
    expect(presetRatio('free')).toBeNull();
  });
});

describe('konversi margin ↔ kotak', () => {
  it('margin null = seluruh halaman', () => {
    const b = boxFromMargins(null, PAGE.w, PAGE.h);
    expect(b).toEqual({ x: 0, y: 0, w: PAGE.w, h: PAGE.h });
  });

  it('boxFromMargins menghitung kotak dari margin', () => {
    const b = boxFromMargins({ top: 10, bottom: 20, left: 5, right: 15 }, 200, 300);
    expect(b).toEqual({ x: 5, y: 10, w: 180, h: 270 });
  });

  it('marginsFromBox adalah invers boxFromMargins', () => {
    const m = { top: 12, bottom: 34, left: 56, right: 78 };
    const back = marginsFromBox(boxFromMargins(m, PAGE.w, PAGE.h), PAGE.w, PAGE.h);
    expect(back).toEqual(m);
  });

  it('isZeroMargins benar untuk nol dan margin nyata', () => {
    expect(isZeroMargins({ top: 0, bottom: 0, left: 0, right: 0 })).toBe(true);
    expect(isZeroMargins({ top: 0, bottom: 1e-9, left: 0, right: 0 })).toBe(true);
    expect(isZeroMargins({ top: 0, bottom: 1, left: 0, right: 0 })).toBe(false);
  });
});
