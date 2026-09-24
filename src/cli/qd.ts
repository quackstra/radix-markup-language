#!/usr/bin/env -S npx tsx
// qd — Quackdown publisher CLI (Stokenet only).
// Site key comes from QUACKDOWN_SITE_KEY (32-byte ed25519 hex). Never logged.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { encodePublishChunks, encodeDelete, encodeRedirect, normalizePath } from '../core/envelope.js';
import { Compression } from '../core/types.js';
import { resolveSite } from '../core/resolver.js';
import { zstdCompress, sha256Sync, nodeCrypto } from '../node/env.js';
import { loadSiteKey, siteAddress, submitMessage, fetchSiteRecords, estimateChunkFee } from './gateway.js';

function fail(msg: string): never { console.error('error:', msg); process.exit(1); }

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'publish': return publish(rest);
    case 'delete': return del(rest);
    case 'redirect': return redirect(rest);
    case 'ls': return ls();
    case 'history': return history(rest);
    default:
      console.log(`qd <command>
  publish <file.md> --path /about [--note "…"] [--dry-run]
  delete --path /about [--note "…"]
  redirect --from /old --to /new [--note "…"]
  ls
  history --path /about`);
      process.exit(cmd ? 1 : 0);
  }
}

async function publish(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: { path: { type: 'string' }, note: { type: 'string' }, 'dry-run': { type: 'boolean' } },
  });
  const file = positionals[0];
  if (!file) fail('publish needs a markdown file');
  if (!values.path) fail('--path required');
  const raw = new Uint8Array(readFileSync(file));
  const zc = zstdCompress(raw);
  const useZstd = zc.length < raw.length;
  const stream = useZstd ? zc : raw;
  const snapshotId = new Uint8Array(randomBytes(16));
  const chunks = encodePublishChunks(
    { path: values.path, note: values.note, snapshotId, contentHash: sha256Sync(raw), compression: useZstd ? Compression.ZSTD : Compression.NONE },
    stream,
  );
  const estFee = chunks.reduce((s, c) => s + estimateChunkFee(c.length), 0);
  console.log(`path         : ${normalizePath(values.path)}`);
  console.log(`raw          : ${raw.length} B`);
  console.log(`stream       : ${stream.length} B (${useZstd ? 'zstd' : 'stored'})`);
  console.log(`snapshot     : ${Buffer.from(snapshotId).toString('hex')}`);
  console.log(`chunks       : ${chunks.length} (1 tx each)`);
  console.log(`est. fee     : ~${estFee.toFixed(3)} XRD`);
  if (values['dry-run']) { console.log('dry-run: not submitted.'); return; }

  const priv = loadSiteKey();
  const account = await siteAddress(priv);
  console.log(`site         : ${account}`);
  const txIds: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const id = await submitMessage(priv, account, chunks[i]!);
    txIds.push(id);
    console.log(`  chunk ${i}/${chunks.length - 1} -> ${id}`);
  }
  console.log(`done: ${txIds.length} tx committed.`);
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
    if (state.status === 'published') console.log(`  ${path}  [published] snapshot ${state.op.snapshotId.slice(0, 8)}… ${state.op.chunkCount} chunk(s)`);
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
      console.log(`  v${op.stateVersion}  publish  snapshot ${op.snapshotId.slice(0, 8)}…  ${op.presentChunks}/${op.chunkCount} chunks  ${tag}${op.note ? '  — ' + op.note : ''}`);
    } else if (op.kind === 'delete') {
      console.log(`  v${op.stateVersion}  delete${op.note ? '  — ' + op.note : ''}`);
    } else {
      console.log(`  v${op.stateVersion}  redirect -> ${op.target}${op.note ? '  — ' + op.note : ''}`);
    }
  }
}

main().catch((e) => fail(e.message));
