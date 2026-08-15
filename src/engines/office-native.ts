import { WorkerBrowserConverter, createWasmPaths } from '@matbee/libreoffice-converter/browser';

type Progress = (percent: number, message: string) => void;
let converterPromise: Promise<WorkerBrowserConverter> | undefined;

function getConverter(onProgress?: Progress) {
  if (!converterPromise) {
    converterPromise = Promise.resolve(new WorkerBrowserConverter({
      ...createWasmPaths('/wasm/office/'),
      browserWorkerJs: '/wasm/office/browser.worker.js',
      onProgress: (info) => onProgress?.(info.percent, info.message),
    })).then(async (instance) => {
      await instance.initialize();
      return instance;
    }).catch((error) => {
      converterPromise = undefined;
      throw error;
    });
  }
  return converterPromise;
}

export async function officeToPdf(input: ArrayBuffer, filename: string, onProgress?: Progress) {
  const converter = await getConverter(onProgress);
  const result = await converter.convert(input, { outputFormat: 'pdf' }, filename);
  return { data: result.data.buffer.slice(result.data.byteOffset, result.data.byteOffset + result.data.byteLength), filename: result.filename, mimeType: result.mimeType };
}

export async function destroyOfficeConverter() {
  if (converterPromise) {
    const converter = await converterPromise.catch(() => undefined);
    await converter?.destroy();
    converterPromise = undefined;
  }
}

export function officeCapability() { const isolated = typeof crossOriginIsolated === 'boolean' && crossOriginIsolated; const wasm = typeof WebAssembly !== 'undefined'; const worker = typeof Worker !== 'undefined'; return { available: isolated && wasm && worker, reason: isolated && wasm && worker ? 'Runtime Office WASM siap dimuat.' : 'Memerlukan COOP/COEP, WebAssembly, dan Worker.' }; }
