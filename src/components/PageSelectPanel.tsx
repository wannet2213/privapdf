import { useState } from 'react';
import { PdfPreview } from '../lib/pdf-preview';
import { toggleSelection } from '../lib/reorder';
import { tr } from '../lib/i18n';

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
  const pages = Array.from({ length: pageCount }, (_, i) => ({ page: i, label: tr(`Halaman ${i + 1}`, `Page ${i + 1}`) }));
  const allPages = pages.map((p) => p.page);

  return (
    <div className="split-panel">
      <div className="preview-heading">
        <span>{title}</span>
        <small>{tr(`${selected.length} dari ${pageCount} dipilih`, `${selected.length} of ${pageCount} selected`)}</small>
      </div>
      <div className="split-bulk-actions">
        <button type="button" className="ghost-btn" onClick={() => setSelected(allPages)}>{tr('Pilih semua', 'Select all')}</button>
        <button type="button" className="ghost-btn" onClick={() => setSelected([])}>{tr('Kosongkan', 'Clear')}</button>
        <button type="button" className="ghost-btn" onClick={() => setSelected(selected.length === pageCount ? [] : allPages)}>{tr('Balik pilihan', 'Invert selection')}</button>
      </div>
      <PdfPreview bytes={bytes} pages={pages} selected={selected} onToggle={(page) => setSelected(toggleSelection(selected, page, allPages))} onMove={() => {}} />
      <p className="split-hint">{hint}</p>
      <button className="primary" onClick={() => onProcess(selected)} disabled={!selected.length || busy}>
        {busy ? tr('Memproses…', 'Processing…') : `${title} (${tr(`${selected.length} halaman`, `${selected.length} pages`)})`}
      </button>
    </div>
  );
}
