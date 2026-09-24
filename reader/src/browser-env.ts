// Browser implementations of the injected core primitives.
// Web Crypto for sha256, fzstd for zstd decompression — no Node, no WASM RET.
import { decompress as zstdDecompress } from 'fzstd';
import type { CryptoDeps } from '../../src/core/types.js';

export const browserCrypto: CryptoDeps = {
  async sha256(data: Uint8Array): Promise<Uint8Array> {
    const digest = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
    return new Uint8Array(digest);
  },
  async zstdDecompress(data: Uint8Array): Promise<Uint8Array> {
    return zstdDecompress(data);
  },
};

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 ? '0' + hex : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
