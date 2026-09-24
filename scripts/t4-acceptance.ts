// T4 acceptance on Stokenet: a 50 KB page in ONE transaction (v1 blob), a 5-op
// cart committed in ONE transaction (COMMIT), and a v0 page still rendering.
// Verifies qd-ls-equivalent resolution matches per-page body loads via the SBOR
// walker (no RET on the read path).
import { randomBytes } from 'node:crypto';
import {
  RadixEngineToolkit, LTSRadixEngineToolkit, PrivateKey, NetworkId,
  TransactionBuilder, generateRandomNonce,
} from '@radixdlt/radix-engine-toolkit';
import { encodePublishChunks, encodePublishV1Head, splitBody, encodeCommit } from '../src/core/envelope.js';
import { Compression, Op, type CommitSubOp } from '../src/core/types.js';
import { resolveSite, loadBody } from '../src/core/resolver.js';
import { extractBlobs } from '../src/core/sbor.js';
import { zstdCompress, sha256Sync, nodeCrypto } from '../src/node/env.js';
import { submitMessage, submitBlobTx, fetchSiteRecords } from '../src/cli/gateway.js';

const NET = NetworkId.Stokenet;
const GW = 'https://stokenet.radixdlt.com';
const hex = (u8: Uint8Array) => Buffer.from(u8).toString('hex');
const gw = async (p: string, b: unknown) => { const r = await fetch(GW + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const j = await r.json().catch(() => ({})); if (!r.ok) { const e: any = new Error(p + ' ' + r.status); e.body = j; throw e; } return j; };
const addr = (p: PrivateKey) => LTSRadixEngineToolkit.Derive.virtualAccountAddress(p.publicKey(), NET);
async function waitCommit(id: string) { for (let i = 0; i < 40; i++) { try { const d = await gw('/transaction/committed-details', { intent_hash: id }); if (d.transaction.transaction_status) return; } catch {} await new Promise((r) => setTimeout(r, 2000)); } throw new Error('timeout'); }
async function fund(priv: PrivateKey, account: string) {
  const faucet = (await LTSRadixEngineToolkit.Derive.knownAddresses(NET) as any).components.faucet;
  const e = (await gw('/status/gateway-status', {})).ledger_state.epoch;
  const tx = await (await TransactionBuilder.new()).header({ networkId: NET, startEpochInclusive: e, endEpochExclusive: e + 10, nonce: await generateRandomNonce(), notaryPublicKey: priv.publicKey(), notaryIsSignatory: true, tipPercentage: 0 })
    .manifest({ instructions: { kind: 'String', value: `CALL_METHOD Address("${faucet}") "lock_fee" Decimal("100"); CALL_METHOD Address("${faucet}") "free"; CALL_METHOD Address("${account}") "try_deposit_batch_or_abort" Expression("ENTIRE_WORKTOP") None;` }, blobs: [] }).notarize(priv);
  await gw('/transaction/submit', { notarized_transaction_hex: hex(await RadixEngineToolkit.NotarizedTransaction.compile(tx)) });
  await waitCommit((await RadixEngineToolkit.NotarizedTransaction.intentHash(tx)).id);
}
async function rawBlobs(txId: string): Promise<Uint8Array[]> {
  const d = await gw('/transaction/committed-details', { intent_hash: txId, opt_ins: { raw_hex: true } });
  return extractBlobs(Uint8Array.from(Buffer.from(d.transaction.raw_hex, 'hex')));
}

const priv = new PrivateKey.Ed25519(new Uint8Array(randomBytes(32)));
const account = await addr(priv);
console.log('site:', account);
console.log('funding…'); await fund(priv, account);

// 1. v0 page (message carrier) still works.
const v0raw = new TextEncoder().encode('# v0 page\n\nStill served from chunked messages.');
console.log('publishing v0 /legacy (msg carrier)…');
for (const c of encodePublishChunks({ path: '/legacy', snapshotId: new Uint8Array(randomBytes(16)), contentHash: sha256Sync(v0raw), compression: Compression.NONE }, v0raw)) await submitMessage(priv, account, c);

// 2. 50 KB page in ONE transaction (v1 blob).
const big = '# Big page\n\n' + 'Lorem ipsum dolor sit amet. '.repeat(1800); // ~50 KB
const bigRaw = new TextEncoder().encode(big);
const zc = zstdCompress(bigRaw); const useZstd = zc.length < bigRaw.length; const stream = useZstd ? zc : bigRaw;
const blobs = splitBody(stream);
const bigHead = encodePublishV1Head({ path: '/big', contentHash: sha256Sync(bigRaw), compression: useZstd ? Compression.ZSTD : Compression.NONE, bodyBlobs: blobs.length });
console.log(`publishing 50KB /big in 1 tx (raw ${bigRaw.length}B -> stream ${stream.length}B, ${blobs.length} blob)…`);
const bigTx = await submitBlobTx(priv, account, bigHead, blobs);
console.log('  ->', bigTx);

// 3. 5-op cart in ONE COMMIT transaction.
const cart: Array<{ t: 'p'; path: string; md: string } | { t: 'd'; path: string } | { t: 'r'; from: string; to: string }> = [
  { t: 'p', path: '/a', md: '# A\n\nAlpha.' },
  { t: 'p', path: '/b', md: '# B\n\nBravo body text.' },
  { t: 'p', path: '/c', md: '# C\n\nCharlie.' },
  { t: 'd', path: '/legacy' },
  { t: 'r', from: '/old', to: '/a' },
];
const subOps: CommitSubOp[] = []; const cartBlobs: Uint8Array[] = [];
for (const a of cart) {
  if (a.t === 'p') { const raw = new TextEncoder().encode(a.md); const parts = splitBody(raw); subOps.push({ op: Op.PUBLISH, path: a.path, contentHash: sha256Sync(raw), compression: Compression.NONE, blobStart: cartBlobs.length, blobCount: parts.length }); cartBlobs.push(...parts); }
  else if (a.t === 'd') subOps.push({ op: Op.DELETE, path: a.path });
  else subOps.push({ op: Op.REDIRECT, path: a.from, target: a.to });
}
const commitHead = encodeCommit(subOps);
console.log(`committing 5-op cart in 1 tx (head ${commitHead.length}B, ${cartBlobs.length} blobs)…`);
const cartTx = await submitBlobTx(priv, account, commitHead, cartBlobs);
console.log('  ->', cartTx);

// 4. Resolve from heads (qd ls equivalent) and materialize bodies.
console.log('\nresolving…');
const { pages } = await resolveSite(await fetchSiteRecords(account), nodeCrypto);
const status = (p: string) => pages.get(p)?.state.status ?? 'nonexistent';
async function body(p: string): Promise<string | null> {
  const st = pages.get(p)!.state; if (st.status !== 'published') return null;
  if (st.content != null) return st.content;
  return loadBody(st.op.body!, await rawBlobs(st.op.body!.txId), nodeCrypto);
}
for (const p of ['/legacy', '/big', '/a', '/b', '/c', '/old']) console.log(`  ${p}: ${status(p)}`);

const checks = {
  'v0 /legacy was deleted by the cart': status('/legacy') === 'deleted',
  '/big published (v1)': status('/big') === 'published',
  '/big body 50KB reassembled+verified': (await body('/big'))?.length === big.length,
  '/a /b /c published from one COMMIT': status('/a') === 'published' && status('/b') === 'published' && status('/c') === 'published',
  '/a body loads': (await body('/a')) === '# A\n\nAlpha.',
  '/old redirects to /a': status('/old') === 'redirected',
};
console.log('\nchecks:');
let allOk = true;
for (const [k, v] of Object.entries(checks)) { console.log(`  ${v ? '✅' : '❌'} ${k}`); allOk &&= v; }
console.log(allOk ? '\nT4 ACCEPTANCE PASS ✅' : '\nT4 ACCEPTANCE FAIL ❌');
if (!allOk) process.exit(1);
