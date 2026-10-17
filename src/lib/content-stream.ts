/**
 * Tokenizer content stream PDF. Tiap operasi menyimpan rentang byte aslinya sehingga
 * operasi tertentu bisa diganti tanpa menyentuh byte lain (inline image tetap utuh).
 */

/** Nama ditulis tanpa '/', string sebagai byte mentah, dict sebagai objek biasa. */
export type Operand = number | boolean | null | string | Uint8Array | Operand[] | { [key: string]: Operand };

export interface Op {
  operator: string;
  operands: Operand[];
  /** Rentang byte [start, end) operasi ini, termasuk operand-nya. */
  start: number;
  end: number;
}

class Keyword { constructor(readonly op: string) {} }
class Close { constructor(readonly ch: string) {} }

const isWhite = (c: number) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const isDelim = (c: number) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
const hexVal = (c: number) => (c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1);

class Lexer {
  pos = 0;
  constructor(readonly b: Uint8Array) {}

  skipSpace() {
    const b = this.b;
    while (this.pos < b.length) {
      const c = b[this.pos];
      if (isWhite(c)) this.pos++;
      else if (c === 37) { while (this.pos < b.length && b[this.pos] !== 10 && b[this.pos] !== 13) this.pos++; }
      else break;
    }
  }

  /** Satu token: nilai operand, atau { op } untuk kata kunci operator. */
  next(): Operand | Keyword | Close | undefined {
    this.skipSpace();
    const b = this.b;
    if (this.pos >= b.length) return undefined;
    const c = b[this.pos];
    if (c === 40) return this.literal();
    if (c === 60) {
      if (b[this.pos + 1] === 60) { this.pos += 2; return this.dict(); }
      return this.hex();
    }
    if (c === 91) { this.pos++; return this.array(); }
    if (c === 93 || c === 41 || c === 125) { this.pos++; return new Close(String.fromCharCode(c)); }
    if (c === 62 && b[this.pos + 1] === 62) { this.pos += 2; return new Close('>>'); }
    if (c === 47) return this.name();
    const start = this.pos;
    while (this.pos < b.length && !isWhite(b[this.pos]) && !isDelim(b[this.pos])) this.pos++;
    if (this.pos === start) { this.pos++; return new Keyword(String.fromCharCode(c)); }
    const word = String.fromCharCode(...b.subarray(start, this.pos));
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return Number(word);
    if (word === 'true' || word === 'false') return word === 'true';
    if (word === 'null') return null;
    return new Keyword(word);
  }

  name(): string {
    const b = this.b;
    this.pos++;
    let out = '';
    while (this.pos < b.length && !isWhite(b[this.pos]) && !isDelim(b[this.pos])) {
      if (b[this.pos] === 35 && hexVal(b[this.pos + 1]) >= 0 && hexVal(b[this.pos + 2]) >= 0) {
        out += String.fromCharCode(hexVal(b[this.pos + 1]) * 16 + hexVal(b[this.pos + 2]));
        this.pos += 3;
      } else out += String.fromCharCode(b[this.pos++]);
    }
    return out;
  }

  literal(): Uint8Array {
    const b = this.b;
    const out: number[] = [];
    let depth = 1;
    this.pos++;
    while (this.pos < b.length) {
      const c = b[this.pos++];
      if (c === 92) {
        const n = b[this.pos++];
        const esc: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 };
        if (n in esc) out.push(esc[n]);
        else if (n >= 48 && n <= 55) {
          let v = n - 48;
          for (let i = 0; i < 2 && b[this.pos] >= 48 && b[this.pos] <= 55; i++) v = v * 8 + b[this.pos++] - 48;
          out.push(v & 255);
        } else if (n === 13) { if (b[this.pos] === 10) this.pos++; }
        else if (n !== 10) out.push(n);
      } else if (c === 40) { depth++; out.push(c); }
      else if (c === 41) { if (--depth === 0) break; out.push(c); }
      else out.push(c);
    }
    return Uint8Array.from(out);
  }

  hex(): Uint8Array {
    const b = this.b;
    const digits: number[] = [];
    this.pos++;
    while (this.pos < b.length && b[this.pos] !== 62) {
      const v = hexVal(b[this.pos++]);
      if (v >= 0) digits.push(v);
    }
    this.pos++;
    if (digits.length % 2) digits.push(0);
    const out = new Uint8Array(digits.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = digits[2 * i] * 16 + digits[2 * i + 1];
    return out;
  }

  array(): Operand[] {
    const out: Operand[] = [];
    for (;;) {
      const t = this.next();
      if (t === undefined || t instanceof Close) return out;
      if (t instanceof Keyword) continue; // kata kunci liar di dalam array — abaikan
      out.push(t);
    }
  }

  dict(): { [key: string]: Operand } {
    const out: { [key: string]: Operand } = {};
    for (;;) {
      const k = this.next();
      if (k === undefined || k instanceof Close) return out;
      if (typeof k !== 'string') continue;
      const v = this.next();
      if (v === undefined || v instanceof Close) return out;
      if (!(v instanceof Keyword)) out[k] = v;
    }
  }
}

export function parseOps(bytes: Uint8Array): Op[] {
  const lx = new Lexer(bytes);
  const ops: Op[] = [];
  let operands: Operand[] = [];
  let start = -1;
  for (;;) {
    lx.skipSpace();
    const tokenStart = lx.pos;
    const t = lx.next();
    if (t === undefined) break;
    if (start < 0) start = tokenStart;
    if (t instanceof Close) continue;
    if (t instanceof Keyword) {
      const operator = t.op;
      if (operator === 'BI') skipInlineImage(lx);
      ops.push({ operator, operands, start, end: lx.pos });
      operands = [];
      start = -1;
    } else operands.push(t);
  }
  return ops;
}

/** Lewati dict + data biner inline image (BI … ID <data> EI) agar data biner tidak dibaca sebagai token. */
function skipInlineImage(lx: Lexer) {
  const b = lx.b;
  for (;;) {
    const t = lx.next();
    if (t === undefined) return;
    if (t instanceof Keyword && t.op === 'ID') break;
  }
  lx.pos++; // satu spasi pemisah setelah ID
  // EI sah bila diapit spasi/akhir data — data biner bisa saja memuat byte "EI".
  while (lx.pos < b.length) {
    if (b[lx.pos] === 69 && b[lx.pos + 1] === 73 && isWhite(b[lx.pos - 1]) && (lx.pos + 2 >= b.length || isWhite(b[lx.pos + 2]))) {
      lx.pos += 2;
      return;
    }
    lx.pos++;
  }
}

/** Ganti rentang byte operasi tertentu; byte lain disalin apa adanya. */
export function spliceOps(bytes: Uint8Array, replacements: Map<Op, string>): Uint8Array {
  const sorted = [...replacements].sort(([a], [b]) => a.start - b.start);
  const parts: Uint8Array[] = [];
  let cursor = 0;
  for (const [op, text] of sorted) {
    parts.push(bytes.subarray(cursor, op.start), new TextEncoder().encode(text));
    cursor = op.end;
  }
  parts.push(bytes.subarray(cursor));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}
