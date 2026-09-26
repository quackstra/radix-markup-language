// Shared COMMIT builder. Assembles a batch's sub-ops + blobs from prepared items,
// DEDUPING identical bodies so the transaction never carries two identical blobs
// (Radix rejects that with DuplicateBlob). Ops with the same body point at the same
// blob range. One source of truth for the CLI, the browser signer, and fee preview.
import { encodeCommit, splitBody } from './envelope.js';
import { Op, type CommitSubOp, type CompressionCode } from './types.js';

export type CommitBuildItem =
  | { op: typeof Op.PUBLISH; path: string; note?: string; bodyBytes: Uint8Array; contentHash: Uint8Array; compression: CompressionCode }
  | { op: typeof Op.DELETE; path: string; note?: string }
  | { op: typeof Op.REDIRECT; path: string; note?: string; target: string };

function byteEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export interface BuiltCommit { head: Uint8Array; blobs: Uint8Array[]; subOps: CommitSubOp[]; }

export function buildCommit(items: CommitBuildItem[], maxBlobBytes?: number): BuiltCommit {
  const blobs: Uint8Array[] = [];
  const placed: { bytes: Uint8Array; start: number; count: number }[] = []; // deduped whole bodies
  const subOps: CommitSubOp[] = [];

  for (const item of items) {
    if (item.op === Op.PUBLISH) {
      const bodyBytes = item.bodyBytes;
      let range = placed.find((p) => byteEquals(p.bytes, bodyBytes));
      if (!range) {
        const parts = splitBody(bodyBytes, maxBlobBytes);
        range = { bytes: bodyBytes, start: blobs.length, count: parts.length };
        blobs.push(...parts);
        placed.push(range);
      }
      subOps.push({ op: Op.PUBLISH, path: item.path, note: item.note, contentHash: item.contentHash, compression: item.compression, blobStart: range.start, blobCount: range.count });
    } else if (item.op === Op.DELETE) {
      subOps.push({ op: Op.DELETE, path: item.path, note: item.note });
    } else {
      subOps.push({ op: Op.REDIRECT, path: item.path, note: item.note, target: item.target });
    }
  }
  return { head: encodeCommit(subOps), blobs, subOps };
}
