// Q1: send a plaintext message, MIME application/x-quackdown, Bytes content.
// Read it back via the Gateway and report the exact JSON shape of the message.
// Also send a String-content variant to compare how the Gateway returns each.
import { readFileSync } from 'node:fs';
import { PrivateKey } from '@radixdlt/radix-engine-toolkit';
import { addressFor, currentEpoch, buildTx, submit, waitForCommit } from './lib.mjs';

const { privHex } = JSON.parse(readFileSync(new URL('./.account.json', import.meta.url), 'utf8'));
const priv = new PrivateKey.Ed25519(Uint8Array.from(Buffer.from(privHex, 'hex')));
const account = await addressFor(priv);

async function publishMessage(label, message) {
  const epoch = await currentEpoch();
  const manifest = `CALL_METHOD Address("${account}") "lock_fee" Decimal("10");`;
  const { notarizedHex, txId } = await buildTx({ priv, manifest, message, epoch });
  await submit(notarizedHex);
  const d = await waitForCommit(txId, {
    optIns: { raw_hex: true, receipt_fee_summary: true, manifest_instructions: true },
  });
  console.log(`\n===== ${label} =====`);
  console.log('txId:', txId);
  console.log('status:', d.transaction.transaction_status);
  console.log('message field returned by Gateway:');
  console.log(JSON.stringify(d.transaction.message, null, 2));
  console.log('fee_paid:', d.transaction.fee_paid);
  return d.transaction.message;
}

// Bytes content: the header bytes 0x51 0x44 0x00 0x01 (QD v0 PUBLISH) + a few payload bytes.
const bytes = new Uint8Array([0x51, 0x44, 0x00, 0x01, 0xde, 0xad, 0xbe, 0xef, 0x00, 0xff]);
await publishMessage('BYTES content', {
  kind: 'PlainText',
  value: { mimeType: 'application/x-quackdown', message: { kind: 'Bytes', value: bytes } },
});

await publishMessage('STRING content', {
  kind: 'PlainText',
  value: { mimeType: 'application/x-quackdown', message: { kind: 'String', value: '# hello quackdown' } },
});
