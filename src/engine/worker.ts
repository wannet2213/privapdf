import {
  mergePdf, mergePages, splitPdfEach, splitPdfGroups, splitPdfRanges, rotatePdf, imageToPdf,
  deletePages, reorderPages, addPageNumbers, addWatermark, updateMetadata, cropPages, compressPdf, unlockPdf, protectPdf, flattenForm,
} from '../engines/pdf-native';
import { officeToPdf } from '../engines/office-native';
import { isJobRequest, errorEvent } from './protocol';
import { validateMagicBytes } from '../lib/validation';
import type { SplitMode } from './types';

const PDF_OPS = new Set(['merge', 'merge-pages', 'split', 'rotate', 'delete-pages', 'reorder-pages', 'page-numbers', 'watermark', 'metadata', 'crop', 'compress', 'unlock', 'protect', 'flatten']);

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
    else if (PDF_OPS.has(req.operation)) req.inputs.forEach((input) => validateMagicBytes(input, 'pdf'));

    send({ jobId: req.jobId, type: 'progress', phase: 'load engine', progress: .35 });
    let outputs: ArrayBuffer[] = [];
    let outputNames: string[] | undefined;

    if (req.operation === 'merge') {
      outputs = [await mergePdf(req.inputs)];
    } else if (req.operation === 'merge-pages') {
      const refs = (req.options?.refs as { file: number; page: number }[]) || [];
      if (!refs.length) throw new Error('Tidak ada halaman yang dipilih untuk digabungkan.');
      outputs = [await mergePages(req.inputs, refs)];
    } else if (req.operation === 'split') {
      const mode = (req.options?.mode as SplitMode) || 'each';
      const baseName = String(req.options?.filename || 'document');
      if (mode === 'ranges') {
        const ranges = (req.options?.ranges as [number, number][]) || [];
        if (!ranges.length) throw new Error('Tidak ada rentang halaman yang ditentukan.');
        outputs = await splitPdfRanges(req.inputs[0], ranges);
        outputNames = ranges.map(([s, en]) => `${baseName.replace(/\.pdf$/i, '')}-${s === en ? `hal-${s + 1}` : `hal-${s + 1}-${en + 1}`}.pdf`);
      } else if (mode === 'groups') {
        const groups = (req.options?.groups as number[][]) || [];
        if (!groups.filter((g) => g.length).length) throw new Error('Tidak ada kelompok halaman yang ditentukan.');
        outputs = await splitPdfGroups(req.inputs[0], groups);
        outputNames = groups.filter((g) => g.length).map((g, i) => `${baseName.replace(/\.pdf$/i, '')}-grup-${i + 1}-hal-${g.map((p) => p + 1).join('-')}.pdf`);
      } else {
        const indices = (req.options?.indices as number[]) || [];
        if (!indices.length) throw new Error('Tidak ada halaman yang dipilih.');
        outputs = await splitPdfEach(req.inputs[0], indices);
        outputNames = indices.map((idx) => `${baseName.replace(/\.pdf$/i, '')}-hal-${idx + 1}.pdf`);
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
      if (!indices.length) throw new Error('Tidak ada halaman yang dipilih untuk dihapus.');
      outputs = [await deletePages(req.inputs[0], indices)];
    } else if (req.operation === 'reorder-pages') {
      const order = (req.options?.order as number[]) || [];
      if (!order.length) throw new Error('Urutan halaman tidak ditentukan.');
      outputs = [await reorderPages(req.inputs[0], order)];
    } else if (req.operation === 'page-numbers') {
      outputs = [await addPageNumbers(req.inputs[0], req.options as never)];
    } else if (req.operation === 'watermark') {
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
      if (!password) throw new Error('Password tidak boleh kosong.');
      const ownerPassword = typeof req.options?.ownerPassword === 'string' && req.options.ownerPassword ? req.options.ownerPassword : undefined;
      const baseName = String(req.options?.filename || 'document').replace(/\.pdf$/i, '');
      outputs = [await protectPdf(req.inputs[0], { password, ownerPassword })];
      outputNames = [`${baseName}-terproteksi.pdf`];
    } else if (req.operation === 'flatten') {
      const baseName = String(req.options?.filename || 'document').replace(/\.pdf$/i, '');
      outputs = [await flattenForm(req.inputs[0])];
      outputNames = [`${baseName}-flat.pdf`];
    } else {
      throw new Error(`Operasi '${req.operation}' tidak didukung oleh worker.`);
    }

    send({ jobId: req.jobId, type: 'progress', phase: 'process', progress: .8, status: 'Memproses dokumen…' });
    send({ jobId: req.jobId, type: 'progress', phase: 'sanitize', progress: .9, status: 'Pemeriksaan akhir…' });
    send({ jobId: req.jobId, type: 'progress', phase: 'finalize', progress: 1, status: 'Menyelesaikan…' });
    send({ jobId: req.jobId, type: 'result', outputs, outputNames }, outputs);
  } catch (err) {
    send(errorEvent(req.jobId, err instanceof Error ? err.message : 'Pemrosesan gagal.'));
  }
};
