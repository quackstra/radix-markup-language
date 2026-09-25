// Seed typed social content on Stokenet so Radpress has real data: two accounts
// with profiles, posts, a theme, follows, and a cross-site reply. Idempotent per
// account name (.social-keys.json, gitignored). Publishes v1 blob transactions.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import {
  RadixEngineToolkit, LTSRadixEngineToolkit, PrivateKey, NetworkId,
  TransactionBuilder, generateRandomNonce,
} from '@radixdlt/radix-engine-toolkit';
import { encodePublishV1Head, splitBody } from '../src/core/envelope.js';
import { serializePage } from '../src/core/schema.js';
import { Compression } from '../src/core/types.js';
import { zstdCompress, sha256Sync } from '../src/node/env.js';
import { submitBlobTx, submitRegister } from '../src/cli/gateway.js';
import { encodeRegister } from '../src/core/envelope.js';

const NET = NetworkId.Stokenet;
const GW = 'https://stokenet.radixdlt.com';
const KEYS = new URL('./.social-keys.json', import.meta.url);
const hex = (u8: Uint8Array) => Buffer.from(u8).toString('hex');
const gw = async (p: string, b: unknown) => { const r = await fetch(GW + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const j = await r.json().catch(() => ({})); if (!r.ok) { const e: any = new Error(p + ' ' + r.status); e.body = j; throw e; } return j; };
const addr = (p: PrivateKey) => LTSRadixEngineToolkit.Derive.virtualAccountAddress(p.publicKey(), NET);
async function waitCommit(id: string) { for (let i = 0; i < 40; i++) { try { const d = await gw('/transaction/committed-details', { intent_hash: id }); if (d.transaction.transaction_status) return; } catch {} await new Promise((r) => setTimeout(r, 2000)); } throw new Error('timeout'); }
async function xrd(account: string): Promise<number> { try { const d = await gw('/state/entity/details', { addresses: [account], aggregation_level: 'Global' }); const x = (await LTSRadixEngineToolkit.Derive.knownAddresses(NET)).resources.xrdResource; return Number(d.items?.[0]?.fungible_resources?.items?.find((i: any) => i.resource_address === x)?.amount ?? '0'); } catch { return 0; } }
async function fund(priv: PrivateKey, account: string) {
  const faucet = (await LTSRadixEngineToolkit.Derive.knownAddresses(NET) as any).components.faucet;
  const e = (await gw('/status/gateway-status', {})).ledger_state.epoch;
  const tx = await (await TransactionBuilder.new()).header({ networkId: NET, startEpochInclusive: e, endEpochExclusive: e + 10, nonce: await generateRandomNonce(), notaryPublicKey: priv.publicKey(), notaryIsSignatory: true, tipPercentage: 0 })
    .manifest({ instructions: { kind: 'String', value: `CALL_METHOD Address("${faucet}") "lock_fee" Decimal("100"); CALL_METHOD Address("${faucet}") "free"; CALL_METHOD Address("${account}") "try_deposit_batch_or_abort" Expression("ENTIRE_WORKTOP") None;` }, blobs: [] }).notarize(priv);
  await gw('/transaction/submit', { notarized_transaction_hex: hex(await RadixEngineToolkit.NotarizedTransaction.compile(tx)) });
  await waitCommit((await RadixEngineToolkit.NotarizedTransaction.intentHash(tx)).id);
}
async function publish(priv: PrivateKey, account: string, path: string, content: string): Promise<string> {
  const raw = new TextEncoder().encode(content);
  const zc = zstdCompress(raw); const useZstd = zc.length < raw.length;
  const blobs = splitBody(useZstd ? zc : raw);
  const head = encodePublishV1Head({ path, contentHash: sha256Sync(raw), compression: useZstd ? Compression.ZSTD : Compression.NONE, bodyBlobs: blobs.length });
  return submitBlobTx(priv, account, head, blobs);
}

const store: Record<string, { privHex: string; address: string }> = existsSync(KEYS) ? JSON.parse(readFileSync(KEYS, 'utf8')) : {};
async function acct(name: string) {
  let e = store[name];
  if (!e) { const b = new Uint8Array(randomBytes(32)); const p = new PrivateKey.Ed25519(b); e = { privHex: hex(b), address: await addr(p) }; store[name] = e; writeFileSync(KEYS, JSON.stringify(store, null, 2)); }
  return { priv: new PrivateKey.Ed25519(Uint8Array.from(Buffer.from(e.privHex, 'hex'))), account: e.address };
}
const post = (title: string, tags: string[], body: string) => serializePage({ v: 1, type: 'post', title, tags }, body);

const alice = await acct('alice');
const bob = await acct('bob');
console.log('alice:', alice.account, '\nbob:', bob.account);
if (await xrd(alice.account) < 100) { console.log('funding alice…'); await fund(alice.priv, alice.account); }
if (await xrd(bob.account) < 100) { console.log('funding bob…'); await fund(bob.priv, bob.account); }

console.log('alice: theme, profile, posts, follows…');
await publish(alice.priv, alice.account, '/theme-atom', serializePage({ v: 1, type: 'theme', name: 'Pondwater', tokens: { bg: '#0e1a14', fg: '#e9f5ee', accent: '#48d597', card: '#132a20', line: '#204234', muted: '#7fae98', link: '#8fe3c0' } }, 'The Pondwater theme.'));
await publish(alice.priv, alice.account, '/', serializePage({ v: 1, type: 'profile', name: 'Alice on the Ledger', bio: 'Building on Radix, one transaction at a time.', theme: `rdx:page:${alice.account}:/theme-atom`, links: [{ label: 'radixdlt.com', url: 'https://radixdlt.com' }] }, 'Welcome to my corner of the ledger. Everything here is a Radix transaction.'));
const aliceHelloTx = await publish(alice.priv, alice.account, '/posts/hello', post('Hello, ledger', ['gm', 'radix'], '# Hello, ledger\n\nMy first on-ledger post, published with Quackdown — no server, no database. If you can read this, you read it straight from Stokenet.'));
await publish(alice.priv, alice.account, '/posts/why-quackdown', post('Why Quackdown', ['quackdown'], '# Why Quackdown\n\nA website that outlives its host. Delete the app and the pages remain on the ledger, waiting for the next reader.'));
await publish(alice.priv, alice.account, '/follows', serializePage({ v: 1, type: 'follows', accounts: [bob.account] }, ''));
await submitRegister(alice.priv, alice.account, encodeRegister('Alice on the Ledger'));

console.log('bob: profile, post, reply-to-alice, follows…');
await publish(bob.priv, bob.account, '/', serializePage({ v: 1, type: 'profile', name: 'Bob Writes', bio: 'Shipping words on Radix.' }, 'gm. This is Bob.'));
await publish(bob.priv, bob.account, '/posts/gm', post('gm', ['gm'], '# gm\n\nStill early. Still writing. Still on-ledger.'));
await publish(bob.priv, bob.account, '/replies/1', serializePage({ v: 1, type: 'reply', to: `rdx:tx:${aliceHelloTx}`, title: 're: Hello, ledger' }, 'Great post, Alice — this is genuinely wild. Reply written on **my** site, shown under **your** post.'));
await publish(bob.priv, bob.account, '/follows', serializePage({ v: 1, type: 'follows', accounts: [alice.account] }, ''));
await submitRegister(bob.priv, bob.account, encodeRegister('Bob Writes'));

console.log('\nDONE.');
console.log('alice:', alice.account);
console.log('bob  :', bob.account);
console.log('alice /posts/hello tx (reply target):', aliceHelloTx);
