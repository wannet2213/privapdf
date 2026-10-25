import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { getDocument, GlobalWorkerOptions, Util, type PDFDocumentProxy, type PDFPageProxy, type PageViewport, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { TextEdit } from '../engines/edit-text';
import { tr } from '../lib/i18n';

GlobalWorkerOptions.workerSrc = workerUrl;

/** Font pratinjau sebuah baris: font asli halaman (FontFace dari pdf.js) dengan cadangan bergaya sama. */
interface LineFont { family: string; bold: boolean; italic: boolean }
/** Baris teks dalam koordinat tampilan halaman (poin, kiri-atas = 0,0); `lo`–`hi` = rentang baseline item yang digabung. */
interface Line { text: string; x: number; baseline: number; lo: number; hi: number; width: number; size: number; font: LineFont }
/** Suntingan di panel; `line` menunjuk baris asli, tanpa `line` = teks baru. */
interface Draft { page: number; line?: number; x: number; baseline: number; lo?: number; hi?: number; width: number; size: number; text: string; font?: LineFont }

interface EditTextPanelProps {
  bytes: ArrayBuffer;
  onProcess: (edits: TextEdit[]) => void;
  busy: boolean;
}

const NEW_TEXT_SIZE = 12;
// Canvas dirender lebih rapat dari ukuran tampil agar tetap tajam di layar penuh.
const RENDER_SCALE = Math.min(4, 2 * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1));
const NEW_TEXT_FONT: LineFont = { family: 'Helvetica, Arial, sans-serif', bold: false, italic: false };

type TextItem = { str: string; transform: number[]; width: number; fontName: string };

/**
 * Gaya font item pdf.js. Keluarga = FontFace asli yang dimuat pdf.js saat render, lalu cadangan
 * generik untuk glyph yang tidak ada di subset. Tebal/miring dibaca dari nama font
 * (pdf.js hanya menandai "bold", tidak "semibold"/"demi"/"heavy").
 */
function lineFont(page: PDFPageProxy, fontName: string, generic: string | undefined): LineFont {
  let font: { name?: string; bold?: boolean; black?: boolean; italic?: boolean } | undefined;
  try { font = page.commonObjs.has(fontName) ? page.commonObjs.get(fontName) : undefined; } catch { font = undefined; }
  const name = (font?.name ?? '').toLowerCase();
  return {
    family: `"${fontName}", ${generic ?? 'sans-serif'}`,
    bold: !!(font?.bold || font?.black) || /bold|black|heavy|semib|demi/.test(name),
    italic: !!font?.italic || /italic|oblique/.test(name),
  };
}

/** Gabungkan item pdf.js se-baseline jadi satu baris: unit edit, agar penghapusan tidak menyisakan potongan. */
export function toLines(items: TextItem[], viewport: PageViewport, fontOf: (name: string) => LineFont): Line[] {
  const raw = items.flatMap((it) => {
    if (!it.str.trim()) return [];
    const m = Util.transform(viewport.transform, it.transform);
    const size = Math.hypot(m[2], m[3]);
    // Hanya teks mendatar di layar; teks miring/vertikal tidak bisa diedit per baris.
    if (size < 1 || m[0] <= 0 || Math.abs(m[1]) > Math.abs(m[0]) * 0.01) return [];
    return [{ text: it.str, x: m[4], baseline: m[5], lo: m[5], hi: m[5], width: it.width * viewport.scale, size, font: fontOf(it.fontName) }];
  });
  const lines: (Line & { end: number })[] = [];
  for (const r of raw) {
    const cur = lines[lines.length - 1];
    const gap = cur ? r.x - cur.end : Infinity;
    if (cur && Math.abs(cur.baseline - r.baseline) <= Math.max(2, Math.max(cur.size, r.size) * 0.35) && gap > -r.size && gap <= r.size * 12) {
      cur.text += gap > r.size * 0.2 && !/\s$/.test(cur.text) && !/^\s/.test(r.text) ? ` ${r.text}` : r.text;
      // Area hapus harus mencakup setiap item yang digabung, termasuk yang mulai di kiri atau sedikit naik/turun.
      cur.x = Math.min(cur.x, r.x);
      cur.lo = Math.min(cur.lo, r.baseline);
      cur.hi = Math.max(cur.hi, r.baseline);
      cur.end = Math.max(cur.end, r.x + r.width);
      cur.width = cur.end - cur.x;
      cur.size = Math.max(cur.size, r.size);
    } else {
      lines.push({ ...r, end: r.x + r.width });
    }
  }
  return lines.map(({ end: _end, ...line }) => ({ ...line, text: line.text.trim() }));
}

/**
 * Area hapus baris dalam poin PDF. Hanya awal tiap operasi teks yang diuji engine, jadi cukup pita
 * sekitar rentang baseline item yang digabung, dari item paling kiri sampai ujung baris.
 */
export function lineRect(vp: PageViewport, d: Pick<Draft, 'x' | 'baseline' | 'lo' | 'hi' | 'width' | 'size'>): [number, number, number, number] {
  const [ax, ay] = vp.convertToPdfPoint(d.x - 1, (d.lo ?? d.baseline) - d.size * 0.45);
  const [bx, by] = vp.convertToPdfPoint(d.x + d.width + 1, (d.hi ?? d.baseline) + d.size * 0.45);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}

export function EditTextPanel({ bytes, onProcess, busy }: EditTextPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<PDFDocumentProxy | undefined>(undefined);
  const taskRef = useRef<RenderTask | undefined>(undefined);
  const viewports = useRef(new Map<number, PageViewport>());
  const [loading, setLoading] = useState(true);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [lines, setLines] = useState<Line[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [adding, setAdding] = useState(false);
  const [editor, setEditor] = useState<{ draft: Draft; index: number } | null>(null);
  const [full, setFull] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // File baru: suntingan lama menunjuk baris dokumen sebelumnya dan tidak boleh ikut terbawa.
    setDrafts([]);
    setEditor(null);
    setAdding(false);
    setCurrentPage(0);
    getDocument({ data: new Uint8Array(bytes.slice(0)), isEvalSupported: false }).promise.then((doc) => {
      if (cancelled) { void doc.destroy(); return; }
      docRef.current = doc;
      setPageCount(doc.numPages);
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      taskRef.current?.cancel();
      docRef.current?.destroy();
    };
  }, [bytes]);

  useEffect(() => {
    if (loading || !docRef.current) return;
    let cancelled = false;
    taskRef.current?.cancel();
    setEditor(null);
    (async () => {
      try {
        const page = await docRef.current!.getPage(currentPage + 1);
        if (cancelled) { page.cleanup(); return; }
        const viewport = page.getViewport({ scale: 1 });
        viewports.current.set(currentPage, viewport);
        const renderViewport = page.getViewport({ scale: RENDER_SCALE });
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;
        canvas.width = Math.ceil(renderViewport.width);
        canvas.height = Math.ceil(renderViewport.height);
        setPageSize({ width: viewport.width, height: viewport.height });
        const task = page.render({ canvasContext: ctx, viewport: renderViewport, intent: 'print' });
        taskRef.current = task;
        await task.promise;
        // Setelah render: font halaman sudah dimuat pdf.js, jadi gayanya bisa dibaca untuk pratinjau.
        const content = await page.getTextContent();
        if (cancelled) return;
        const fontOf = (name: string) => lineFont(page, name, content.styles[name]?.fontFamily);
        setLines(toLines(content.items.filter((it) => 'str' in it) as TextItem[], viewport, fontOf));
      } catch { /* halaman gagal render — biarkan canvas sebelumnya */ }
    })();
    return () => { cancelled = true; };
  }, [loading, currentPage]);

  // Layar penuh: kunci gulir halaman di belakang; Esc menutup, ← → pindah halaman (selama tidak mengetik).
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('textarea')) return;
      if (e.key === 'Escape') setFull(false);
      else if (e.key === 'ArrowLeft') setCurrentPage((p) => Math.max(0, p - 1));
      else if (e.key === 'ArrowRight') setCurrentPage((p) => Math.min(pageCount - 1, p + 1));
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [full, pageCount]);

  const pageDrafts = drafts.map((d, index) => ({ d, index })).filter(({ d }) => d.page === currentPage);
  const draftForLine = (line: number) => pageDrafts.find(({ d }) => d.line === line);

  const commit = (value: string) => {
    if (!editor) return;
    const { draft, index } = editor;
    setEditor(null);
    const original = draft.line !== undefined ? lines[draft.line]?.text : undefined;
    setDrafts((prev) => {
      const next = index >= 0 ? prev.filter((_, i) => i !== index) : [...prev];
      // Baris asli yang dikembalikan ke teks semula, atau teks baru yang dikosongkan, tidak perlu disimpan.
      if (value === original || (original === undefined && !value.trim())) return next;
      return [...next, { ...draft, text: value }];
    });
  };

  const openLine = (line: number) => {
    const existing = draftForLine(line);
    const l = lines[line];
    setEditor({ draft: existing?.d ?? { page: currentPage, line, x: l.x, baseline: l.baseline, lo: l.lo, hi: l.hi, width: l.width, size: l.size, text: l.text, font: l.font }, index: existing?.index ?? -1 });
  };

  const onLayerClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!adding || e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const k = rect.width / pageSize.width;
    const x = (e.clientX - rect.left) / k;
    const top = (e.clientY - rect.top) / k;
    setEditor({ draft: { page: currentPage, x, baseline: top + NEW_TEXT_SIZE, width: 0, size: NEW_TEXT_SIZE, text: '' }, index: -1 });
    setAdding(false);
  };

  const submit = () => {
    const out: TextEdit[] = drafts.flatMap((d) => {
      const vp = viewports.current.get(d.page);
      if (!vp) return [];
      const [x, y] = vp.convertToPdfPoint(d.x, d.baseline);
      const edit: TextEdit = { page: d.page, text: d.text, x, y, size: d.size, rotation: vp.rotation };
      if (d.line !== undefined) edit.rect = lineRect(vp, d);
      return [edit];
    });
    setFull(false);
    onProcess(out);
  };

  const pct = (v: number, total: number) => `${total ? (v / total) * 100 : 0}%`;
  // Ukuran huruf mengikuti lebar tampil halaman (cqw dari .edit-layer), di mode biasa maupun layar penuh.
  const lineBox = (x: number, baseline: number, width: number, size: number, font: LineFont = NEW_TEXT_FONT): CSSProperties => ({
    left: pct(x, pageSize.width), top: pct(baseline - size, pageSize.height),
    width: pct(width, pageSize.width), height: pct(size * 1.25, pageSize.height),
    fontSize: `${pageSize.width ? (size / pageSize.width) * 100 : 0}cqw`,
    fontFamily: font.family, fontWeight: font.bold ? 700 : 400, fontStyle: font.italic ? 'italic' : 'normal',
  });

  return (
    <div className="split-panel">
      <div className={full ? 'edit-fullview' : 'edit-inline'} role={full ? 'dialog' : undefined} aria-modal={full || undefined} aria-label={full ? tr('Edit teks — layar penuh', 'Edit text — full screen') : undefined}>
        <div className="crop-presets edit-toolbar">
          <button type="button" className={`ghost-btn ${adding ? 'is-active' : ''}`} aria-pressed={adding} onClick={() => setAdding((a) => !a)} disabled={loading}>
            {adding ? tr('Klik halaman untuk menaruh teks', 'Click the page to place text') : tr('＋ Tambah teks', '＋ Add text')}
          </button>
          <button type="button" className="ghost-btn" onClick={() => setDrafts((prev) => prev.slice(0, -1))} disabled={!drafts.length}>{tr('Urungkan', 'Undo')}</button>
          {pageCount > 1 && (
            <span className="edit-page-nav">
              <button type="button" className="ghost-btn" disabled={currentPage === 0} onClick={() => setCurrentPage((p) => Math.max(0, p - 1))} aria-label={tr('Halaman sebelumnya', 'Previous page')}>‹</button>
              <span>{currentPage + 1} / {pageCount}</span>
              <button type="button" className="ghost-btn" disabled={currentPage >= pageCount - 1} onClick={() => setCurrentPage((p) => Math.min(pageCount - 1, p + 1))} aria-label={tr('Halaman berikutnya', 'Next page')}>›</button>
            </span>
          )}
          {full && (
            <button type="button" className="primary edit-save" onClick={submit} disabled={busy || loading || !drafts.length || !!editor}>
              {drafts.length ? tr(`Simpan ${drafts.length} perubahan`, `Save ${drafts.length} change(s)`) : tr('Simpan', 'Save')}
            </button>
          )}
          <button type="button" className="ghost-btn" onClick={() => setFull((f) => !f)} aria-pressed={full} disabled={loading}>
            {full ? tr('✕ Tutup layar penuh', '✕ Exit full screen') : tr('⤢ Layar penuh', '⤢ Full screen')}
          </button>
        </div>

        <div className="edit-stage">
          <div className="crop-canvas-wrap redact-wrap">
            <canvas ref={canvasRef} className="annotate-canvas-base" />
            {!loading && pageSize.width > 0 && (
              <div className={`edit-layer ${adding ? 'is-adding' : ''}`} onClick={onLayerClick}>
                {lines.map((l, i) => {
                  const draft = draftForLine(i)?.d;
                  if (editor?.draft.page === currentPage && editor.draft.line === i) return null;
                  return (
                    <button key={i} type="button" className={`edit-line ${draft ? 'is-edited' : ''}`} style={lineBox(l.x, l.baseline, l.width, l.size, l.font)}
                      onClick={() => openLine(i)} aria-label={`${tr('Edit baris', 'Edit line')}: ${draft?.text ?? l.text}`} disabled={adding}>
                      {draft?.text}
                    </button>
                  );
                })}
                {pageDrafts.filter(({ d }) => d.line === undefined).map(({ d, index }) => (
                  editor?.index === index ? null : (
                    <button key={`n${index}`} type="button" className="edit-line is-edited is-new" style={lineBox(d.x, d.baseline, 0, d.size)}
                      onClick={() => setEditor({ draft: d, index })} aria-label={`${tr('Edit teks baru', 'Edit new text')}: ${d.text}`}>{d.text}</button>
                  )
                ))}
                {editor && editor.draft.page === currentPage && (
                  <textarea
                    className="edit-input"
                    style={{ ...lineBox(editor.draft.x, editor.draft.baseline, Math.max(editor.draft.width, 160), editor.draft.size, editor.draft.font), height: 'auto' }}
                    rows={Math.max(1, editor.draft.text.split('\n').length)}
                    defaultValue={editor.draft.text}
                    autoFocus
                    aria-label={tr('Teks baris', 'Line text')}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={(e) => commit(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); }
                      if (e.key === 'Escape') { e.preventDefault(); setEditor(null); }
                    }}
                  />
                )}
              </div>
            )}
            {loading && <div className="annotate-loading">{tr('Memuat halaman…', 'Loading page…')}</div>}
          </div>
        </div>

        <p className="annotate-caption">
          {!loading && !lines.length ? tr('Halaman ini tidak berisi teks yang bisa diedit (hasil scan? jalankan OCR dulu)', 'This page has no editable text (a scan? run OCR first)') : tr(`${lines.length} baris teks`, `${lines.length} text line(s)`)}
          {drafts.length > 0 && tr(` · ${drafts.length} perubahan`, ` · ${drafts.length} change(s)`)}
        </p>
      </div>

      <p className="split-hint">{tr('Klik baris untuk mengubahnya (Enter simpan, Shift+Enter baris baru, Esc batal). Teks asli dihapus dari isi PDF, bukan sekadar ditutup, lalu teks baru ditulis dengan font, ukuran, warna, dan ketebalan aslinya bila memungkinkan. Setelah disimpan, hasilnya diperiksa ulang.', 'Click a line to change it (Enter saves, Shift+Enter adds a line, Esc cancels). The original text is removed from the PDF content, not just covered up, then the new text is written with the original font, size, color, and weight where possible. After saving, the result is checked again.')}</p>
      <button className="primary" onClick={submit} disabled={busy || loading || !drafts.length || !!editor}>
        {busy ? tr('Memproses…', 'Processing…') : drafts.length ? tr(`Simpan ${drafts.length} perubahan`, `Save ${drafts.length} change(s)`) : tr('Simpan perubahan', 'Save changes')}
      </button>
    </div>
  );
}
