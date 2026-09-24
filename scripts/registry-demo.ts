// Live directory demo on Stokenet: fund two fresh accounts, publish a page to
// each, register both in the directory, then read the directory back through the
// real gateway code and verify identity binding (registrant == signer).
import { randomBytes } from 'node:crypto';
import {
  RadixEngineToolkit, LTSRadixEngineToolkit, PrivateKey, NetworkId,
  TransactionBuilder, generateRandomNonce,
} from '@radixdlt/radix-engine-toolkit';
import { encodePublishChunks, encodeRegister } from '../src/core/envelope.js';
import { Compression, MIME_TYPE } from '../src/core/types.js';
import { resolveRegistry } from '../src/core/registry.js';
import { zstdCompress, sha256Sync } from '../src/node/env.js';
import { submitMessage, submitRegister, fetchRegistryRecords } from '../src/cli/gateway.js';

const NET = NetworkId.Stokenet;
const GW = 'https://stokenet.radixdlt.com';
const hex = (u8: Uint8Array) => Buffer.from(u8).toString('hex');
const gw = async (p: string, b: unknown) => {
  const r = await fetch(GW + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e: any = new Error(p + ' ' + r.status); e.body = j; throw e; }
  return j;
};
const epoch = async () => (await gw('/status/gateway-status', {})).ledger_state.epoch;
const addr = (p: PrivateKey) => LTSRadixEngineToolkit.Derive.virtualAccountAddress(p.publicKey(), NET);
const newKey = () => new PrivateKey.Ed25519(new Uint8Array(randomBytes(32)));
async function waitCommit(id: string) {
  for (let i = 0; i < 40; i++) { try { const d = await gw('/transaction/committed-details', { intent_hash: id }); if (d.transaction.transaction_status) return; } catch {} await new Promise((r) => setTimeout(r, 2000)); }
  throw new Error('timeout ' + id);
}
async function fund(priv: PrivateKey) {
  const account = await addr(priv);
  const faucet = (await LTSRadixEngineToolkit.Derive.knownAddresses(NET) as any).components.faucet;
  const e = await epoch();
  const tx = await (await TransactionBuilder.new()).header({
    networkId: NET, startEpochInclusive: e, endEpochExclusive: e + 10, nonce: await generateRandomNonce(),
    notaryPublicKey: priv.publicKey(), notaryIsSignatory: true, tipPercentage: 0,
  }).manifest({ instructions: { kind: 'String', value: `
CALL_METHOD Address("${faucet}") "lock_fee" Decimal("100");
CALL_METHOD Address("${faucet}") "free";
CALL_METHOD Address("${account}") "try_deposit_batch_or_abort" Expression("ENTIRE_WORKTOP") None;`.trim() }, blobs: [] }).notarize(priv);
  await gw('/transaction/submit', { notarized_transaction_hex: hex(await RadixEngineToolkit.NotarizedTransaction.compile(tx)) });
  await waitCommit((await RadixEngineToolkit.NotarizedTransaction.intentHash(tx)).id);
}
async function publishAbout(priv: PrivateKey, account: string, title: string) {
  const raw = new TextEncoder().encode(`# ${title}\n\nRegistered via the Quackdown directory.`);
  const chunks = encodePublishChunks({ path: '/about', snapshotId: new Uint8Array(randomBytes(16)), contentHash: sha256Sync(raw), compression: Compression.NONE }, raw);
  for (const c of chunks) await submitMessage(priv, account, c);
}

const a = newKey(), b = newKey();
const aAcct = await addr(a), bAcct = await addr(b);
console.log('A:', aAcct, '\nB:', bAcct);
console.log('funding…'); await fund(a); await fund(b);
console.log('publishing…'); await publishAbout(a, aAcct, 'Alice on the Ledger'); await publishAbout(b, bAcct, 'Bob Writes');
console.log('registering…');
await submitRegister(a, aAcct, encodeRegister('Alice on the Ledger'));
await submitRegister(b, bAcct, encodeRegister('Bob Writes'));

console.log('reading directory…');
const entries = resolveRegistry(await fetchRegistryRecords());
for (const e of entries) console.log(`  ${e.title}  ${e.account}  (v${e.stateVersion})`);

const hasA = entries.find((e) => e.account === aAcct && e.title === 'Alice on the Ledger');
const hasB = entries.find((e) => e.account === bAcct && e.title === 'Bob Writes');
// identity binding: the registrant recorded is exactly the signing account (not spoofable)
console.log('\nA present + correct identity/title:', !!hasA);
console.log('B present + correct identity/title:', !!hasB);
console.log((hasA && hasB) ? 'REGISTRY DEMO PASS ✅' : 'REGISTRY DEMO FAIL ❌');
if (!(hasA && hasB)) process.exit(1);
