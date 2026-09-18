import { describe, expect, it } from 'vitest';
import { moveFileGroup, normalizeSelection, reorder, toggleSelection } from '../../src/lib/reorder';

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

describe('moveFileGroup', () => {
  const refs = [
    { file: 0, page: 0 }, { file: 0, page: 1 },
    { file: 1, page: 0 },
    { file: 2, page: 0 }, { file: 2, page: 1 },
  ];
  it('moves a whole file block up before the previous file', () => {
    expect(moveFileGroup(refs, 2, 1, true)).toEqual([
      { file: 0, page: 0 }, { file: 0, page: 1 },
      { file: 2, page: 0 }, { file: 2, page: 1 },
      { file: 1, page: 0 },
    ]);
  });
  it('moves a whole file block down after the next file', () => {
    expect(moveFileGroup(refs, 0, 1, false)).toEqual([
      { file: 1, page: 0 },
      { file: 0, page: 0 }, { file: 0, page: 1 },
      { file: 2, page: 0 }, { file: 2, page: 1 },
    ]);
  });
  it('keeps manually scattered pages as one subsequence without mutating input', () => {
    const scattered = [{ file: 1, page: 0 }, { file: 0, page: 0 }, { file: 1, page: 1 }, { file: 0, page: 1 }];
    expect(moveFileGroup(scattered, 1, 0, true)).toEqual([
      { file: 1, page: 0 }, { file: 1, page: 1 }, { file: 0, page: 0 }, { file: 0, page: 1 },
    ]);
    expect(scattered[0]).toEqual({ file: 1, page: 0 });
  });
  it('returns input unchanged when the target group has no pages', () => {
    const single = [{ file: 0, page: 0 }];
    expect(moveFileGroup(single, 0, 1, true)).toBe(single);
  });
});
