// Quackdown resolver — isomorphic. Given the fetched site transaction stream,
// fold ops per path (latest-wins by ledger state version, then op index within a
// batch) and resolve redirects at read time. Handles both v0 (bodies in chunked
// messages, resolved inline) and v1 (head in message, body in transaction blobs,
// loaded lazily via loadBody). Crypto/decompression are injected.
import { decode } from './envelope.js';
import {
  Op, Compression, MAX_REDIRECT_HOPS,
  type CryptoDeps, type PublishChunk, type CompressionCode,
} from './types.js';

// One row of the fetched Gateway stream. A transaction is a valid site tx iff it
// committed successfully AND made an owner-authorized call on the site account
// (Q2). The resolver enforces this; never trust the envelope for identity.
export interface SiteRecord {
  stateVersion: number;
  txId: string;
  bytes: Uint8Array;
  committedSuccess: boolean;
  ownerCall: boolean;
}

// v1: where a page body lives — a blob range in one transaction, loaded on demand.
export interface BlobBodyRef {
  txId: string;
  blobStart: number;
  blobCount: number;
  compression: CompressionCode;
  contentHash: Uint8Array;
}

export interface PublishOp {
  kind: 'publish';
  path: string;
  stateVersion: number;
  txId: string;
  opIndex: number; // position within a batch COMMIT (0 for single-op txs)
  note?: string;
  contentHash: string; // hex
  compression?: number;
  complete: boolean;
  hashOk: boolean;
  resolvable: boolean;
  content: string | null; // v0: inline once verified; v1: null until loadBody
  body?: BlobBodyRef; // v1 only
  reason?: string;
  // v0-only diagnostics:
  snapshotId?: string;
  chunkCount?: number;
  presentChunks?: number;
}
export interface DeleteOp { kind: 'delete'; path: string; stateVersion: number; txId: string; opIndex: number; note?: string; }
export interface RedirectOp { kind: 'redirect'; path: string; stateVersion: number; txId: string; opIndex: number; note?: string; target: string; }
export type PageOp = PublishOp | DeleteOp | RedirectOp;

export type PageState =
  | { status: 'published'; content: string | null; op: PublishOp }
  | { status: 'deleted'; note?: string; stateVersion: number; op: DeleteOp }
  | { status: 'redirected'; target: string; note?: string; op: RedirectOp }
  | { status: 'nonexistent' };

export interface ResolvedPage { state: PageState; history: PageOp[]; }
export interface SiteResolution { pages: Map<string, ResolvedPage>; }

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

interface SnapshotAcc {
  path: string;
  note?: string;
  chunkCount: number;
  contentHash: Uint8Array;
  compression: number;
  head?: PublishChunk;
  chunks: Map<number, { payload: Uint8Array; stateVersion: number; txId: string }>;
}

function v1PublishOp(
  args: { path: string; note?: string; contentHash: Uint8Array; compression: CompressionCode; blobStart: number; blobCount: number },
  rec: SiteRecord, opIndex: number,
): PublishOp {
  return {
    kind: 'publish', path: args.path, stateVersion: rec.stateVersion, txId: rec.txId, opIndex,
    note: args.note, contentHash: hex(args.contentHash), compression: args.compression,
    complete: true, hashOk: true, resolvable: true, content: null,
    body: { txId: rec.txId, blobStart: args.blobStart, blobCount: args.blobCount, compression: args.compression, contentHash: args.contentHash },
  };
}

export async function resolveSite(records: SiteRecord[], deps: CryptoDeps): Promise<SiteResolution> {
  const snapshots = new Map<string, SnapshotAcc>();
  const singleOps: PageOp[] = [];
  const publishOps: PublishOp[] = [];

  for (const rec of records) {
    if (!rec.committedSuccess || !rec.ownerCall) continue; // rule 1
    let env;
    try { env = decode(rec.bytes); } catch { continue; } // silently drop undecodable

    if (env.op === Op.DELETE) {
      singleOps.push({ kind: 'delete', path: env.path, stateVersion: rec.stateVersion, txId: rec.txId, opIndex: 0, note: env.note });
    } else if (env.op === Op.REDIRECT) {
      singleOps.push({ kind: 'redirect', path: env.path, stateVersion: rec.stateVersion, txId: rec.txId, opIndex: 0, note: env.note, target: env.target });
    } else if (env.op === Op.COMMIT) {
      env.ops.forEach((sub, i) => {
        if (sub.op === Op.PUBLISH) {
          publishOps.push(v1PublishOp(sub, rec, i));
        } else if (sub.op === Op.DELETE) {
          singleOps.push({ kind: 'delete', path: sub.path, stateVersion: rec.stateVersion, txId: rec.txId, opIndex: i, note: sub.note });
        } else {
          singleOps.push({ kind: 'redirect', path: sub.path, stateVersion: rec.stateVersion, txId: rec.txId, opIndex: i, note: sub.note, target: sub.target });
        }
      });
    } else if (env.op === Op.PUBLISH && 'bodyBlobs' in env) {
      // v1 single publish: all of the tx's blobs are the body.
      publishOps.push(v1PublishOp({ ...env, blobStart: 0, blobCount: env.bodyBlobs }, rec, 0));
    } else if (env.op === Op.PUBLISH) {
      // v0 chunked publish: group by snapshot.
      const key = hex(env.snapshotId);
      let acc = snapshots.get(key);
      if (!acc) {
        acc = { path: '', chunkCount: -1, contentHash: new Uint8Array(0), compression: Compression.NONE, chunks: new Map() };
        snapshots.set(key, acc);
      }
      if (env.chunkIndex === 0) {
        acc.head = env;
        acc.path = env.path;
        acc.note = env.note;
        acc.chunkCount = env.chunkCount!;
        acc.contentHash = env.contentHash!;
        acc.compression = env.compression!;
      }
      acc.chunks.set(env.chunkIndex, { payload: env.payload, stateVersion: rec.stateVersion, txId: rec.txId });
    }
  }

  // v0 snapshots -> PublishOps, verifying completeness + hash inline (bodies present).
  for (const [key, acc] of snapshots) {
    if (!acc.head) continue;
    const lastChunk = acc.chunks.get(acc.chunkCount - 1);
    const newestChunk = [...acc.chunks.values()].sort((a, b) => b.stateVersion - a.stateVersion)[0]!;
    const stateVersion = lastChunk ? lastChunk.stateVersion : newestChunk.stateVersion;
    const txId = lastChunk ? lastChunk.txId : newestChunk.txId;
    const present = acc.chunks.size;
    const complete = acc.chunkCount >= 1 && present === acc.chunkCount &&
      [...Array(acc.chunkCount).keys()].every((i) => acc.chunks.has(i));

    let content: string | null = null;
    let hashOk = false;
    let reason: string | undefined;
    if (!complete) {
      reason = `incomplete: ${present}/${acc.chunkCount} chunks`;
    } else {
      const stream = concat([...Array(acc.chunkCount).keys()].map((i) => acc.chunks.get(i)!.payload));
      try {
        const raw = acc.compression === Compression.ZSTD ? await deps.zstdDecompress(stream) : stream;
        const digest = await deps.sha256(raw);
        hashOk = equalBytes(digest, acc.contentHash);
        if (hashOk) content = new TextDecoder('utf-8', { fatal: true }).decode(raw);
        else reason = 'content_hash mismatch';
      } catch (e) {
        reason = 'decompress/decode failed: ' + (e as Error).message;
      }
    }
    publishOps.push({
      kind: 'publish', path: acc.path, stateVersion, txId, opIndex: 0,
      note: acc.note, snapshotId: key, chunkCount: acc.chunkCount, presentChunks: present,
      complete, hashOk, resolvable: complete && hashOk, contentHash: hex(acc.contentHash),
      compression: acc.compression, content, reason,
    });
  }

  // Fold per path: state version, then op index within a batch, then txId.
  const byPath = new Map<string, PageOp[]>();
  for (const op of [...singleOps, ...publishOps]) {
    const arr = byPath.get(op.path) ?? [];
    arr.push(op);
    byPath.set(op.path, arr);
  }

  const pages = new Map<string, ResolvedPage>();
  for (const [path, ops] of byPath) {
    ops.sort((a, b) => a.stateVersion - b.stateVersion || a.opIndex - b.opIndex || a.txId.localeCompare(b.txId));
    let state: PageState = { status: 'nonexistent' };
    for (const op of ops) {
      if (op.kind === 'delete') state = { status: 'deleted', note: op.note, stateVersion: op.stateVersion, op };
      else if (op.kind === 'redirect') state = { status: 'redirected', target: op.target, note: op.note, op };
      else if (op.resolvable) state = { status: 'published', content: op.content, op };
    }
    pages.set(path, { state, history: ops });
  }

  return { pages };
}

// v1 body load: given the transaction's extracted blobs, slice the op's range,
// concatenate, decompress, and verify content_hash. Returns null on any failure
// (missing blob / hash mismatch / bad decompress) — the page is then treated as
// having no valid body.
export async function loadBody(body: BlobBodyRef, blobs: Uint8Array[], deps: CryptoDeps): Promise<string | null> {
  const slice = blobs.slice(body.blobStart, body.blobStart + body.blobCount);
  if (slice.length !== body.blobCount || slice.some((b) => b == null)) return null;
  const stream = concat(slice);
  try {
    const raw = body.compression === Compression.ZSTD ? await deps.zstdDecompress(stream) : stream;
    const digest = await deps.sha256(raw);
    if (!equalBytes(digest, body.contentHash)) return null;
    return new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch { return null; }
}

// ---- read-time redirect resolution (rule 4) ----
export type RenderResult =
  | { kind: 'page'; path: string; content: string | null; op: PublishOp }
  | { kind: 'deleted'; path: string; note?: string }
  | { kind: 'not-found'; path: string; via?: string }
  | { kind: 'redirect-loop'; path: string; chain: string[] };

export function render(pages: Map<string, ResolvedPage>, startPath: string): RenderResult {
  const chain: string[] = [];
  let path = startPath;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    if (chain.includes(path)) return { kind: 'redirect-loop', path: startPath, chain: [...chain, path] };
    chain.push(path);
    const page = pages.get(path);
    const state = page?.state ?? { status: 'nonexistent' as const };
    switch (state.status) {
      case 'published': return { kind: 'page', path, content: state.content, op: state.op };
      case 'deleted': return { kind: 'deleted', path, note: state.note };
      case 'redirected': path = state.target; break;
      case 'nonexistent':
        return { kind: 'not-found', path, via: chain.length > 1 ? chain[chain.length - 2] : undefined };
    }
  }
  return { kind: 'redirect-loop', path: startPath, chain };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
