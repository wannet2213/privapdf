// crypto.randomUUID() hanya ada di secure context (https / localhost) dan
// browser sejak 2021. Pengguna yang membuka situs lewat http://IP:port atau
// webview lama tetap butuh ID unik — jatuh ke getRandomValues yang selalu ada.
// Pengecekan tidak memakai `'randomUUID' in crypto`: menurut tipe DOM properti
// itu selalu ada, jadi cabang else-nya menyempit menjadi never.
export function uid(): string {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
