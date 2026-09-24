// Node implementations of the injected crypto/compression primitives.
// The browser reader (T2) supplies its own (Web Crypto + fzstd).
import { createHash } from 'node:crypto';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import type { CryptoDeps } from '../core/types.js';

export const nodeCrypto: CryptoDeps = {
  async sha256(data: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(createHash('sha256').update(data).digest());
  },
  async zstdDecompress(data: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(zstdDecompressSync(data));
  },
};

export function zstdCompress(data: Uint8Array): Uint8Array {
  return new Uint8Array(zstdCompressSync(data));
}

export function sha256Sync(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest());
}
