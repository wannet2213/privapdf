import {
  mergePdf, mergePages, splitPdfEach, splitPdfGroups, splitPdfRanges, rotatePdf, imageToPdf,
  deletePages, reorderPages, addPageNumbers, addWatermark, updateMetadata, cropPages, compressPdf, unlockPdf, protectPdf, flattenForm, sanitizePdf, redactPdf, nUpPdf, type NupLayout,
} from '../engines/pdf-native';
import { officeToPdf } from '../engines/office-native';
import { editText, type TextEdit } from '../engines/edit-text';
import { isJobRequest, errorEvent } from './protocol';
import { validateMagicBytes } from '../lib/validation';
import type { SplitMode } from './types';
import { tr } from '../lib/i18n';

const PAGE = tr('hal', 'page');
const PDF_OPS =new Set(['merge', 'merge-pages', 'split', 'rotate', 'delete-pages', 'reorder-pages', 'page-numbers', 'watermark', 'metadata', 'crop', 'compress', 'unlock', 'protect', 'flatten', 'sanitize', 'n-up', 'edit-text']);

self.onmessage = async (e: MessageEvent) => {
  const req = e.data;
  if (!isJobRequest(req)) return;
  const send = (x: unknown, transfer: Transferable[] = []) => self.postMessage(x, { transfer });
  try {
    send({ jobId: req.jobId, type: 'progress', phase: 'validate', progress: .15 });
    const extensions: Record<string, string> = {
      'image-to-pdf': String(req.options?.type || 'png'),
      'office-to-pdf': String(req.options?.filename || 'document.docx').split('.').pop() || 'docx',
    };
    if (req.operation === 'image-to-pdf' || req.operation === 'office-to-pdf') validateMagicBytes(req.inputs[0], extensions[req.operation]);
    else if (req.operation === 'redact') req.inputs.forEach((input, i) => validateMagicBytes(input, i ? 'jpg' : 'pdf'));
    else if (PDF_OPS.has(req.operation)) req.inputs.forEach((input) => validateMagicBytes(input, 'pdf'));

    send({ jobId: req.jobId, type: 'progress', phase: 'load engine', progress: .35 });
    let outputs: ArrayBuffer[] = [];
    let outputNames: string[] | undefined;

    if (req.operation === 'merge') {
      outputs = [await mergePdf(req.inputs)];
    } else if (req.operation === 'merge-pages') {
      const refs = (req.options?.refs as { file: number; page: number }[]) || [];
      if (!refs.length) throw new Error(tr('Tidak ada halaman yang dipilih untuk digabungkan.', 'No pages selected to merge.'));
      outputs = [await mergePages(req.inputs, refs)];
    } else if (req.operation === 'split') {
      const mode = (req.options?.mode as SplitMode) || 'each';
      const baseName = String(req.options?.filename || 'document');
      if (mode === 'ranges') {
        const ranges = (req.options?.ranges as [number, number][]) || [];
        if (!ranges.length) throw new Error(tr('Tidak ada rentang halaman yang ditentukan.', 'No page ranges given.'));
        outputs = await splitPdfRanges(req.inputs[0], ranges);
        outputNames = ranges.map(([s, en]) => `${baseName.replace(/\.pdf$/i, '')}-${PAGE}-${s === en ? s + 1 : `${s + 1}-${en + 1}`}.pdf`);
      } else if (mode === 'groups') {
        const groups = (req.options?.groups as number[][]) || [];
        if (!groups.filter((g) => g.length).length) throw new Error(tr('Tidak ada kelompok halaman yang ditentukan.', 'No page groups given.'));
        outputs = await splitPdfGroups(req.inputs[0], groups);
        outputNames = groups.filter((g) => g.length).map((g, i) => `${baseName.replace(/\.pdf$/i, '')}-${tr('grup', 'group')}-${i + 1}-${PAGE}-${g.map((p) => p + 1).join('-')}.pdf`);
      } else {
        const indices = (req.options?.indices as number[]) || [];
        if (!indices.length) throw new Error(tr('Tidak ada halaman yang dipilih.', 'No pages selected.'));
        outputs = await splitPdfEach(req.inputs[0], indices);
        outputNames = indices.map((idx) => `${baseName.replace(/\.pdf$/i, '')}-${PAGE}-${idx + 1}.pdf`);
      }
    } else if (req.operation === 'rotate') {
      // Format baru: pages[{index, angle}]; format lama: angle tunggal untuk semua halaman
      const perPage = req.options?.pages as { index: number; angle: number }[] | undefined;
      if (perPage?.length) {
        // Grup halaman per sudut, terapkan berurutan
        const byAngle = new Map<number, number[]>();
        for (const p of perPage) {
          const arr = byAngle.get(p.angle) ?? [];
          arr.push(p.index);
          byAngle.set(p.angle, arr);
        }
        let buf = req.inputs[0];
        for (const [angle, pages] of byAngle) {
          buf = await rotatePdf(buf, { angle, pages });
        }
        outputs = [buf];
      } else {
        outputs = [await rotatePdf(req.inputs[0], Number(req.options?.angle) || 90)];
      }
    } else if (req.operation === 'image-to-pdf') {
      outputs = [await imageToPdf(req.inputs[0], (req.options?.type as 'png' | 'jpg') || 'png')];
    } else if (req.operation === 'office-to-pdf') {
      const result = await officeToPdf(req.inputs[0], String(req.options?.filename || 'document.docx'), (percent, status) => send({ jobId: req.jobId, type: 'progress', phase: 'process', progress: percent / 100, status }));
      outputs = [result.data as ArrayBuffer];
      outputNames = [result.filename];
    } else if (req.operation === 'delete-pages') {
      const indices = (req.options?.indices as number[]) || [];
      if (!indices.length) throw new Error(tr('Tidak ada halaman yang dipilih untuk dihapus.', 'No pages selected to delete.'));
      outputs = [await deletePages(req.inputs[0], indices)];
    } else if (req.operation === 'reorder-pages') {
      const order = (req.options?.order as number[]) || [];
      if (!order.length) throw new Error(tr('Urutan halaman tidak ditentukan.', 'No page order given.'));
      outputs = [await reorderPages(req.inputs[0], order)];
    } else if (req.operation === 'page-numbers') {
      outputs = [await addPageNumbers(req.inputs[0], req.options as never)];
    } else if (req.operation === 'watermark') {
      const img = req.options?.imageBytes;
      if (img instanceof ArrayBuffer) validateMagicBytes(img, String(req.options?.imageType || 'png'));
      outputs = [await addWatermark(req.inputs[0], req.options as never)];
    } else if (req.operation === 'metadata') {
      outputs = [await updateMetadata(req.inputs[0], req.options as never)];
    } else if (req.operation === 'crop') {
      outputs = [await cropPages(req.inputs[0], req.options as never)];
    } else if (req.operation === 'compress') {
      outputs = [await compressPdf(req.inputs[0])];
    } else if (req.operation === 'unlock') {
      const password = typeof req.options?.password === 'string' ? req.options.password : undefined;
      outputs = [await unlockPdf(req.inputs[0], password)];
    } else if (req.operation === 'protect') {
      const password = typeof req.options?.password === 'string' ? req.options.password : '';
      if (!password) throw new Error(tr('Password tidak boleh kosong.', 'Password must not be empty.'));
      const ownerPassword = typeof req.options?.ownerPassword === 'string' && req.options.ownerPassword ? req.options.ownerPassword : undefined;
      const baseName = String(req.options?.filename || 'document').replace(/\.pdf$/i, '');
      outputs = [await protectPdf(req.inputs[0], { password, ownerPassword })];
      outputNames = [`${baseName}-${tr('terproteksi', 'protected')}.pdf`];
    } else if (req.operation === 'flatten') {
      const baseName = String(req.options?.filename || 'document').replace(/\.pdf$/i, '');
      outputs = [await flattenForm(req.inputs[0])];
      outputNames = [`${baseName}-flat.pdf`];
    } else if (req.operation === 'sanitize') {
      const baseName = String(req.options?.filename || 'document').replace(/\.pdf$/i, '');
      outputs = [await sanitizePdf(req.inputs[0])];
      outputNames = [`${baseName}-${tr('bersih', 'clean')}.pdf`];
    } else if (req.operation === 'redact') {
      // inputs: [pdf, jpg halaman pages[0], jpg halaman pages[1], …]
      const pages = (req.options?.pages as number[]) || [];
      if (!pages.length || pages.length !== req.inputs.length - 1) throw new Error(tr('Tidak ada halaman yang disensor.', 'No pages to redact.'));
      const baseName = String(req.options?.filename || 'document').replace(/\.pdf$/i, '');
      outputs = [await redactPdf(req.inputs[0], new Map(pages.map((p, i) => [p, req.inputs[i + 1]])), Number(req.options?.scale) || 2)];
      outputNames = [`${baseName}-${tr('disensor', 'redacted')}.pdf`];
    } else if (req.operation === 'n-up') {
      const layout = String(req.options?.layout || '2') as NupLayout;
      if (!['2', '4', 'booklet'].includes(layout)) throw new Error(tr('Tata letak tidak dikenal.', 'Unknown layout.'));
      const baseName = String(req.options?.filename || 'document').replace(/\.pdf$/i, '');
      outputs = [await nUpPdf(req.inputs[0], layout)];
      outputNames = [`${baseName}-${layout === 'booklet' ? tr('buklet', 'booklet') : `${layout}-${tr('per-lembar', 'per-sheet')}`}.pdf`];
    } else if (req.operation === 'edit-text') {
      const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
      const edits = (Array.isArray(req.options?.edits) ? req.options.edits : []) as TextEdit[];
      if (!edits.length) throw new Error(tr('Tidak ada perubahan teks.', 'No text changes.'));
      if (!edits.every((e) => typeof e?.text === 'string' && [e.page, e.x, e.y, e.size, e.rotation].every(isNum) && (e.rect === undefined || (Array.isArray(e.rect) && e.rect.length === 4 && e.rect.every(isNum))))) {
        throw new Error(tr('Data perubahan teks tidak valid.', 'Invalid text change data.'));
      }
      const baseName = String(req.options?.filename || 'document').replace(/\.pdf$/i, '');
      outputs = [await editText(req.inputs[0], edits)];
      outputNames = [`${baseName}-${tr('diedit', 'edited')}.pdf`];
    } else {
      throw new Error(tr(`Operasi '${req.operation}' tidak didukung oleh worker.`, `Operation '${req.operation}' is not supported by the worker.`));
    }

    send({ jobId: req.jobId, type: 'progress', phase: 'process', progress: .8, status: tr('Memproses dokumen…', 'Processing document…') });
    send({ jobId: req.jobId, type: 'progress', phase: 'sanitize', progress: .9, status: tr('Pemeriksaan akhir…', 'Final check…') });
    send({ jobId: req.jobId, type: 'progress', phase: 'finalize', progress: 1, status: tr('Menyelesaikan…', 'Finishing…') });
    send({ jobId: req.jobId, type: 'result', outputs, outputNames }, outputs);
  } catch (err) {
    send(errorEvent(req.jobId, err instanceof Error ? err.message : tr('Pemrosesan gagal.', 'Processing failed.')));
  }
};
