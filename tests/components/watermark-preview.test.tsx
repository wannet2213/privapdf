/**
 * Test integrasi preview watermark: merender AnnotatePanel sungguhan di jsdom
 * dengan canvas 2D yang direkam, lalu menggeser slider tinggi baris dan
 * memverifikasi jarak antar baris berubah sesuai nilai.
 */
import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Mock pdfjs sebelum import komponen
vi.mock('pdfjs-dist', () => ({
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 2,
      getPage: async () => ({
        getViewport: ({ scale }: { scale: number }) => ({ width: 200 * scale, height: 300 * scale }),
        render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
        cleanup: () => {},
      }),
      destroy: async () => {},
    }),
  }),
  GlobalWorkerOptions: { workerSrc: '' },
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }));

type FillCall = { text: string; x: number; y: number };
let fillCalls: FillCall[] = [];

function makeCtx(): CanvasRenderingContext2D {
  const measure = (t: string) => ({ width: t.length * 10 });
  return new Proxy({} as unknown as CanvasRenderingContext2D, {
    get(_t, prop) {
      switch (prop) {
        case 'measureText': return measure;
        case 'fillText': return (text: string, x: number, y: number) => { fillCalls.push({ text, x, y }); };
        case 'canvas': return {};
        default: return () => {};
      }
    },
    set() { return true; },
  });
}

let getCtxOrig: typeof HTMLCanvasElement.prototype.getContext;

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  getCtxOrig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function () { return makeCtx(); } as never;
});

afterAll(() => {
  HTMLCanvasElement.prototype.getContext = getCtxOrig;
});

function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function renderPanel(): Promise<{ root: Root; container: HTMLElement }> {
  const { AnnotatePanel } = await import('../../src/components/AnnotatePanel');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(AnnotatePanel, {
      bytes: new ArrayBuffer(10),
      mode: 'watermark',
      onProcess: () => {},
      busy: false,
    }));
  });
  await act(async () => {}); // tunggu load dokumen + render overlay
  return { root, container };
}

describe('preview watermark — tinggi baris', () => {
  it('jarak antar baris berubah mengikuti slider tinggi baris (teks multi-baris)', async () => {
    const { root, container } = await renderPanel();

    // Isi teks dua baris
    const textarea = container.querySelector('#wm-text') as HTMLTextAreaElement;
    await act(async () => setValue(textarea, 'AA\nBB'));

    const slider = container.querySelector('#wm-lineh') as HTMLInputElement;

    const lastTwoY = () => {
      const calls = fillCalls.slice(-2);
      expect(calls).toHaveLength(2);
      return Math.abs(calls[1].y - calls[0].y);
    };

    // Tinggi baris 2.5× → jarak = 2.5 × ukuran font (50) = 125
    fillCalls = [];
    await act(async () => setValue(slider, '2.5'));
    expect(lastTwoY()).toBeCloseTo(125, 0);

    // Tinggi baris 0.8× → jarak = 0.8 × 50 = 40
    fillCalls = [];
    await act(async () => setValue(slider, '0.8'));
    expect(lastTwoY()).toBeCloseTo(40, 0);

    // Teks tercatat benar per baris
    expect(fillCalls.slice(-2).map((c) => c.text)).toEqual(['AA', 'BB']);

    await act(async () => root.unmount());
    container.remove();
  });

  it('teks satu baris: posisi tidak berubah saat tinggi baris digeser (perilaku benar)', async () => {
    const { root, container } = await renderPanel();
    const slider = container.querySelector('#wm-lineh') as HTMLInputElement;

    fillCalls = [];
    await act(async () => setValue(slider, '2.5'));
    const y1 = fillCalls.at(-1)!.y;

    fillCalls = [];
    await act(async () => setValue(slider, '0.8'));
    const y2 = fillCalls.at(-1)!.y;

    // Satu baris: baseline tetap di tengah blok → tidak bergeser
    expect(y1).toBeCloseTo(y2, 6);

    await act(async () => root.unmount());
    container.remove();
  });
});
