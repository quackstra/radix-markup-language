// Pure, isomorphic envelope codec. No hashing or compression here — those are
// injected (see resolver) or done by the CLI. All integers little-endian.
import {
  MAGIC, VERSION, Op, Compression, MAX_NOTE_BYTES, CHUNK_PAYLOAD_BYTES, MAX_MESSAGE_BYTES,
  type Envelope, type PublishChunk, type CompressionCode,
} from './types.js';

const te = new TextEncoder();
const td = new TextDecoder('utf-8', { fatal: true });

export function normalizePath(path: string): string {
  if (typeof path !== 'string' || path.length === 0) throw new Error('path required');
  let p = path.normalize('NFC');
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1 && p.endsWith('/')) p = p.replace(/\/+$/, '');
  if (p === '') p = '/';
  return p;
}

// ---- writer ----
class Writer {
  private parts: number[] = [];
  u8(v: number) { this.parts.push(v & 0xff); return this; }
  u16(v: number) { this.parts.push(v & 0xff, (v >>> 8) & 0xff); return this; }
  bytes(b: Uint8Array) { for (const x of b) this.parts.push(x); return this; }
  lenPrefixed(b: Uint8Array) {
    if (b.length > 0xffff) throw new Error('field too long');
    return this.u16(b.length).bytes(b);
  }
  str(s: string) { return this.lenPrefixed(te.encode(s)); }
  done(): Uint8Array { return Uint8Array.from(this.parts); }
}

// ---- reader ----
class Reader {
  private o = 0;
  constructor(private readonly b: Uint8Array) {}
  get offset() { return this.o; }
  get remaining() { return this.b.length - this.o; }
  u8() { this.need(1); return this.b[this.o++]!; }
  u16() { this.need(2); const v = this.b[this.o]! | (this.b[this.o + 1]! << 8); this.o += 2; return v; }
  take(n: number): Uint8Array { this.need(n); const s = this.b.subarray(this.o, this.o + n); this.o += n; return s; }
  lenPrefixed(): Uint8Array { const n = this.u16(); return this.take(n); }
  str(): string { return td.decode(this.lenPrefixed()); }
  rest(): Uint8Array { const s = this.b.subarray(this.o); this.o = this.b.length; return s; }
  private need(n: number) { if (this.o + n > this.b.length) throw new Error('unexpected end of envelope'); }
}

function writeHeader(w: Writer, op: number) {
  w.bytes(MAGIC).u8(VERSION).u8(op);
}

export function encodeDelete(path: string, note = ''): Uint8Array {
  const w = new Writer();
  writeHeader(w, Op.DELETE);
  w.str(normalizePath(path)).str(clampNote(note));
  return sized(w.done());
}

export function encodeRedirect(from: string, to: string, note = ''): Uint8Array {
  const w = new Writer();
  writeHeader(w, Op.REDIRECT);
  w.str(normalizePath(from)).str(clampNote(note)).str(normalizePath(to));
  return sized(w.done());
}

export interface PublishMeta {
  path: string;
  note?: string;
  snapshotId: Uint8Array; // 16 bytes
  contentHash: Uint8Array; // 32 bytes
  compression: CompressionCode;
  dictRef?: Uint8Array; // empty in v0
}

// Split an already-(optionally-)compressed stream into head + body chunk messages.
export function encodePublishChunks(meta: PublishMeta, stream: Uint8Array): Uint8Array[] {
  if (meta.snapshotId.length !== 16) throw new Error('snapshotId must be 16 bytes');
  if (meta.contentHash.length !== 32) throw new Error('contentHash must be 32 bytes');
  const path = normalizePath(meta.path);
  const note = clampNote(meta.note ?? '');
  const dictRef = meta.dictRef ?? new Uint8Array(0);

  const slices: Uint8Array[] = [];
  if (stream.length === 0) {
    slices.push(new Uint8Array(0));
  } else {
    for (let i = 0; i < stream.length; i += CHUNK_PAYLOAD_BYTES) {
      slices.push(stream.subarray(i, Math.min(i + CHUNK_PAYLOAD_BYTES, stream.length)));
    }
  }
  const chunkCount = slices.length;
  if (chunkCount > 0xffff) throw new Error('too many chunks');

  const out: Uint8Array[] = [];
  slices.forEach((slice, index) => {
    const w = new Writer();
    writeHeader(w, Op.PUBLISH);
    w.bytes(meta.snapshotId).u16(index);
    if (index === 0) {
      // head chunk: metadata + first slice
      w.u16(chunkCount)
        .str(path)
        .str(note)
        .bytes(meta.contentHash)
        .u8(meta.compression)
        .lenPrefixed(dictRef);
    }
    w.bytes(slice);
    out.push(sized(w.done()));
  });
  return out;
}

export function decode(bytes: Uint8Array): Envelope {
  const r = new Reader(bytes);
  const m0 = r.u8(), m1 = r.u8();
  if (m0 !== MAGIC[0] || m1 !== MAGIC[1]) throw new Error('bad magic');
  const version = r.u8();
  if (version !== VERSION) throw new Error(`unsupported version ${version}`);
  const op = r.u8();
  switch (op) {
    case Op.DELETE: {
      const path = normalizePath(r.str());
      const note = r.str();
      return { op: Op.DELETE, path, note: note || undefined };
    }
    case Op.REDIRECT: {
      const path = normalizePath(r.str());
      const note = r.str();
      const target = normalizePath(r.str());
      return { op: Op.REDIRECT, path, note: note || undefined, target };
    }
    case Op.PUBLISH: {
      const snapshotId = r.take(16).slice();
      const chunkIndex = r.u16();
      if (chunkIndex === 0) {
        const chunkCount = r.u16();
        const path = normalizePath(r.str());
        const note = r.str();
        const contentHash = r.take(32).slice();
        const compression = r.u8() as CompressionCode;
        if (compression !== Compression.NONE && compression !== Compression.ZSTD) {
          throw new Error(`unknown compression ${compression}`);
        }
        const dictRef = r.lenPrefixed().slice();
        const payload = r.rest().slice();
        const chunk: PublishChunk = {
          op: Op.PUBLISH, path, snapshotId, chunkIndex, chunkCount,
          note: note || undefined, contentHash, compression, dictRef, payload,
        };
        return chunk;
      }
      return { op: Op.PUBLISH, path: '', snapshotId, chunkIndex, payload: r.rest().slice() };
    }
    default:
      throw new Error(`unknown op ${op}`);
  }
}

function clampNote(note: string): string {
  if (te.encode(note).length > MAX_NOTE_BYTES) throw new Error('note exceeds 280 bytes');
  return note;
}

function sized(b: Uint8Array): Uint8Array {
  if (b.length > MAX_MESSAGE_BYTES) {
    throw new Error(`message ${b.length}B exceeds ${MAX_MESSAGE_BYTES}B cap (shorten path/note)`);
  }
  return b;
}
