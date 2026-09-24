// T0b-live: verify the blob carrier on Stokenet (Quackdown v1).
// L1 unreferenced blob commits? L2 ~900KB blob + fee. L3 fee curve.
// L4 read-back via raw_hex + extract blobs (RET). L5 stream raw_hex. L6 tx version.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { PrivateKey, RadixEngineToolkit, TransactionBuilder, generateRandomNonce } from '@radixdlt/radix-engine-toolkit';
import { NETWORK_ID, GATEWAY, gw, currentEpoch, waitForCommit, addressFor } from './lib.mjs';

const { privHex } = JSON.parse(readFileSync(new URL('./.account.json', import.meta.url), 'utf8'));
const priv = new PrivateKey.Ed25519(Uint8Array.from(Buffer.from(privHex, 'hex')));
const account = await addressFor(priv);
const hex = (u8) => Buffer.from(u8).toString('hex');
const MIME = 'application/x-quackdown';

// A tiny stand-in v1 head message (magic QD, version 0x01, op 0x01, body_blobs=1).
const head = new Uint8Array([0x51, 0x44, 0x01, 0x01, 0x01]);

async function sendWithBlobs(blobs, { lockFee = '500', message = head, refBlob = false } = {}) {
  const epoch = await currentEpoch();
  const header = {
    networkId: NETWORK_ID, startEpochInclusive: epoch, endEpochExclusive: epoch + 10,
    nonce: await generateRandomNonce(), notaryPublicKey: priv.publicKey(), notaryIsSignatory: true, tipPercentage: 0,
  };
  // Manifest references a blob only if refBlob is set (L1 tests the UNREFERENCED case).
  let manifest = `CALL_METHOD Address("${account}") "lock_fee" Decimal("${lockFee}");`;
  let step = (await TransactionBuilder.new()).header(header);
  if (message) step = step.message({ kind: 'PlainText', value: { mimeType: MIME, message: { kind: 'Bytes', value: message } } });
  const notarized = await step.manifest({ instructions: { kind: 'String', value: manifest }, blobs }).notarize(priv);
  const compiled = await RadixEngineToolkit.NotarizedTransaction.compile(notarized);
  const txId = (await RadixEngineToolkit.NotarizedTransaction.intentHash(notarized)).id;
  let submitErr = null;
  try { await gw('/transaction/submit', { notarized_transaction_hex: hex(compiled) }); }
  catch (e) { submitErr = (e.body?.message ?? JSON.stringify(e.body) ?? e.message); }
  return { txId, payloadBytes: compiled.length, submitErr };
}

async function commitFee(txId) {
  const d = await waitForCommit(txId, { optIns: { receipt_fee_summary: true }, tries: 50, delayMs: 3000 });
  return { status: d.transaction.transaction_status, fee: d.transaction.fee_paid };
}

const results = {};

// L1: one UNREFERENCED 10 KB blob + head message.
{
  const blob = new Uint8Array(randomBytes(10 * 1024));
  const r = await sendWithBlobs([blob], { lockFee: '50' });
  console.log('L1 submit:', JSON.stringify(r));
  if (!r.submitErr) { const c = await commitFee(r.txId); console.log('L1 commit:', JSON.stringify(c)); results.L1 = { ...r, ...c }; }
  else results.L1 = r;
}

// L2: ~900 KB blob.
{
  const blob = new Uint8Array(randomBytes(900 * 1024));
  const r = await sendWithBlobs([blob], { lockFee: '300' });
  console.log('L2 submit:', JSON.stringify({ ...r, payloadBytes: r.payloadBytes }));
  if (!r.submitErr) { const c = await commitFee(r.txId); console.log('L2 commit:', JSON.stringify(c)); results.L2 = { ...r, ...c }; }
  else results.L2 = r;
}

// L3: fee curve 10 / 100 / 500 KB.
results.L3 = [];
for (const kb of [10, 100, 500]) {
  const blob = new Uint8Array(randomBytes(kb * 1024));
  const r = await sendWithBlobs([blob], { lockFee: '200' });
  let row = { kb, payloadBytes: r.payloadBytes, submitErr: r.submitErr };
  if (!r.submitErr) { const c = await commitFee(r.txId); row = { ...row, ...c, txId: r.txId }; }
  console.log('L3', JSON.stringify(row));
  results.L3.push(row);
}

// L4: read-back one committed blob tx via raw_hex, extract blobs with RET, verify.
{
  const original = new Uint8Array(randomBytes(12345));
  const r = await sendWithBlobs([original], { lockFee: '50' });
  await commitFee(r.txId);
  const d = await gw('/transaction/committed-details', { intent_hash: r.txId, opt_ins: { raw_hex: true } });
  const rawHex = d.transaction.raw_hex;
  const raw = Uint8Array.from(Buffer.from(rawHex, 'hex'));
  const decompiled = await RadixEngineToolkit.NotarizedTransaction.decompile(raw, 'String');
  const blobs = decompiled.signedIntent.intent.manifest.blobs;
  const got = blobs?.[0];
  const match = got && got.length === original.length && Buffer.compare(Buffer.from(got), Buffer.from(original)) === 0;
  console.log('L4 raw_hex present:', !!rawHex, '| blobs found:', blobs?.length, '| roundtrip match:', match);
  results.L4 = { rawHexLen: rawHex?.length, blobCount: blobs?.length, match };
}

// L5: stream with owner-call filter + raw_hex opt-in.
{
  const r = await gw('/stream/transactions', {
    accounts_with_manifest_owner_method_calls: [account],
    order: 'Desc', limit_per_page: 5, opt_ins: { raw_hex: true },
  });
  const first = r.items?.[0];
  console.log('L5 stream items:', r.items?.length, '| raw_hex on stream item:', typeof first?.raw_hex, '| len:', first?.raw_hex?.length);
  results.L5 = { items: r.items?.length, streamRawHex: typeof first?.raw_hex === 'string', rawHexLen: first?.raw_hex?.length };
}

console.log('\n=== SUMMARY ===');
console.log(JSON.stringify(results, null, 1));
