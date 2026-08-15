import { describe, expect, it } from 'vitest';
import { normalizeSelection, reorder, toggleSelection } from '../../src/lib/reorder';

describe('reorder helpers', () => {
  it('moves an item without mutating input', () => {
    const input = ['a', 'b', 'c'];
    expect(reorder(input, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(input).toEqual(['a', 'b', 'c']);
  });
  it('toggles and sorts selected pages', () => {
    expect(toggleSelection([2, 0], 1)).toEqual([0, 1, 2]);
    expect(toggleSelection([0, 2], 2)).toEqual([0]);
  });
  it('keeps selected pages unique and follows reordered page order', () => {
    expect(normalizeSelection([2, 0, 2], [1, 2, 0])).toEqual([2, 0]);
    expect(toggleSelection([2, 0, 2], 1, [2, 1, 0])).toEqual([2, 1, 0]);
  });
});
