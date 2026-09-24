// Quackdown shared types. Isomorphic — no Node or browser APIs here.

export const MAGIC = Uint8Array.from([0x51, 0x44]); // "QD"
export const VERSION = 0x00; // v0: bodies in chunked messages
export const VERSION_V1 = 0x01; // v1: head in message, body in transaction blobs

export const Op = {
  PUBLISH: 0x01, DELETE: 0x02, REDIRECT: 0x03, REGISTER: 0x04,
  COMMIT: 0x05, // v1 batch head: several ops in one transaction
  UPLOAD: 0x06, // v1 two-phase: body blobs staged, not yet live (reserved for >1 MiB)
} as const;
export type OpCode = (typeof Op)[keyof typeof Op];

// Protocol limits from T0b recon: 64 blobs/tx, 1 MiB payload. Keep body blobs well
// under 1 MiB so head + blobs fit one transaction.
export const MAX_BLOBS_PER_TX = 64;
export const BODY_BLOB_BYTES = 900 * 1024;

export const Compression = { NONE: 0x00, ZSTD: 0x01 } as const;
export type CompressionCode = (typeof Compression)[keyof typeof Compression];

// Radix enforces a hard 2048-byte cap on the transaction message (validation,
// pre-execution). Confirmed on Stokenet in recon/REPORT.md (2048 ok, 2049 rejected).
export const MAX_MESSAGE_BYTES = 2048;

// Approved v0 chunking: uniform payload slice per chunk. A head chunk carries
// metadata + the first slice; body chunks carry only the lean prefix + a slice.
export const CHUNK_PAYLOAD_BYTES = 1500;

export const MAX_NOTE_BYTES = 280;
export const MAX_REDIRECT_HOPS = 5;

export const MIME_TYPE = 'application/x-quackdown';

// A decoded message envelope (one transaction message = one of these).
export type Envelope =
  | PublishChunk
  | DeleteEnvelope
  | RedirectEnvelope
  | RegisterEnvelope
  | PublishV1Head
  | CommitEnvelope;

// v1 single-page publish head. The body is the transaction's blobs (all of them,
// in order), concatenated, decompressed, and verified against contentHash.
export interface PublishV1Head {
  op: typeof Op.PUBLISH;
  version: typeof VERSION_V1;
  path: string;
  note?: string;
  contentHash: Uint8Array; // 32 bytes, sha256 of uncompressed body
  compression: CompressionCode;
  dictRef?: Uint8Array;
  bodyBlobs: number; // how many of the tx's blobs form this body
}

// v1 batch head (op COMMIT): several ops committed in one transaction, each
// publish pointing at a [blobStart, blobStart+blobCount) range of the tx's blobs.
export type CommitSubOp =
  | { op: typeof Op.PUBLISH; path: string; note?: string; contentHash: Uint8Array; compression: CompressionCode; blobStart: number; blobCount: number }
  | { op: typeof Op.DELETE; path: string; note?: string }
  | { op: typeof Op.REDIRECT; path: string; note?: string; target: string };

export interface CommitEnvelope {
  op: typeof Op.COMMIT;
  version: typeof VERSION_V1;
  ops: CommitSubOp[];
}

// Directory registration. The registrant account is NOT carried here — it is
// taken from the ledger's owner call in the same transaction (unspoofable). The
// title is a cosmetic display name for the registrant's own site link.
export interface RegisterEnvelope {
  op: typeof Op.REGISTER;
  title?: string;
}

export interface PublishChunk {
  op: typeof Op.PUBLISH;
  path: string;
  snapshotId: Uint8Array; // 16 bytes
  chunkIndex: number;
  // Present only on the head chunk (chunkIndex === 0):
  chunkCount?: number;
  note?: string;
  contentHash?: Uint8Array; // 32 bytes, sha256 of uncompressed markdown
  compression?: CompressionCode;
  dictRef?: Uint8Array; // empty in v0
  payload: Uint8Array; // this chunk's slice of the (compressed) stream
}

export interface DeleteEnvelope {
  op: typeof Op.DELETE;
  path: string;
  note?: string;
}

export interface RedirectEnvelope {
  op: typeof Op.REDIRECT;
  path: string;
  note?: string;
  target: string; // same-site path in v0
}

// Injected environment primitives so the resolver stays isomorphic.
export interface CryptoDeps {
  sha256(data: Uint8Array): Promise<Uint8Array>;
  // Decompress a zstd stream. Only called when compression === ZSTD.
  zstdDecompress(data: Uint8Array): Promise<Uint8Array>;
}
