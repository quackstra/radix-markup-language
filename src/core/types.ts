// Quackdown shared types. Isomorphic — no Node or browser APIs here.

export const MAGIC = Uint8Array.from([0x51, 0x44]); // "QD"
export const VERSION = 0x00;

export const Op = { PUBLISH: 0x01, DELETE: 0x02, REDIRECT: 0x03, REGISTER: 0x04 } as const;
export type OpCode = (typeof Op)[keyof typeof Op];

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
  | RegisterEnvelope;

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
