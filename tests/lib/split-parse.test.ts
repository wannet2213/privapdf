import { describe, expect, it } from 'vitest';
import { parseRanges, parseGroups, validateRanges, validateGroups } from '../../src/lib/split-parse';

describe('parseRanges', () => {
  it('parses simple range "1-5"', () => {
    expect(parseRanges('1-5')).toEqual([[0, 4]]);
  });

  it('parses multiple ranges separated by comma', () => {
    expect(parseRanges('1-5, 6-10')).toEqual([[0, 4], [5, 9]]);
  });

  it('parses ranges separated by newlines', () => {
    expect(parseRanges('1-3\n4-6')).toEqual([[0, 2], [3, 5]]);
  });

  it('parses single page numbers', () => {
    expect(parseRanges('1, 5, 10')).toEqual([[0, 0], [4, 4], [9, 9]]);
  });

  it('mixes single pages and ranges', () => {
    expect(parseRanges('1-3, 5, 7-9')).toEqual([[0, 2], [4, 4], [6, 8]]);
  });

  it('handles reversed ranges (5-1 becomes 1-5)', () => {
    expect(parseRanges('5-1')).toEqual([[0, 4]]);
  });

  it('handles en-dash separator', () => {
    expect(parseRanges('1–3')).toEqual([[0, 2]]);
  });

  it('ignores invalid tokens', () => {
    expect(parseRanges('1-3, abc, 5')).toEqual([[0, 2], [4, 4]]);
  });

  it('handles empty input', () => {
    expect(parseRanges('')).toEqual([]);
  });
});

describe('parseGroups', () => {
  it('parses pipe-separated groups', () => {
    expect(parseGroups('1,3,5 | 2,6,9')).toEqual([[0, 2, 4], [1, 5, 8]]);
  });

  it('parses semicolon-separated groups', () => {
    expect(parseGroups('1,3,5 ; 2,6,9')).toEqual([[0, 2, 4], [1, 5, 8]]);
  });

  it('parses newline-separated groups', () => {
    expect(parseGroups('1,3,5\n2,6,9')).toEqual([[0, 2, 4], [1, 5, 8]]);
  });

  it('parses space-separated pages within a group', () => {
    expect(parseGroups('1 3 5 | 2 6 9')).toEqual([[0, 2, 4], [1, 5, 8]]);
  });

  it('handles single group', () => {
    expect(parseGroups('1,2,3')).toEqual([[0, 1, 2]]);
  });

  it('filters out invalid page numbers', () => {
    expect(parseGroups('1,abc,3 | 2,-1,5')).toEqual([[0, 2], [1, 4]]);
  });

  it('handles empty input', () => {
    expect(parseGroups('')).toEqual([]);
  });
});

describe('validateRanges', () => {
  it('passes for valid ranges within page count', () => {
    expect(validateRanges([[0, 4], [5, 9]], 10)).toBeUndefined();
  });

  it('errors when range exceeds page count', () => {
    expect(validateRanges([[0, 14]], 10)).toContain('di luar jumlah halaman');
  });

  it('errors for empty ranges', () => {
    expect(validateRanges([], 10)).toBe('Tidak ada rentang yang dimasukkan.');
  });

  it('errors when start is negative (0-based -1)', () => {
    expect(validateRanges([[-1, 4]], 10)).toContain('di luar jumlah halaman');
  });
});

describe('validateGroups', () => {
  it('passes for valid groups within page count', () => {
    expect(validateGroups([[0, 2, 4], [1, 5, 8]], 10)).toBeUndefined();
  });

  it('errors when page index exceeds count', () => {
    expect(validateGroups([[0, 14]], 10)).toContain('di luar jumlah halaman');
  });

  it('errors for empty groups', () => {
    expect(validateGroups([], 10)).toBe('Tidak ada kelompok halaman yang dimasukkan.');
  });

  it('ignores empty sub-groups but validates the rest', () => {
    expect(validateGroups([[], [0, 1]], 10)).toBeUndefined();
  });
});
