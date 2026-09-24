// Q3: size & fee curve. Publish messages of increasing size, measure the fee
// and the compiled transaction size, and find the practical maximum message
// size given the 1 MiB (1,048,576 byte) transaction cap.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { PrivateKey } from '@radixdlt/radix-engine-toolkit';
import { addressFor, currentEpoch, buildTx, submit, waitForCommit } from './lib.mjs';

const { privHex } = JSON.parse(readFileSync(new URL('./.account.json', import.meta.url), 'utf8'));
const priv = new PrivateKey.Ed25519(Uint8Array.from(Buffer.from(privHex, 'hex')));
const account = await addressFor(priv);

async function tryPublish(payloadBytes) {
  const bytes = new Uint8Array(randomBytes(payloadBytes)); // incompressible worst case
  const message = {
    kind: 'PlainText',
    value: { mimeType: 'application/x-quackdown', message: { kind: 'Bytes', value: bytes } },
  };
  const epoch = await currentEpoch();
  const manifest = `CALL_METHOD Address("${account}") "lock_fee" Decimal("500");`;
  let built;
  try {
    built = await buildTx({ priv, manifest, message, epoch });
  } catch (e) {
    return { payloadBytes, phase: 'build', error: e.message };
  }
  try {
    const sub = await submit(built.notarizedHex);
    if (sub.duplicate) return { payloadBytes, txSize: built.sizeBytes, phase: 'submit', error: 'duplicate' };
  } catch (e) {
    return { payloadBytes, txSize: built.sizeBytes, phase: 'submit', error: e.status + ' ' + JSON.stringify(e.body?.message ?? e.body) };
  }
  try {
    const d = await waitForCommit(built.txId, {
      optIns: { receipt_fee_summary: true }, tries: 40, delayMs: 2500,
    });
    return {
      payloadBytes,
      txSize: built.sizeBytes,
      status: d.transaction.transaction_status,
      fee: d.transaction.fee_paid,
    };
  } catch (e) {
    return { payloadBytes, txSize: built.sizeBytes, phase: 'commit', error: e.message };
  }
}

const results = [];
const sizes = [1024, 10240, 102400, 512000];
for (const s of sizes) {
  const r = await tryPublish(s);
  console.log(JSON.stringify(r));
  results.push(r);
}

// Probe toward the cap to find the practical maximum.
console.log('--- probing upper bound ---');
for (const s of [700000, 900000, 1000000, 1040000]) {
  const r = await tryPublish(s);
  console.log(JSON.stringify(r));
  results.push(r);
  if (r.error) break;
}

console.log('\n=== SUMMARY ===');
for (const r of results) {
  console.log(
    `payload=${r.payloadBytes}B  txSize=${r.txSize ?? '-'}B  status=${r.status ?? r.phase + ':' + r.error}  fee=${r.fee ?? '-'}`
  );
}
