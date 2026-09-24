// Q3b: pin the exact message-size boundary and the fee near the max.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { PrivateKey } from '@radixdlt/radix-engine-toolkit';
import { addressFor, currentEpoch, buildTx, submit, waitForCommit } from './lib.mjs';

const { privHex } = JSON.parse(readFileSync(new URL('./.account.json', import.meta.url), 'utf8'));
const priv = new PrivateKey.Ed25519(Uint8Array.from(Buffer.from(privHex, 'hex')));
const account = await addressFor(priv);

async function tryPublish(payloadBytes) {
  const bytes = new Uint8Array(randomBytes(payloadBytes));
  const message = { kind: 'PlainText', value: { mimeType: 'application/x-quackdown', message: { kind: 'Bytes', value: bytes } } };
  const epoch = await currentEpoch();
  const manifest = `CALL_METHOD Address("${account}") "lock_fee" Decimal("100");`;
  const built = await buildTx({ priv, manifest, message, epoch });
  try {
    await submit(built.notarizedHex);
  } catch (e) {
    return { payloadBytes, ok: false, error: (e.body?.message ?? '').match(/permitted: \d+/)?.[0] ?? e.status };
  }
  const d = await waitForCommit(built.txId, { optIns: { receipt_fee_summary: true }, tries: 40, delayMs: 2500 });
  return { payloadBytes, ok: true, status: d.transaction.transaction_status, fee: d.transaction.fee_paid };
}

for (const s of [1500, 2000, 2048, 2049, 2100]) {
  console.log(JSON.stringify(await tryPublish(s)));
}
