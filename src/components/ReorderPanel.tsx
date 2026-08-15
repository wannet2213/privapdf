import { PdfPreview } from '../lib/pdf-preview';
import { reorder } from '../lib/reorder';

interface ReorderPanelProps {
  bytes: ArrayBuffer;
  pageCount: number;
  order: number[];
  onOrderChange: (order: number[]) => void;
  onProcess: () => void;
  busy: boolean;
}

export function ReorderPanel({ bytes, pageCount, order, onOrderChange, onProcess, busy }: ReorderPanelProps) {
  // Gunakan origIdx sebagai page agar thumbnail yang benar dirender di posisi yang benar.
  // Saat order berubah, pages array berubah urutan sehingga thumbnail visual ikut berpindah.
  const pages = order.map((origIdx) => ({ page: origIdx, label: `Halaman ${origIdx + 1}` }));
  const selected = Array.from({ length: pageCount }, (_, i) => i);
  const handleMove = (from: number, to: number) => onOrderChange(reorder(order, from, to));

  return (
    <div className="split-panel">
      <div className="preview-heading">
        <span>Susun ulang halaman</span>
        <small>Seret untuk mengubah urutan</small>
      </div>
      <PdfPreview bytes={bytes} pages={pages} selected={selected} onToggle={() => {}} onMove={handleMove} />
      <p className="split-hint">Urutan: {order.map((p) => p + 1).join(' → ')}</p>
      <button className="primary" onClick={onProcess} disabled={busy}>
        {busy ? 'Memproses…' : 'Simpan urutan baru →'}
      </button>
    </div>
  );
}
