import { loadPdfDoc } from './pdf-client';
import type { TextEdit } from '../engines/edit-text';

interface Item { text: string; x: number; y: number }

// Hanya huruf/angka ASCII: karakter di luar WinAnsi digambar sebagai '?', spasi bisa bergeser.
const norm = (s: string) => s.replace(/[^A-Za-z0-9]/g, '');
const inRect = (it: Item, r: [number, number, number, number]) =>
  it.x >= Math.min(r[0], r[2]) && it.x <= Math.max(r[0], r[2]) && it.y >= Math.min(r[1], r[3]) && it.y <= Math.max(r[1], r[3]);

async function pageItems(bytes: ArrayBuffer, pages: number[]): Promise<Map<number, Item[]>> {
  const doc = await loadPdfDoc(bytes);
  try {
    const out = new Map<number, Item[]>();
    for (const p of pages) {
      const content = await (await doc.getPage(p + 1)).getTextContent();
      out.set(p, content.items.flatMap((it) => ('str' in it && it.str.trim() ? [{ text: it.str, x: it.transform[4], y: it.transform[5] }] : [])));
    }
    return out;
  } finally {
    await doc.destroy();
  }
}

/**
 * Periksa hasil suntingan lewat pdf.js — apa yang benar-benar bisa diekstrak dari file:
 * 1. teks lama tidak tersisa di area baris yang diedit;
 * 2. teks di luar area itu tidak ikut berubah (satu operasi teks bisa membentang ke luar baris).
 */
export async function verifyTextEdits(before: ArrayBuffer, after: ArrayBuffer, edits: TextEdit[]): Promise<string[]> {
  const pages = [...new Set(edits.map((e) => e.page))].sort((a, b) => a - b);
  const [old, now] = await Promise.all([pageItems(before, pages), pageItems(after, pages)]);
  const problems: string[] = [];
  for (const p of pages) {
    const pageEdits = edits.filter((e) => e.page === p);
    const rects = pageEdits.flatMap((e) => (e.rect ? [e.rect] : []));
    const newText = pageEdits.map((e) => norm(e.text));
    for (const e of pageEdits) {
      if (!e.rect) continue;
      const inside = norm(now.get(p)!.filter((it) => inRect(it, e.rect!)).map((it) => it.text).join(''));
      if (inside && !norm(e.text).includes(inside)) {
        problems.push(`Halaman ${p + 1}: teks lama masih terbaca di baris yang diedit — untuk data sensitif pakai Sensor PDF.`);
        break;
      }
    }
    // Potongan yang sama dengan teks baru diabaikan di kedua sisi: teks baru berbaris banyak
    // atau lebih panjang dari aslinya bisa jatuh di luar area baris.
    const outside = (items: Item[]) => norm(items
      .filter((it) => !rects.some((r) => inRect(it, r)))
      .filter((it) => !newText.some((t) => norm(it.text) && t.includes(norm(it.text))))
      .map((it) => it.text).join(''));
    if (outside(old.get(p)!) !== outside(now.get(p)!)) {
      problems.push(`Halaman ${p + 1}: teks lain di sekitar baris yang diedit ikut berubah — periksa hasilnya.`);
    }
  }
  return problems;
}
