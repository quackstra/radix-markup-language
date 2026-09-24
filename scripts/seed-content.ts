// Seed the Stokenet content in scripts/content.ts: one account per site, publish
// every page, and register each site in the directory. Idempotent per site name —
// keys persist in .content-keys.json (gitignored) so re-runs update the same sites.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import {
  RadixEngineToolkit, LTSRadixEngineToolkit, PrivateKey, NetworkId,
  TransactionBuilder, generateRandomNonce,
} from '@radixdlt/radix-engine-toolkit';
import { encodePublishChunks, encodeRegister } from '../src/core/envelope.js';
import { Compression } from '../src/core/types.js';
import { zstdCompress, sha256Sync } from '../src/node/env.js';
import { submitMessage, submitRegister } from '../src/cli/gateway.js';
import { SITES } from './content.js';

const NET = NetworkId.Stokenet;
const GW = 'https://stokenet.radixdlt.com';
const KEYS = new URL('./.content-keys.json', import.meta.url);
const hex = (u8: Uint8Array) => Buffer.from(u8).toString('hex');

const gw = async (p: string, b: unknown) => {
  const r = await fetch(GW + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e: any = new Error(p + ' ' + r.status); e.body = j; throw e; }
  return j;
};
const epoch = async () => (await gw('/status/gateway-status', {})).ledger_state.epoch;
const addr = (p: PrivateKey) => LTSRadixEngineToolkit.Derive.virtualAccountAddress(p.publicKey(), NET);
async function waitCommit(id: string) {
  for (let i = 0; i < 40; i++) { try { const d = await gw('/transaction/committed-details', { intent_hash: id }); if (d.transaction.transaction_status) return; } catch {} await new Promise((r) => setTimeout(r, 2000)); }
  throw new Error('timeout ' + id);
}
async function xrd(account: string): Promise<number> {
  try {
    const d = await gw('/state/entity/details', { addresses: [account], aggregation_level: 'Global' });
    const x = (await LTSRadixEngineToolkit.Derive.knownAddresses(NET)).resources.xrdResource;
    return Number(d.items?.[0]?.fungible_resources?.items?.find((i: any) => i.resource_address === x)?.amount ?? '0');
  } catch { return 0; }
}
async function fund(priv: PrivateKey, account: string) {
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
async function publish(priv: PrivateKey, account: string, path: string, md: string) {
  const raw = new TextEncoder().encode(md);
  const zc = zstdCompress(raw);
  const useZstd = zc.length < raw.length;
  const chunks = encodePublishChunks(
    { path, snapshotId: new Uint8Array(randomBytes(16)), contentHash: sha256Sync(raw), compression: useZstd ? Compression.ZSTD : Compression.NONE },
    useZstd ? zc : raw,
  );
  for (const c of chunks) await submitMessage(priv, account, c);
  return chunks.length;
}

const store: Record<string, { privHex: string; address: string }> = existsSync(KEYS) ? JSON.parse(readFileSync(KEYS, 'utf8')) : {};

for (const site of SITES) {
  let entry = store[site.name];
  if (!entry) {
    const bytes = new Uint8Array(randomBytes(32));
    const priv = new PrivateKey.Ed25519(bytes);
    entry = { privHex: hex(bytes), address: await addr(priv) };
    store[site.name] = entry;
    writeFileSync(KEYS, JSON.stringify(store, null, 2));
  }
  const priv = new PrivateKey.Ed25519(Uint8Array.from(Buffer.from(entry.privHex, 'hex')));
  const account = entry.address;
  console.log(`\n== ${site.name} :: ${account}`);
  if (await xrd(account) < 200) { console.log('  funding…'); await fund(priv, account); }
  for (const [path, md] of Object.entries(site.pages)) {
    const n = await publish(priv, account, path, md);
    console.log(`  published ${path} (${n} chunk${n > 1 ? 's' : ''})`);
  }
  console.log('  registering…');
  await submitRegister(priv, account, encodeRegister(site.title));
  console.log(`  registered as "${site.title}"`);
}

console.log('\nDONE. Sites:');
for (const site of SITES) console.log(`  ${site.title}  ->  ${store[site.name]!.address}`);
