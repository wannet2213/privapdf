import { describe, expect, it } from 'vitest';
import { scaledDimensions, withFormatExt } from '../../src/lib/image-toolkit';

describe('scaledDimensions', () => {
  it('mengecilkan sesuai lebar maksimum dengan rasio terjaga', () => {
    expect(scaledDimensions(2000, 1000, 1000)).toEqual({ width: 1000, height: 500 });
    expect(scaledDimensions(3000, 700, 1000)).toEqual({ width: 1000, height: 233 });
  });
  it('tidak upscale dan mempertahankan ukuran bila maxWidth 0', () => {
    expect(scaledDimensions(800, 600, 0)).toEqual({ width: 800, height: 600 });
    expect(scaledDimensions(800, 600, 1200)).toEqual({ width: 800, height: 600 });
  });
  it('bekerja untuk orientasi potret', () => {
    expect(scaledDimensions(1000, 2000, 500)).toEqual({ width: 500, height: 1000 });
  });
});

describe('withFormatExt', () => {
  it('mengganti ekstensi lama', () => {
    expect(withFormatExt('foto.png', 'image/jpeg')).toBe('foto.jpg');
    expect(withFormatExt('a.b.c.webp', 'image/png')).toBe('a.b.c.png');
  });
  it('menambah ekstensi bila nama tanpa titik', () => {
    expect(withFormatExt('gambar', 'image/webp')).toBe('gambar.webp');
  });
});
