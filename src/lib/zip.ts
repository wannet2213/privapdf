import { zip } from 'fflate';

export interface ZipEntry {
  name: string;
  bytes: ArrayBuffer;
}

/**
 * Buat arsip ZIP dari daftar file. Nama duplikat diberi nomor otomatis
 * (contoh: `a.pdf`, `a-2.pdf`). Kompresi deflate, level 6.
 */
export async function createZip(entries: ZipEntry[]): Promise<Blob> {
  if (!entries.length) throw new Error('Tidak ada file untuk diarsipkan.');

  // Dedup nama file agar tidak saling menimpa di dalam arsip
  const used = new Map<string, number>();
  const data: Record<string, Uint8Array> = {};
  for (const e of entries) {
    let name = e.name.replace(/^\/+/, '');
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    const n = (used.get(stem + ext) ?? 0) + 1;
    used.set(stem + ext, n);
    if (n > 1) name = `${stem}-${n}${ext}`;
    data[name] = new Uint8Array(e.bytes.slice(0));
  }

  return new Promise<Blob>((resolve, reject) => {
    zip(data, { level: 6 }, (err, out) => {
      if (err) reject(err instanceof Error ? err : new Error('Gagal membuat arsip ZIP.'));
      else resolve(new Blob([out], { type: 'application/zip' }));
    });
  });
}
