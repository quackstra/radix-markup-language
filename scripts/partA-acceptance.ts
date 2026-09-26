// Part A live acceptance on Stokenet:
//  (1) a cart with two IDENTICAL pages + one EMPTY-body page publishes in ONE tx
//      (DuplicateBlob fix), and all resolve.
//  (2) a reply referencing rdx:tx:<hash>#1 resolves to the right post in a COMMIT batch.
import { readFileSync } from 'node:fs';
import { PrivateKey } from '@radixdlt/radix-engine-toolkit';
import { buildCommit, resolveSite, loadBody, fetchSiteRecords, fetchRawPayload, extractBlobs, parsePage, asReply, parseRef, serializePage, type CommitBuildItem } from '../src/core/index.js';
import { Op, Compression } from '../src/core/types.js';
import { nodeCrypto, sha256Sync } from '../src/node/env.js';
import { submitBlobTx, siteAddress } from '../src/cli/gateway.js';

const keys = JSON.parse(readFileSync(new URL('./.social-keys.json', import.meta.url), 'utf8'));
const alice = new PrivateKey.Ed25519(Uint8Array.from(Buffer.from(keys.alice.privHex, 'hex')));
const bob = new PrivateKey.Ed25519(Uint8Array.from(Buffer.from(keys.bob.privHex, 'hex')));
const aliceAcct = await siteAddress(alice);
const bobAcct = await siteAddress(bob);
const enc = (s: string) => new TextEncoder().encode(s);
const pub = (path: string, content: string): CommitBuildItem => ({ op: Op.PUBLISH, path, bodyBytes: enc(content), contentHash: sha256Sync(enc(content)), compression: Compression.NONE });
async function bodyAt(account: string, path: string): Promise<string | null> {
  const { pages } = await resolveSite(await fetchSiteRecords(account), nodeCrypto);
  const st = pages.get(path)?.state; if (!st || st.status !== 'published') return null;
  if (st.op.content != null) return st.op.content;
  return loadBody(st.op.body!, extractBlobs(await fetchRawPayload(st.op.body!.txId)), nodeCrypto);
}

// (1) dedupe: 2 identical + 1 empty
console.log('A1: publishing 2 identical + 1 empty-body page in one tx…');
const SAME = '# Same body\n\nidentical bytes';
const dedupe = buildCommit([pub('/dup-a', SAME), pub('/dup-b', SAME), pub('/empty', '')]);
console.log('  blobs after dedupe:', dedupe.blobs.length, '(expected 2: one shared + one empty)');
const tx1 = await submitBlobTx(alice, aliceAcct, dedupe.head, dedupe.blobs);
console.log('  committed in 1 tx:', tx1);
const a = await bodyAt(aliceAcct, '/dup-a'), b = await bodyAt(aliceAcct, '/dup-b'), e = await bodyAt(aliceAcct, '/empty');
const a1ok = dedupe.blobs.length === 2 && a === SAME && b === SAME && e === '';

// (2) batch refs
console.log('\nA2: publishing a 2-post COMMIT, then a reply to op #1…');
const post = (t: string, body: string) => serializePage({ v: 1, type: 'post', title: t }, body);
const batch = buildCommit([pub('/bp0', post('Post Zero', 'zero')), pub('/bp1', post('Post One', 'one'))]);
const committx = await submitBlobTx(alice, aliceAcct, batch.head, batch.blobs);
console.log('  commit tx:', committx);
const reply = buildCommit([pub('/replies/batch', serializePage({ v: 1, type: 'reply', to: `rdx:tx:${committx}#1`, title: 're: Post One' }, 'replying to op 1'))]);
await submitBlobTx(bob, bobAcct, reply.head, reply.blobs);

const { pages: ap } = await resolveSite(await fetchSiteRecords(aliceAcct), nodeCrypto);
const bp1 = ap.get('/bp1')!.state; const bp0 = ap.get('/bp0')!.state;
const { pages: bp } = await resolveSite(await fetchSiteRecords(bobAcct), nodeCrypto);
const replyObj = asReply(parsePage((await bodyAt(bobAcct, '/replies/batch'))!));
const ref = replyObj && parseRef(replyObj.to);
const targetsOp1 = bp1.status === 'published' && bp0.status === 'published' && ref?.kind === 'tx'
  && ref.tx === committx && ref.opIndex === 1
  && bp1.op.txId === committx && bp1.op.opIndex === 1 && bp0.op.opIndex === 0;

console.log('\nresults:');
console.log('  A1 dedupe (2 identical + empty in 1 tx, all resolve):', a1ok);
console.log('  A2 batch ref #1 targets /bp1 (op index 1), not /bp0:', targetsOp1);
const ok = a1ok && targetsOp1;
console.log(ok ? '\nPART A CORE ACCEPTANCE PASS ✅' : '\nPART A CORE ACCEPTANCE FAIL ❌');
if (!ok) process.exit(1);
