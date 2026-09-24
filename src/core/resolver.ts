// Quackdown resolver — isomorphic. Given the fetched site transaction stream,
// fold ops per path (latest-wins by ledger state version) and resolve redirects
// at read time. Crypto/decompression are injected so this runs in Node and browser.
import { decode } from './envelope.js';
import {
  Op, Compression, MAX_REDIRECT_HOPS,
  type CryptoDeps, type PublishChunk,
} from './types.js';

// One row of the fetched Gateway stream. A transaction is a valid site tx iff it
// committed successfully AND made an owner-authorized call on the site account
// (Q2: `accounts_with_manifest_owner_method_calls` + CommittedSuccess). The
// resolver enforces this; never trust anything inside the envelope for identity.
export interface SiteRecord {
  stateVersion: number;
  txId: string;
  bytes: Uint8Array;
  committedSuccess: boolean;
  ownerCall: boolean;
}

export interface PublishOp {
  kind: 'publish';
  path: string;
  stateVersion: number;
  txId: string;
  note?: string;
  snapshotId: string; // hex
  chunkCount: number;
  presentChunks: number;
  complete: boolean;
  hashOk: boolean;
  resolvable: boolean; // complete && hashOk
  contentHash: string; // hex
  content: string | null; // present iff resolvable
  reason?: string; // why not resolvable
}
export interface DeleteOp { kind: 'delete'; path: string; stateVersion: number; txId: string; note?: string; }
export interface RedirectOp { kind: 'redirect'; path: string; stateVersion: number; txId: string; note?: string; target: string; }
export type PageOp = PublishOp | DeleteOp | RedirectOp;

export type PageState =
  | { status: 'published'; content: string; op: PublishOp }
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

export async function resolveSite(records: SiteRecord[], deps: CryptoDeps): Promise<SiteResolution> {
  // 1. Decode valid site txs; group PUBLISH chunks by snapshot; collect single ops.
  const snapshots = new Map<string, SnapshotAcc>();
  const singleOps: PageOp[] = [];

  for (const rec of records) {
    if (!rec.committedSuccess || !rec.ownerCall) continue; // rule 1: ignore non-site / failed
    let env;
    try { env = decode(rec.bytes); } catch { continue; } // silently drop undecodable

    if (env.op === Op.DELETE) {
      singleOps.push({ kind: 'delete', path: env.path, stateVersion: rec.stateVersion, txId: rec.txId, note: env.note });
    } else if (env.op === Op.REDIRECT) {
      singleOps.push({ kind: 'redirect', path: env.path, stateVersion: rec.stateVersion, txId: rec.txId, note: env.note, target: env.target });
    } else {
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

  // 2. Turn each snapshot into a PublishOp, verifying completeness + hash.
  const publishOps: PublishOp[] = [];
  for (const [key, acc] of snapshots) {
    if (!acc.head) continue; // no metadata (head chunk) -> cannot resolve, drop entirely
    const lastChunk = acc.chunks.get(acc.chunkCount - 1);
    const newestChunk = [...acc.chunks.values()].sort((a, b) => b.stateVersion - a.stateVersion)[0]!;
    // Timeline position = state version of the last chunk (falls back to newest if last missing).
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
      kind: 'publish', path: acc.path, stateVersion, txId,
      note: acc.note, snapshotId: key, chunkCount: acc.chunkCount, presentChunks: present,
      complete, hashOk, resolvable: complete && hashOk, contentHash: hex(acc.contentHash),
      content, reason,
    });
  }

  // 3. Fold per path in state-version order; last resolving op wins.
  const allOps: PageOp[] = [...singleOps, ...publishOps];
  const byPath = new Map<string, PageOp[]>();
  for (const op of allOps) {
    const arr = byPath.get(op.path) ?? [];
    arr.push(op);
    byPath.set(op.path, arr);
  }

  const pages = new Map<string, ResolvedPage>();
  for (const [path, ops] of byPath) {
    ops.sort((a, b) => a.stateVersion - b.stateVersion || a.txId.localeCompare(b.txId));
    let state: PageState = { status: 'nonexistent' };
    for (const op of ops) {
      if (op.kind === 'delete') state = { status: 'deleted', note: op.note, stateVersion: op.stateVersion, op };
      else if (op.kind === 'redirect') state = { status: 'redirected', target: op.target, note: op.note, op };
      else if (op.resolvable) state = { status: 'published', content: op.content!, op };
      // non-resolvable publishes are excluded from resolution (rule 2) but kept in history
    }
    pages.set(path, { state, history: ops });
  }

  return { pages };
}

// ---- read-time redirect resolution (rule 4) ----
export type RenderResult =
  | { kind: 'page'; path: string; content: string }
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
      case 'published': return { kind: 'page', path, content: state.content };
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
