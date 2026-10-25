// Parser dan validator untuk split modes: each, ranges, groups.
// Semua index internal menggunakan 0-based. Input pengguna 1-based.

import { tr } from './i18n';

export type SplitMode = 'each' | 'ranges' | 'groups';

/** Hasil parse satu rentang: [start, end] inklusif, 0-based. */
export type Range = [number, number];

/** Hasil parse: daftar kelompok halaman, 0-based, sudah divalidasi. */
export interface ParsedSplit {
  groups: number[][];
  error?: string;
}

/**
 * Parse string rentang seperti "1-5, 6-10, 12" menjadi daftar [start,end] 0-based.
 * Spasi dan koma baru-baris diabaikan. Mendukung halaman tunggal dan rentang.
 */
export function parseRanges(input: string): Range[] {
  const parts = input
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const ranges: Range[] = [];
  for (const part of parts) {
    const dash = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (dash) {
      const start = Number(dash[1]);
      const end = Number(dash[2]);
      if (start > end) ranges.push([end - 1, start - 1]);
      else ranges.push([start - 1, end - 1]);
      continue;
    }
    const single = part.match(/^(\d+)$/);
    if (single) {
      const idx = Number(single[1]) - 1;
      ranges.push([idx, idx]);
    }
  }
  return ranges;
}

/**
 * Parse string kelompok seperti "1,3,5 | 2,6,9" menjadi [[0,2,4],[1,5,8]].
 * Pemisah kelompok: | atau ; atau baris baru. Pemisah halaman: koma.
 */
export function parseGroups(input: string): number[][] {
  const groups = input
    .split(/[|;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return groups.map((group) =>
    group
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => Number(s) - 1)
      .filter((n) => Number.isInteger(n) && n >= 0)
  );
}

/**
 * Validasi rentang terhadap jumlah halaman.
 * Mengembalikan error jika ada rentang yang keluar batas.
 */
export function validateRanges(ranges: Range[], pageCount: number): string | undefined {
  if (!ranges.length) return tr('Tidak ada rentang yang dimasukkan.', 'No ranges entered.');
  for (const [start, end] of ranges) {
    if (start < 0 || end >= pageCount) {
      return tr(`Rentang ${start + 1}-${end + 1} berada di luar jumlah halaman (${pageCount}).`, `Range ${start + 1}-${end + 1} is outside the page count (${pageCount}).`);
    }
  }
  return undefined;
}

/**
 * Validasi kelompok halaman terhadap jumlah halaman.
 */
export function validateGroups(groups: number[][], pageCount: number): string | undefined {
  const nonEmpty = groups.filter((g) => g.length);
  if (!nonEmpty.length) return tr('Tidak ada kelompok halaman yang dimasukkan.', 'No page groups entered.');
  for (const group of nonEmpty) {
    for (const idx of group) {
      if (idx < 0 || idx >= pageCount) {
        return tr(`Halaman ${idx + 1} berada di luar jumlah halaman (${pageCount}).`, `Page ${idx + 1} is outside the page count (${pageCount}).`);
      }
    }
  }
  return undefined;
}

/** Bikin label output untuk file hasil split. */
export function rangeLabel(range: Range): string {
  return range[0] === range[1] ? `hal-${range[0] + 1}` : `hal-${range[0] + 1}-${range[1] + 1}`;
}

/** Bikin label kelompok. */
export function groupLabel(pages: number[]): string {
  return pages.map((p) => p + 1).join('-');
}
