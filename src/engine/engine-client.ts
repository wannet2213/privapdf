import type { JobRequest, JobEvent } from './types';
import { tr } from '../lib/i18n';
// Aset Office 237 MB (soffice.wasm 141 MB + soffice.data 95 MB) diunduh dari
// origin: pada koneksi lambat unduhannya saja ~2 menit. Batas 2 menit akan
// memutus pekerjaan yang sebenarnya sedang berjalan. Disamakan dengan batas
// inisialisasi WASM di browser.worker.js (10 menit, lihat scripts/copy-office-wasm.mjs).
const JOB_TIMEOUT=600_000;
export function runJob(request: JobRequest, onEvent: (event: JobEvent) => void) {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  return new Promise<ArrayBuffer[]>((resolve, reject) => {
    let settled=false;
    const timer=setTimeout(()=>finish(new Error(tr('Pemrosesan melebihi batas waktu.', 'Processing exceeded the time limit.'))),JOB_TIMEOUT);
    const finish=(error?:Error, outputs?:ArrayBuffer[])=>{if(settled)return; settled=true; clearTimeout(timer); worker.onmessage=null; worker.onerror=null; worker.onmessageerror=null; worker.terminate(); error?reject(error):resolve(outputs||[]);};
    worker.onmessage=(event:MessageEvent<JobEvent>)=>{const data=event.data;if(!data||data.jobId!==request.jobId)return;onEvent(data);if(data.type==='result')finish(undefined,data.outputs||[]);else if(data.type==='error')finish(new Error(data.error||tr('Pemrosesan gagal.', 'Processing failed.')));};
    worker.onerror=()=>finish(new Error(tr('Worker gagal dijalankan.', 'The worker failed to start.')));
    worker.onmessageerror=()=>finish(new Error(tr('Pesan worker tidak valid.', 'Invalid worker message.')));
    const inputs=request.inputs.map((input)=>input.slice(0));
    worker.postMessage({...request,inputs},inputs);
  });
}
