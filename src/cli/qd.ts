#!/usr/bin/env -S npx tsx
// qd — Quackdown publisher CLI (Stokenet only).
// Site key comes from QUACKDOWN_SITE_KEY (32-byte ed25519 hex). Never logged.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { encodePublishChunks, encodePublishV1Head, splitBody, encodeDelete, encodeRedirect, normalizePath } from '../core/envelope.js';
import { Compression, Op } from '../core/types.js';
import { buildCommit, type CommitBuildItem } from '../core/commit.js';
import { resolveSite } from '../core/resolver.js';
import { zstdCompress, sha256Sync, nodeCrypto } from '../node/env.js';
import { loadSiteKey, siteAddress, submitMessage, submitBlobTx, submitRegister, fetchSiteRecords, fetchRegistryRecords, estimateChunkFee } from './gateway.js';
import { readFileSync as readFile } from 'node:fs';
import { encodeRegister } from '../core/envelope.js';
import { resolveRegistry } from '../core/registry.js';

function fail(msg: string): never { console.error('error:', msg); process.exit(1); }

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'publish': return publish(rest);
    case 'delete': return del(rest);
    case 'redirect': return redirect(rest);
    case 'ls': return ls();
    case 'history': return history(rest);
    case 'register': return register(rest);
    case 'dir': return dir();
    case 'commit': return commit(rest);
    default:
      console.log(`qd <command>
  publish <file.md> --path /about [--note "…"] [--carrier blob|msg] [--dry-run]
  commit <cart.json> [--dry-run]   publish a batch of ops in ONE transaction
  delete --path /about [--note "…"]
  redirect --from /old --to /new [--note "…"]
  ls
  history --path /about
  register [--title "My Site"]   add your account to the public directory
  dir                            list the public directory`);
      process.exit(cmd ? 1 : 0);
  }
}

async function publish(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: { path: { type: 'string' }, note: { type: 'string' }, 'dry-run': { type: 'boolean' }, carrier: { type: 'string' } },
  });
  const file = positionals[0];
  if (!file) fail('publish needs a markdown file');
  if (!values.path) fail('--path required');
  const raw = new Uint8Array(readFileSync(file));
  const zc = zstdCompress(raw);
  const useZstd = zc.length < raw.length;
  const stream = useZstd ? zc : raw;
  const compression = useZstd ? Compression.ZSTD : Compression.NONE;

  if (values.carrier === 'msg') {
    // v0 chunked-message carrier.
    const snapshotId = new Uint8Array(randomBytes(16));
    const chunks = encodePublishChunks({ path: values.path, note: values.note, snapshotId, contentHash: sha256Sync(raw), compression }, stream);
    const estFee = chunks.reduce((s, c) => s + estimateChunkFee(c.length), 0);
    console.log(`carrier      : message (v0)`);
    console.log(`path         : ${normalizePath(values.path)}`);
    console.log(`raw / stream : ${raw.length} / ${stream.length} B (${useZstd ? 'zstd' : 'stored'})`);
    console.log(`chunks       : ${chunks.length} (1 tx each)  est. fee ~${estFee.toFixed(3)} XRD`);
    if (values['dry-run']) { console.log('dry-run: not submitted.'); return; }
    const priv = loadSiteKey();
    const account = await siteAddress(priv);
    for (let i = 0; i < chunks.length; i++) console.log(`  chunk ${i} -> ${await submitMessage(priv, account, chunks[i]!)}`);
    console.log(`done: ${chunks.length} tx committed.`);
    return;
  }

  // v1 blob carrier (default): one transaction, head message + body blobs.
  const blobs = splitBody(stream);
  const head = encodePublishV1Head({ path: values.path, note: values.note, contentHash: sha256Sync(raw), compression, bodyBlobs: blobs.length });
  const totalBytes = head.length + stream.length;
  const estFee = estimateChunkFee(totalBytes);
  console.log(`carrier      : blob (v1)`);
  console.log(`path         : ${normalizePath(values.path)}`);
  console.log(`raw / stream : ${raw.length} / ${stream.length} B (${useZstd ? 'zstd' : 'stored'})`);
  console.log(`head / blobs : ${head.length} B / ${blobs.length} blob(s)`);
  console.log(`transactions : 1  est. fee ~${estFee.toFixed(3)} XRD`);
  if (values['dry-run']) { console.log('dry-run: not submitted.'); return; }
  const priv = loadSiteKey();
  const account = await siteAddress(priv);
  const id = await submitBlobTx(priv, account, head, blobs);
  console.log(`done: 1 tx committed -> ${id}`);
}

async function del(argv: string[]) {
  const { values } = parseArgs({ args: argv, options: { path: { type: 'string' }, note: { type: 'string' } } });
  if (!values.path) fail('--path required');
  const priv = loadSiteKey();
  const account = await siteAddress(priv);
  const id = await submitMessage(priv, account, encodeDelete(values.path, values.note ?? ''));
  console.log(`deleted ${normalizePath(values.path)} -> ${id}`);
}

async function redirect(argv: string[]) {
  const { values } = parseArgs({ args: argv, options: { from: { type: 'string' }, to: { type: 'string' }, note: { type: 'string' } } });
  if (!values.from || !values.to) fail('--from and --to required');
  const priv = loadSiteKey();
  const account = await siteAddress(priv);
  const id = await submitMessage(priv, account, encodeRedirect(values.from, values.to, values.note ?? ''));
  console.log(`redirect ${normalizePath(values.from)} -> ${normalizePath(values.to)} : ${id}`);
}

async function loadResolution() {
  const priv = loadSiteKey();
  const account = await siteAddress(priv);
  const records = await fetchSiteRecords(account);
  const { pages } = await resolveSite(records, nodeCrypto);
  return { account, pages };
}

async function ls() {
  const { account, pages } = await loadResolution();
  console.log(`site: ${account}`);
  const paths = [...pages.keys()].sort();
  if (!paths.length) { console.log('(no pages)'); return; }
  for (const path of paths) {
    const { state } = pages.get(path)!;
    if (state.status === 'published') {
      const carrier = state.op.body ? `blob (v1, ${state.op.body.blobCount} blob${state.op.body.blobCount > 1 ? 's' : ''})` : `msg (v0, ${state.op.chunkCount} chunk${state.op.chunkCount! > 1 ? 's' : ''})`;
      console.log(`  ${path}  [published] ${carrier}`);
    }
    else if (state.status === 'deleted') console.log(`  ${path}  [deleted]${state.note ? ' — ' + state.note : ''}`);
    else if (state.status === 'redirected') console.log(`  ${path}  [redirect] -> ${state.target}${state.note ? ' — ' + state.note : ''}`);
    else console.log(`  ${path}  [nonexistent]`);
  }
}

async function history(argv: string[]) {
  const { values } = parseArgs({ args: argv, options: { path: { type: 'string' } } });
  if (!values.path) fail('--path required');
  const path = normalizePath(values.path);
  const { pages } = await loadResolution();
  const page = pages.get(path);
  if (!page) { console.log(`${path}: no history`); return; }
  console.log(`${path} — ${page.history.length} op(s):`);
  for (const op of page.history) {
    if (op.kind === 'publish') {
      const tag = op.resolvable ? 'ok' : `EXCLUDED (${op.reason})`;
      const carrier = op.body ? `blob×${op.body.blobCount}` : `msg ${op.presentChunks}/${op.chunkCount}`;
      console.log(`  v${op.stateVersion}#${op.opIndex}  publish  ${carrier}  ${tag}${op.note ? '  — ' + op.note : ''}`);
    } else if (op.kind === 'delete') {
      console.log(`  v${op.stateVersion}  delete${op.note ? '  — ' + op.note : ''}`);
    } else {
      console.log(`  v${op.stateVersion}  redirect -> ${op.target}${op.note ? '  — ' + op.note : ''}`);
    }
  }
}

async function register(argv: string[]) {
  const { values } = parseArgs({ args: argv, options: { title: { type: 'string' } } });
  const priv = loadSiteKey();
  const account = await siteAddress(priv);
  const id = await submitRegister(priv, account, encodeRegister(values.title ?? ''));
  console.log(`registered ${account}${values.title ? ` as "${values.title}"` : ''} -> ${id}`);
}

async function dir() {
  const entries = resolveRegistry(await fetchRegistryRecords());
  if (!entries.length) { console.log('(directory empty)'); return; }
  console.log(`${entries.length} registered site(s):`);
  for (const e of entries) console.log(`  ${e.title ? e.title + '  ' : ''}${e.account}`);
}

// Cart file: [{type:'publish',path,file,note?}|{type:'delete',path,note?}|{type:'redirect',from,to,note?}]
async function commit(argv: string[]) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { 'dry-run': { type: 'boolean' } } });
  const cartFile = positionals[0];
  if (!cartFile) fail('commit needs a cart.json');
  const cart = JSON.parse(readFile(cartFile, 'utf8')) as any[];
  const items: CommitBuildItem[] = cart.map((a) => {
    if (a.type === 'publish') {
      const raw = a.content != null ? new TextEncoder().encode(a.content) : new Uint8Array(readFileSync(a.file));
      const zc = zstdCompress(raw);
      const useZstd = zc.length < raw.length;
      return { op: Op.PUBLISH, path: a.path, note: a.note, bodyBytes: useZstd ? zc : raw, contentHash: sha256Sync(raw), compression: useZstd ? Compression.ZSTD : Compression.NONE };
    }
    if (a.type === 'delete') return { op: Op.DELETE, path: a.path, note: a.note };
    if (a.type === 'redirect') return { op: Op.REDIRECT, path: a.from, note: a.note, target: a.to };
    return fail(`unknown cart action: ${a.type}`);
  });
  const { head, blobs, subOps } = buildCommit(items);
  const totalBytes = head.length + blobs.reduce((s, b) => s + b.length, 0);
  console.log(`ops          : ${subOps.length}  (publishes carry ${blobs.length} deduped blob(s))`);
  console.log(`head         : ${head.length} B / 2048  ·  transactions: 1  ·  est. fee ~${estimateChunkFee(totalBytes).toFixed(3)} XRD`);
  if (values['dry-run']) { console.log('dry-run: not submitted.'); return; }
  const priv = loadSiteKey();
  const account = await siteAddress(priv);
  const id = await submitBlobTx(priv, account, head, blobs);
  console.log(`committed ${subOps.length} ops in 1 tx -> ${id}`);
}

main().catch((e) => fail(e.message));
