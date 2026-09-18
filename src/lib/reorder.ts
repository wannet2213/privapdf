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

/* Pindahkan semua item milik `file` sebagai satu blok ke posisi sebelum (before)
   atau sesudah grup `target`. Halaman yang sudah diacak manual tetap dipertahankan
   urutan internalnya; return referensi asli bila tidak ada yang bisa dipindah. */
export function moveFileGroup<T extends { file: number }>(refs: T[], file: number, target: number, before: boolean): T[] {
  const group = refs.filter((r) => r.file === file);
  const anchor = before
    ? refs.find((r) => r.file === target)
    : [...refs].reverse().find((r) => r.file === target);
  if (!group.length || !anchor) return refs;
  const rest = refs.filter((r) => r.file !== file);
  const at = rest.indexOf(anchor) + (before ? 0 : 1);
  return [...rest.slice(0, at), ...group, ...rest.slice(at)];
}
