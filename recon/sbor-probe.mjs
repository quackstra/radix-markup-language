// Learn the SBOR framing around transaction blobs so we can write a minimal
// blob extractor for the reader (no RET wasm). Publishes a distinctive blob,
// fetches raw_hex, extracts via RET (ground truth), then locates the blob in the
// raw payload and prints the surrounding bytes to reveal the value-kind + length
// framing of the intent's blobs Vec<Vec<u8>>.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { PrivateKey, RadixEngineToolkit, TransactionBuilder, generateRandomNonce } from '@radixdlt/radix-engine-toolkit';
import { NETWORK_ID, gw, currentEpoch, waitForCommit, addressFor } from './lib.mjs';

const { privHex } = JSON.parse(readFileSync(new URL('./.account.json', import.meta.url), 'utf8'));
const priv = new PrivateKey.Ed25519(Uint8Array.from(Buffer.from(privHex, 'hex')));
const account = await addressFor(priv);
const toHex = (u8) => Buffer.from(u8).toString('hex');

// Two blobs so we can see how the Vec<Vec<u8>> separates elements.
const blobA = new Uint8Array(randomBytes(300));
const blobB = new Uint8Array(randomBytes(70));
const head = new Uint8Array([0x51, 0x44, 0x01, 0x01, 0x02]);

const epoch = await currentEpoch();
const header = {
  networkId: NETWORK_ID, startEpochInclusive: epoch, endEpochExclusive: epoch + 10,
  nonce: await generateRandomNonce(), notaryPublicKey: priv.publicKey(), notaryIsSignatory: true, tipPercentage: 0,
};
const notarized = await (await TransactionBuilder.new())
  .header(header)
  .message({ kind: 'PlainText', value: { mimeType: 'application/x-quackdown', message: { kind: 'Bytes', value: head } } })
  .manifest({ instructions: { kind: 'String', value: `CALL_METHOD Address("${account}") "lock_fee" Decimal("50");` }, blobs: [blobA, blobB] })
  .notarize(priv);
const txId = (await RadixEngineToolkit.NotarizedTransaction.intentHash(notarized)).id;
await gw('/transaction/submit', { notarized_transaction_hex: toHex(await RadixEngineToolkit.NotarizedTransaction.compile(notarized)) });
await waitForCommit(txId, { tries: 50, delayMs: 3000 });

const d = await gw('/transaction/committed-details', { intent_hash: txId, opt_ins: { raw_hex: true } });
const raw = Buffer.from(d.transaction.raw_hex, 'hex');
console.log('txId:', txId, '| payload bytes:', raw.length);

for (const [name, blob] of [['A(300)', blobA], ['B(70)', blobB]]) {
  const idx = raw.indexOf(Buffer.from(blob));
  const pre = raw.subarray(Math.max(0, idx - 12), idx);
  console.log(`\nblob ${name}: found at offset ${idx}`);
  console.log('  12 bytes BEFORE blob:', toHex(pre));
  console.log('  first 4 blob bytes  :', toHex(blob.subarray(0, 4)));
}

// Also show ~40 bytes before the FIRST blob to reveal the blobs-vector header.
const firstIdx = raw.indexOf(Buffer.from(blobA));
console.log('\n40 bytes before first blob:', toHex(raw.subarray(firstIdx - 40, firstIdx)));
