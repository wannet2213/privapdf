import { useMemo, useState } from 'react';
import type { SplitOptions, SplitMode } from '../engine/types';
import { PdfPreview } from '../lib/pdf-preview';
import { toggleSelection } from '../lib/reorder';
import { parseRanges, parseGroups, validateRanges, validateGroups, type Range } from '../lib/split-parse';
import { tr } from '../lib/i18n';

interface SplitPanelProps {
  bytes: ArrayBuffer;
  filename: string;
  pageCount: number;
  onProcess: (options: SplitOptions) => void;
  busy: boolean;
}

type PageCard = { page: number; label: string };

export function SplitPanel({ bytes, filename, pageCount, onProcess, busy }: SplitPanelProps) {
  const [mode, setMode] = useState<SplitMode>('each');
  const [selected, setSelected] = useState<number[]>(Array.from({ length: pageCount }, (_, i) => i));
  const [rangeText, setRangeText] = useState('1-1');
  const [groupText, setGroupText] = useState('1\n2');
  const [asZip, setAsZip] = useState(true);

  const pages: PageCard[] = useMemo(() => Array.from({ length: pageCount }, (_, i) => ({ page: i, label: tr(`Halaman ${i + 1}`, `Page ${i + 1}`) })), [pageCount]);

  const parsedRanges: Range[] = useMemo(() => parseRanges(rangeText), [rangeText]);
  const rangeError = useMemo(() => validateRanges(parsedRanges, pageCount), [parsedRanges, pageCount]);

  const parsedGroups: number[][] = useMemo(() => parseGroups(groupText), [groupText]);
  const groupError = useMemo(() => validateGroups(parsedGroups, pageCount), [parsedGroups, pageCount]);

  const canRun = mode === 'each' ? selected.length > 0 : mode === 'ranges' ? !rangeError : !groupError;
  const outputCount = mode === 'each' ? selected.length : mode === 'ranges' ? parsedRanges.length : parsedGroups.filter((g) => g.length).length;

  const run = () => {
    if (mode === 'each') {
      onProcess({ mode: 'each', indices: selected, filename, asZip });
    } else if (mode === 'ranges') {
      onProcess({ mode: 'ranges', ranges: parsedRanges, filename, asZip });
    } else {
      onProcess({ mode: 'groups', groups: parsedGroups.filter((g) => g.length), filename, asZip });
    }
  };

  return (
    <div className="split-panel">
      <div className="split-tabs" role="tablist" aria-label={tr('Mode pemisahan PDF', 'PDF split mode')}>
        <button role="tab" aria-selected={mode === 'each'} className={`split-tab ${mode === 'each' ? 'is-active' : ''}`} onClick={() => setMode('each')}>
          {tr('Per halaman', 'Per page')}
          <small>{pageCount} file</small>
        </button>
        <button role="tab" aria-selected={mode === 'ranges'} className={`split-tab ${mode === 'ranges' ? 'is-active' : ''}`} onClick={() => setMode('ranges')}>
          {tr('Rentang', 'Ranges')}
          <small>1-5, 6-10</small>
        </button>
        <button role="tab" aria-selected={mode === 'groups'} className={`split-tab ${mode === 'groups' ? 'is-active' : ''}`} onClick={() => setMode('groups')}>
          {tr('Kelompok', 'Groups')}
          <small>1,3,5 | 2,6</small>
        </button>
      </div>

      <div className="split-content">
        {mode === 'each' && (
          <>
            <div className="preview-heading">
              <span>{tr('Pilih halaman', 'Choose pages')}</span>
              <small>{tr(`${selected.length} dari ${pageCount} dipilih`, `${selected.length} of ${pageCount} selected`)}</small>
            </div>
            <div className="split-bulk-actions">
              <button type="button" className="ghost-btn" onClick={() => setSelected(pages.map((p) => p.page))}>{tr('Pilih semua', 'Select all')}</button>
              <button type="button" className="ghost-btn" onClick={() => setSelected([])}>{tr('Kosongkan', 'Clear')}</button>
              <button type="button" className="ghost-btn" onClick={() => setSelected(selected.length === pageCount ? [] : pages.map((p) => p.page))}>
                {selected.length === pageCount ? tr('Kosongkan semua', 'Clear all') : tr('Balik pilihan', 'Invert selection')}
              </button>
            </div>
            <PdfPreview bytes={bytes} pages={pages} selected={selected} onToggle={(page) => setSelected(toggleSelection(selected, page, pages.map((c) => c.page)))} onMove={() => {}} />
            <p className="split-hint">{tr(`Setiap halaman yang dipilih akan menjadi file PDF terpisah (${selected.length} file output).`, `Each selected page becomes a separate PDF file (${selected.length} output files).`)}</p>
          </>
        )}

        {mode === 'ranges' && (
          <>
            <label className="split-field">
              <span className="split-field-label">{tr('Rentang halaman', 'Page ranges')}</span>
              <textarea
                className="split-input"
                value={rangeText}
                onChange={(e) => setRangeText(e.target.value)}
                placeholder={tr('Contoh: 1-5, 6-10\nAtau halaman tunggal: 1, 5, 10', 'Example: 1-5, 6-10\nOr single pages: 1, 5, 10')}
                rows={3}
                aria-describedby="range-hint"
              />
              <small id="range-hint" className="split-field-hint">{tr('Pisahkan dengan koma atau baris baru. Gunakan tanda hubung untuk rentang.', 'Separate with commas or new lines. Use a hyphen for a range.')}</small>
            </label>
            {rangeError ? (
              <div className="split-error" role="alert">{rangeError}</div>
            ) : (
              <div className="split-preview-list">
                <div className="preview-heading"><span>{tr('Hasil pemisahan', 'Split result')}</span><small>{parsedRanges.length} file</small></div>
                {parsedRanges.map(([s, e], i) => (
                  <div key={i} className="split-group-row">
                    <b>File {i + 1}</b>
                    <span>{tr('Halaman', 'Page')} {s === e ? s + 1 : `${s + 1}-${e + 1}`}</span>
                    <small>{tr(`${e - s + 1} halaman`, `${e - s + 1} page(s)`)}</small>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {mode === 'groups' && (
          <>
            <label className="split-field">
              <span className="split-field-label">{tr('Kelompok halaman', 'Page groups')}</span>
              <textarea
                className="split-input"
                value={groupText}
                onChange={(e) => setGroupText(e.target.value)}
                placeholder={tr('Contoh: 1,3,5 | 2,6,9\nAtau satu kelompok per baris:\n1,3,5\n2,6,9', 'Example: 1,3,5 | 2,6,9\nOr one group per line:\n1,3,5\n2,6,9')}
                rows={4}
                aria-describedby="group-hint"
              />
              <small id="group-hint" className="split-field-hint">{tr('Pisahkan kelompok dengan | atau ; atau baris baru. Pisahkan halaman dengan koma.', 'Separate groups with | or ; or a new line. Separate pages with commas.')}</small>
            </label>
            {groupError ? (
              <div className="split-error" role="alert">{groupError}</div>
            ) : (
              <div className="split-preview-list">
                <div className="preview-heading"><span>{tr('Hasil pemisahan', 'Split result')}</span><small>{parsedGroups.filter((g) => g.length).length} file</small></div>
                {parsedGroups.filter((g) => g.length).map((group, i) => (
                  <div key={i} className="split-group-row">
                    <b>File {i + 1}</b>
                    <span>{tr('Halaman', 'Pages')} {group.map((p) => p + 1).join(', ')}</span>
                    <small>{tr(`${group.length} halaman`, `${group.length} page(s)`)}</small>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {outputCount > 1 && (
        <label className="split-zip-toggle">
          <input type="checkbox" checked={asZip} onChange={(e) => setAsZip(e.target.checked)} />
          <span>
            {tr(`Kemas ${outputCount} file ke dalam `, `Pack ${outputCount} files into `)}<strong>{tr('satu arsip ZIP', 'one ZIP archive')}</strong>
            <small>{tr(`Lebih rapi daripada ${outputCount} unduhan terpisah`, `Tidier than ${outputCount} separate downloads`)}</small>
          </span>
        </label>
      )}

      <button className="primary" onClick={run} disabled={!canRun || busy}>
        {busy ? tr('Memproses…', 'Processing…') : (mode === 'each' ? tr(`Pisahkan ${selected.length} halaman`, `Split ${selected.length} pages`) : tr(`Pisahkan menjadi ${outputCount} file`, `Split into ${outputCount} files`)) + (asZip && outputCount > 1 ? ' (ZIP)' : '')}
      </button>
    </div>
  );
}
