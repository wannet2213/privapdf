import { loadPdfDoc } from './pdf-client';
import type { TextEdit } from '../engines/edit-text';
import { tr } from './i18n';

interface Item { text: string; x: number; y: number }

// Hanya huruf/angka (aksara apa pun): karakter di luar WinAnsi digambar sebagai '?', spasi bisa bergeser.
const norm = (s: string) => s.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
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
      // Item lama yang masih ada utuh di tempatnya — walau teksnya kebetulan bagian dari teks baru.
      const kept = old.get(p)!.filter((it) => inRect(it, e.rect!) && norm(it.text) && norm(it.text) !== norm(e.text))
        .some((o) => now.get(p)!.some((n) => n.text === o.text && Math.abs(n.x - o.x) <= 0.5 && Math.abs(n.y - o.y) <= 0.5));
      if (kept || (inside && !norm(e.text).includes(inside))) {
        problems.push(tr(`Halaman ${p + 1}: teks lama masih terbaca di baris yang diedit — untuk data sensitif pakai Sensor PDF.`, `Page ${p + 1}: the old text is still readable in the edited line — for sensitive data use Redact PDF.`));
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
      problems.push(tr(`Halaman ${p + 1}: teks lain di sekitar baris yang diedit ikut berubah — periksa hasilnya.`, `Page ${p + 1}: other text around the edited line changed too — check the result.`));
    }
  }
  return problems;
}
