// Develop the minimal SBOR blob walker against a real committed tx.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { PrivateKey, RadixEngineToolkit, TransactionBuilder, generateRandomNonce } from '@radixdlt/radix-engine-toolkit';
import { NETWORK_ID, gw, currentEpoch, waitForCommit, addressFor } from './lib.mjs';

const { privHex } = JSON.parse(readFileSync(new URL('./.account.json', import.meta.url), 'utf8'));
const priv = new PrivateKey.Ed25519(Uint8Array.from(Buffer.from(privHex, 'hex')));
const account = await addressFor(priv);
const toHex = (u8) => Buffer.from(u8).toString('hex');

const blobA = new Uint8Array(randomBytes(5000));
const blobB = new Uint8Array(randomBytes(133));
const head = new Uint8Array([0x51, 0x44, 0x01, 0x01, 0x02, 0xaa, 0xbb]);
const epoch = await currentEpoch();
const notarized = await (await TransactionBuilder.new())
  .header({ networkId: NETWORK_ID, startEpochInclusive: epoch, endEpochExclusive: epoch + 10, nonce: await generateRandomNonce(), notaryPublicKey: priv.publicKey(), notaryIsSignatory: true, tipPercentage: 0 })
  .message({ kind: 'PlainText', value: { mimeType: 'application/x-quackdown', message: { kind: 'Bytes', value: head } } })
  .manifest({ instructions: { kind: 'String', value: `CALL_METHOD Address("${account}") "lock_fee" Decimal("50");` }, blobs: [blobA, blobB] })
  .notarize(priv);
const txId = (await RadixEngineToolkit.NotarizedTransaction.intentHash(notarized)).id;
await gw('/transaction/submit', { notarized_transaction_hex: toHex(await RadixEngineToolkit.NotarizedTransaction.compile(notarized)) });
await waitForCommit(txId, { tries: 50, delayMs: 3000 });
const d = await gw('/transaction/committed-details', { intent_hash: txId, opt_ins: { raw_hex: true } });
const raw = Buffer.from(d.transaction.raw_hex, 'hex');
console.log('payload bytes:', raw.length);
console.log('first 48 bytes:', toHex(raw.subarray(0, 48)));

// --- candidate walker: find the blobs Vec<Vec<u8>> then read each blob ---
function readLEB(buf, o) { let shift = 0, val = 0, b; do { b = buf[o++]; val |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80); return [val, o]; }

// The blobs field is an Array(0x20) whose element kind is Array(0x20). Scan for the
// FIRST 0x20 0x20 whose parsed structure fully consumes to a plausible boundary.
function extractBlobs(buf) {
  for (let i = 0; i + 2 < buf.length; i++) {
    if (buf[i] === 0x20 && buf[i + 1] === 0x20) {
      let o = i + 2;
      let count; [count, o] = readLEB(buf, o);
      if (count < 1 || count > 64) continue;
      const blobs = [];
      let ok = true;
      for (let k = 0; k < count; k++) {
        if (buf[o] !== 0x07) { ok = false; break; } // each blob is Array<U8>
        o++;
        let len; [len, o] = readLEB(buf, o);
        if (o + len > buf.length) { ok = false; break; }
        blobs.push(buf.subarray(o, o + len));
        o += len;
      }
      if (ok && blobs.length === count) return { at: i, blobs };
    }
  }
  return null;
}

const ret = (await RadixEngineToolkit.NotarizedTransaction.decompile(Uint8Array.from(raw), 'String')).signedIntent.intent.manifest.blobs;
const got = extractBlobs(raw);
console.log('RET blob count:', ret.length, 'lens:', ret.map((b) => b.length));
console.log('walker blob count:', got?.blobs.length, 'lens:', got?.blobs.map((b) => b.length), 'at offset', got?.at);
const match = got && got.blobs.length === ret.length && got.blobs.every((b, i) => Buffer.compare(Buffer.from(b), Buffer.from(ret[i])) === 0);
console.log(match ? 'WALKER MATCHES RET ✅' : 'WALKER MISMATCH ❌');
