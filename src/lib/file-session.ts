import {validateCount,validateFile,validateMagicBytes} from './validation';
import {uid} from './uid';
export type SessionFile={id:string;name:string;type:string;size:number;bytes:ArrayBuffer};
export async function readSessionFiles(files:File[]):Promise<SessionFile[]>{validateCount(files); return Promise.all(files.map(async file=>{const meta=validateFile(file); const bytes=await file.arrayBuffer(); validateMagicBytes(bytes,meta.ext); return {id:uid(),name:meta.name,type:file.type,size:file.size,bytes};}));}
export function clearSession(files:SessionFile[]){for(const f of files){new Uint8Array(f.bytes).fill(0);} files.length=0;}
