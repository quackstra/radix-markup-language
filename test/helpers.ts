import { encodePublishChunks, encodeDelete, encodeRedirect } from '../src/core/envelope.js';
import { zstdCompress, sha256Sync } from '../src/node/env.js';
import { Compression, type CompressionCode } from '../src/core/types.js';
import type { SiteRecord } from '../src/core/resolver.js';

let snapCounter = 0;
export function snapshotId(seed?: number): Uint8Array {
  const id = new Uint8Array(16);
  id.fill((seed ?? ++snapCounter) & 0xff);
  return id;
}

export function publishChunks(path: string, markdown: string, opts: { note?: string; snapshotId?: Uint8Array; compression?: CompressionCode } = {}): Uint8Array[] {
  const raw = new TextEncoder().encode(markdown);
  const useZstd = (opts.compression ?? Compression.ZSTD) === Compression.ZSTD;
  const stream = useZstd ? zstdCompress(raw) : raw;
  return encodePublishChunks(
    {
      path,
      note: opts.note,
      snapshotId: opts.snapshotId ?? snapshotId(),
      contentHash: sha256Sync(raw),
      compression: useZstd ? Compression.ZSTD : Compression.NONE,
    },
    stream,
  );
}

// Turn a list of message-byte arrays into SiteRecords with increasing state versions.
let sv = 0;
export function records(...groups: Array<{ bytes: Uint8Array[]; committedSuccess?: boolean; ownerCall?: boolean }>): SiteRecord[] {
  const out: SiteRecord[] = [];
  for (const g of groups) {
    for (const bytes of g.bytes) {
      out.push({
        stateVersion: ++sv,
        txId: 'tx' + sv,
        bytes,
        committedSuccess: g.committedSuccess ?? true,
        ownerCall: g.ownerCall ?? true,
      });
    }
  }
  return out;
}

export function resetCounters() { snapCounter = 0; sv = 0; }

export { encodeDelete, encodeRedirect };
