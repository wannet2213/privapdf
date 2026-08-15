import { useState } from 'react';
import { PdfPreview } from '../lib/pdf-preview';
import { toggleSelection } from '../lib/reorder';

interface PageSelectPanelProps {
  bytes: ArrayBuffer;
  pageCount: number;
  onProcess: (indices: number[]) => void;
  busy: boolean;
  title: string;
  hint: string;
}

export function PageSelectPanel({ bytes, pageCount, onProcess, busy, title, hint }: PageSelectPanelProps) {
  const [selected, setSelected] = useState<number[]>([]);
  const pages = Array.from({ length: pageCount }, (_, i) => ({ page: i, label: `Halaman ${i + 1}` }));
  const allPages = pages.map((p) => p.page);

  return (
    <div className="split-panel">
      <div className="preview-heading">
        <span>{title}</span>
        <small>{selected.length} dari {pageCount} dipilih</small>
      </div>
      <div className="split-bulk-actions">
        <button type="button" className="ghost-btn" onClick={() => setSelected(allPages)}>Pilih semua</button>
        <button type="button" className="ghost-btn" onClick={() => setSelected([])}>Kosongkan</button>
        <button type="button" className="ghost-btn" onClick={() => setSelected(selected.length === pageCount ? [] : allPages)}>Balik pilihan</button>
      </div>
      <PdfPreview bytes={bytes} pages={pages} selected={selected} onToggle={(page) => setSelected(toggleSelection(selected, page, allPages))} onMove={() => {}} />
      <p className="split-hint">{hint}</p>
      <button className="primary" onClick={() => onProcess(selected)} disabled={!selected.length || busy}>
        {busy ? 'Memproses…' : `${title} (${selected.length} halaman) →`}
      </button>
    </div>
  );
}
