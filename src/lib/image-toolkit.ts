/**
 * Toolkit gambar: konversi format, kompresi (kualitas), dan resize massal
 * via canvas. Re-encode menghapus metadata EXIF (GPS, perangkat kamera).
 */

export type ImageFormat = 'image/png' | 'image/jpeg' | 'image/webp';

export const FORMAT_EXT: Record<ImageFormat, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

export interface ImageConvertOptions {
  format: ImageFormat;
  /** 0–1. Diabaikan PNG (lossless). */
  quality: number;
  /** Lebar maksimum piksel; 0 = pertahankan ukuran asli. Tidak pernah upscale. */
  maxWidth: number;
}

/** Dimensi setelah resize lebar maksimum — murni, tanpa upscale. */
export function scaledDimensions(width: number, height: number, maxWidth: number): { width: number; height: number } {
  if (maxWidth > 0 && width > maxWidth) {
    return { width: maxWidth, height: Math.max(1, Math.round((height * maxWidth) / width)) };
  }
  return { width, height };
}

/** Ganti ekstensi nama file sesuai format keluaran. */
export function withFormatExt(name: string, format: ImageFormat): string {
  return name.replace(/\.[^.]+$/, '') + FORMAT_EXT[format];
}

export interface ImageConvertResult {
  blob: Blob;
  width: number;
  height: number;
  /** Format yang benar-benar dihasilkan browser (bisa berbeda bila WebP tak didukung). */
  actualFormat: ImageFormat;
}

/**
 * Dekode gambar (EXIF orientation dihormati browser), gambar ulang ke canvas
 * — langkah inilah yang menghapus seluruh metadata — lalu enkode ulang.
 */
export async function convertImage(bytes: ArrayBuffer, opts: ImageConvertOptions): Promise<ImageConvertResult> {
  const bitmap = await createImageBitmap(new Blob([bytes]));
  try {
    const { width, height } = scaledDimensions(bitmap.width, bitmap.height, opts.maxWidth);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D tidak tersedia di browser ini.');
    // JPEG tidak punya transparansi — isi putih agar area alpha tidak jadi hitam.
    if (opts.format === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Gagal mengenkode gambar.'))),
        opts.format,
        opts.format === 'image/png' ? undefined : opts.quality,
      );
    });
    const actualFormat = (blob.type as ImageFormat) in FORMAT_EXT ? (blob.type as ImageFormat) : 'image/png';
    return { blob, width, height, actualFormat };
  } finally {
    bitmap.close();
  }
}
