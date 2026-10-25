// Bahasa dipilih sekali dari bahasa perangkat (berlaku juga di Web Worker): Indonesia → id, selain itu → en.
// 'in' = kode lama Bahasa Indonesia yang masih dilaporkan sebagian Android.
export const lang: 'id' | 'en' = /^(id|in)\b/i.test(globalThis.navigator?.language ?? '') ? 'id' : 'en';
export const locale = lang === 'id' ? 'id-ID' : 'en-US';
export const tr = <T>(id: T, en: T): T => (lang === 'id' ? id : en);
