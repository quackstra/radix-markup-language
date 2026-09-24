// Minimal, isomorphic extractor for a Radix transaction's blobs (Vec<Vec<u8>>)
// from its raw notarized-transaction payload. Avoids pulling RET's ~3 MB wasm into
// the reader (see recon/REPORT-v1.md, L4).
//
// Framing verified live on Stokenet (recon/sbor-dev.mjs):
//   blobs vector : 0x20 0x20 <count:LEB128>
//   each blob    : 0x07 <len:LEB128> <bytes>        (Array<U8>)
// Blobs appear before the transaction message, so the FIRST structurally-valid
// Array<Array<U8>> is the blobs field. Correctness is ultimately guaranteed by the
// caller verifying the reassembled body against content_hash — a mis-scan fails that.

function readLEB(buf: Uint8Array, o: number): [number, number] {
  let shift = 0, val = 0, b: number;
  do { b = buf[o++]!; val |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
  return [val, o];
}

export function extractBlobs(payload: Uint8Array): Uint8Array[] {
  for (let i = 0; i + 2 < payload.length; i++) {
    if (payload[i] !== 0x20 || payload[i + 1] !== 0x20) continue;
    let o = i + 2;
    let count: number;
    [count, o] = readLEB(payload, o);
    if (count < 1 || count > 64) continue; // protocol cap is 64 blobs/tx
    const blobs: Uint8Array[] = [];
    let ok = true;
    for (let k = 0; k < count; k++) {
      if (payload[o] !== 0x07) { ok = false; break; } // each blob is Array<U8>
      o++;
      let len: number;
      [len, o] = readLEB(payload, o);
      if (len < 0 || o + len > payload.length) { ok = false; break; }
      blobs.push(payload.subarray(o, o + len));
      o += len;
    }
    if (ok && blobs.length === count) return blobs;
  }
  return [];
}
