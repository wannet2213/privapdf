import { describe, expect, it } from 'vitest';
import { minMaxNormalize, U2NETP_INPUT_SIZE } from '../../src/lib/bg-removal-core';

describe('U2NETP_INPUT_SIZE', () => {
  it('u2netp berinput 320', () => {
    expect(U2NETP_INPUT_SIZE).toBe(320);
  });
});

describe('minMaxNormalize', () => {
  it('memetakan min→0 dan max→1', () => {
    const out = minMaxNormalize(new Float32Array([3, 5, 7, 5]));
    expect(Array.from(out)).toEqual([0, 0.5, 1, 0.5]);
  });
  it('array flat menghasilkan nol semua (tanpa NaN)', () => {
    const out = minMaxNormalize(new Float32Array([4, 4, 4]));
    expect(Array.from(out)).toEqual([0, 0, 0]);
  });
});
