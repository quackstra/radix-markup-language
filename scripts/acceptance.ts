// End-to-end acceptance on Stokenet (brief's Acceptance section):
// a site with >=3 pages, one deleted, one redirected, plus a forged message
// from a DIFFERENT account. Verifies the forgery never appears and that the
// resolver's view matches what was published.
//
// Testnet only. Generates fresh disposable keys and faucet-funds them.
import { randomBytes } from 'node:crypto';
import {
  RadixEngineToolkit, LTSRadixEngineToolkit, PrivateKey, NetworkId,
  TransactionBuilder, generateRandomNonce,
} from '@radixdlt/radix-engine-toolkit';
import { encodePublishChunks, encodeDelete, encodeRedirect } from '../src/core/envelope.js';
import { Compression, MIME_TYPE } from '../src/core/types.js';
import { resolveSite, render } from '../src/core/resolver.js';
import { zstdCompress, sha256Sync, nodeCrypto } from '../src/node/env.js';
import { fetchSiteRecords } from '../src/cli/gateway.js';

const NET = NetworkId.Stokenet;
const GW = 'https://stokenet.radixdlt.com';
const hex = (u8: Uint8Array) => Buffer.from(u8).toString('hex');

async function gw(path: string, body: unknown): Promise<any> {
  const res = await fetch(GW + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e: any = new Error(`${path} ${res.status}`); e.body = j; throw e; }
  return j;
}
const epoch = async () => (await gw('/status/gateway-status', {})).ledger_state.epoch;
async function waitCommit(id: string) {
  for (let i = 0; i < 40; i++) {
    try { const d = await gw('/transaction/committed-details', { intent_hash: id }); if (d.transaction.transaction_status) return d.transaction.transaction_status; } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('commit timeout ' + id);
}
function newKey() { return new PrivateKey.Ed25519(new Uint8Array(randomBytes(32))); }
const addr = (p: PrivateKey) => LTSRadixEngineToolkit.Derive.virtualAccountAddress(p.publicKey(), NET);

async function submit(priv: PrivateKey, manifest: string, envelope?: Uint8Array): Promise<string> {
  const e = await epoch();
  let step = (await TransactionBuilder.new()).header({
    networkId: NET, startEpochInclusive: e, endEpochExclusive: e + 10,
    nonce: await generateRandomNonce(), notaryPublicKey: priv.publicKey(), notaryIsSignatory: true, tipPercentage: 0,
  });
  if (envelope) step = step.message({ kind: 'PlainText', value: { mimeType: MIME_TYPE, message: { kind: 'Bytes', value: envelope } } });
  const tx = await step.manifest({ instructions: { kind: 'String', value: manifest }, blobs: [] }).notarize(priv);
  const compiled = await RadixEngineToolkit.NotarizedTransaction.compile(tx);
  const id = (await RadixEngineToolkit.NotarizedTransaction.intentHash(tx)).id;
  await gw('/transaction/submit', { notarized_transaction_hex: hex(compiled) });
  await waitCommit(id);
  return id;
}

async function fund(priv: PrivateKey) {
  const account = await addr(priv);
  const known = await LTSRadixEngineToolkit.Derive.knownAddresses(NET);
  const faucet = (known as any).components.faucet;
  await submit(priv, `
CALL_METHOD Address("${faucet}") "lock_fee" Decimal("100");
CALL_METHOD Address("${faucet}") "free";
CALL_METHOD Address("${account}") "try_deposit_batch_or_abort" Expression("ENTIRE_WORKTOP") None;
`.trim());
}

async function publish(priv: PrivateKey, account: string, path: string, md: string, note?: string) {
  const raw = new TextEncoder().encode(md);
  const zc = zstdCompress(raw);
  const useZstd = zc.length < raw.length;
  const stream = useZstd ? zc : raw;
  const chunks = encodePublishChunks(
    { path, note, snapshotId: new Uint8Array(randomBytes(16)), contentHash: sha256Sync(raw), compression: useZstd ? Compression.ZSTD : Compression.NONE },
    stream,
  );
  for (const c of chunks) await submit(priv, `CALL_METHOD Address("${account}") "lock_fee" Decimal("5");`, c);
  return chunks.length;
}

async function main() {
  const site = newKey(); const siteAcct = await addr(site);
  const forger = newKey(); const forgerAcct = await addr(forger);
  console.log('site  :', siteAcct);
  console.log('forger:', forgerAcct);
  console.log('funding both from faucet…');
  await fund(site); await fund(forger);

  console.log('publishing pages…');
  const n1 = await publish(site, siteAcct, '/about', '# About\n\nA site on the ledger.', 'initial');
  // a multi-chunk page: high-entropy content so zstd cannot collapse it to one chunk
  const big = '# Big\n\n' + Buffer.from(randomBytes(4000)).toString('base64');
  const n2 = await publish(site, siteAcct, '/blog/first-post', big, 'long post');
  await publish(site, siteAcct, '/temp', '# Temp\n\ndelete me', 'temp');
  await publish(site, siteAcct, '/old', '# Old\n\nmoved', 'to be redirected');
  console.log(`  /about=${n1} chunk(s), /blog/first-post=${n2} chunk(s)`);

  console.log('delete /temp; redirect /old -> /about …');
  await submit(site, `CALL_METHOD Address("${siteAcct}") "lock_fee" Decimal("5");`, encodeDelete('/temp', 'no longer needed'));
  await submit(site, `CALL_METHOD Address("${siteAcct}") "lock_fee" Decimal("5");`, encodeRedirect('/old', '/about', 'moved to about'));

  console.log('forger publishes a fake /about from a DIFFERENT account…');
  const forged = encodePublishChunks(
    { path: '/about', note: 'FORGED', snapshotId: new Uint8Array(randomBytes(16)), contentHash: sha256Sync(new TextEncoder().encode('EVIL')), compression: Compression.NONE },
    new TextEncoder().encode('EVIL'),
  );
  await submit(forger, `CALL_METHOD Address("${forgerAcct}") "lock_fee" Decimal("5");`, forged[0]!);

  console.log('\nresolving site from the Gateway…');
  const records = await fetchSiteRecords(siteAcct);
  const { pages } = await resolveSite(records, nodeCrypto);

  console.log(`fetched ${records.length} site record(s)`);
  for (const path of [...pages.keys()].sort()) {
    const s = pages.get(path)!.state;
    console.log(`  ${path}: ${s.status}${s.status === 'redirected' ? ' -> ' + s.target : ''}${s.status === 'published' ? ' (' + s.op.chunkCount + ' chunk)' : ''}`);
  }

  // Assertions
  const about = pages.get('/about')!.state;
  const okAbout = about.status === 'published' && about.content.startsWith('# About') && !about.content.includes('EVIL');
  const okTemp = pages.get('/temp')!.state.status === 'deleted';
  const okOld = pages.get('/old')!.state.status === 'redirected';
  const r = render(pages, '/old');
  const okRedirectResolves = r.kind === 'page' && r.content.startsWith('# About');
  const forgedAbsent = okAbout; // forged EVIL never became /about content

  console.log('\nchecks:');
  console.log('  /about published & not forged :', okAbout);
  console.log('  /temp deleted                 :', okTemp);
  console.log('  /old redirected               :', okOld);
  console.log('  /old resolves to /about page  :', okRedirectResolves);
  console.log('  forged message excluded       :', forgedAbsent);
  const allOk = okAbout && okTemp && okOld && okRedirectResolves && forgedAbsent;
  console.log(allOk ? '\nACCEPTANCE PASS ✅' : '\nACCEPTANCE FAIL ❌');
  if (!allOk) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
