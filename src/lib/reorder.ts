export function reorder<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function normalizeSelection(selected: number[], order: number[]): number[] {
  const selectedSet = new Set(selected);
  return order.filter((page) => selectedSet.has(page));
}

export function toggleSelection(selected: number[], page: number, order?: number[]): number[] {
  const next = selected.includes(page) ? selected.filter((item) => item !== page) : [...selected, page];
  return order ? normalizeSelection(next, order) : [...new Set(next)].sort((a, b) => a - b);
}
