import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encodePublishV1Head, splitBody, encodeCommit, decode } from '../src/core/envelope.js';
import { resolveSite, loadBody, render } from '../src/core/resolver.js';
import { extractBlobs } from '../src/core/sbor.js';
import { Compression, Op, type CommitSubOp } from '../src/core/types.js';
import { zstdCompress, sha256Sync, nodeCrypto } from '../src/node/env.js';
import { records, resetCounters } from './helpers.js';

beforeEach(resetCounters);
const resolve = (recs: Parameters<typeof resolveSite>[0]) => resolveSite(recs, nodeCrypto);
const enc = (s: string) => new TextEncoder().encode(s);

function v1Publish(path: string, md: string, opts: { maxBlobBytes?: number; noCompress?: boolean; note?: string } = {}) {
  const raw = enc(md);
  const zc = zstdCompress(raw);
  const useZstd = !opts.noCompress && zc.length < raw.length;
  const stream = useZstd ? zc : raw;
  const blobs = splitBody(stream, opts.maxBlobBytes);
  const head = encodePublishV1Head({ path, note: opts.note, contentHash: sha256Sync(raw), compression: useZstd ? Compression.ZSTD : Compression.NONE, bodyBlobs: blobs.length });
  return { head, blobs, raw };
}

describe('v1 single-blob page', () => {
  it('resolves as published (lazy) and loads the body', async () => {
    const { head, blobs } = v1Publish('/a', '# Hello v1\n\nblob carrier.');
    expect(blobs.length).toBe(1);
    const { pages } = await resolve(records({ bytes: [head] }));
    const st = pages.get('/a')!.state;
    expect(st.status).toBe('published');
    if (st.status === 'published') {
      expect(st.content).toBeNull(); // v1 body is lazy
      expect(st.op.body!.blobCount).toBe(1);
      expect(await loadBody(st.op.body!, blobs, nodeCrypto)).toBe('# Hello v1\n\nblob carrier.');
    }
  });
});

describe('v1 multi-blob page', () => {
  it('splits across blobs and reassembles', async () => {
    const md = '# Big\n\n' + Buffer.from(randomBytes(4000)).toString('base64');
    const { head, blobs } = v1Publish('/big', md, { maxBlobBytes: 800, noCompress: true });
    expect(blobs.length).toBeGreaterThan(1);
    const { pages } = await resolve(records({ bytes: [head] }));
    const st = pages.get('/big')!.state;
    if (st.status === 'published') {
      expect(st.op.body!.blobCount).toBe(blobs.length);
      expect(await loadBody(st.op.body!, blobs, nodeCrypto)).toBe(md);
    }
  });

  it('missing blob -> loadBody null', async () => {
    const { head, blobs } = v1Publish('/big', Buffer.from(randomBytes(3000)).toString('base64'), { maxBlobBytes: 500, noCompress: true });
    const { pages } = await resolve(records({ bytes: [head] }));
    const st = pages.get('/big')!.state;
    if (st.status === 'published') expect(await loadBody(st.op.body!, blobs.slice(0, -1), nodeCrypto)).toBeNull();
  });

  it('hash mismatch -> loadBody null', async () => {
    const { head } = v1Publish('/h', 'honest', {});
    const { pages } = await resolve(records({ bytes: [head] }));
    const st = pages.get('/h')!.state;
    // give loadBody the WRONG blob bytes
    if (st.status === 'published') expect(await loadBody(st.op.body!, [zstdCompress(enc('LIE'))], nodeCrypto)).toBeNull();
  });
});

describe('v1 COMMIT batch', () => {
  function buildCommit(actions: Array<{ t: 'publish'; path: string; md: string } | { t: 'delete'; path: string } | { t: 'redirect'; from: string; to: string }>) {
    const subOps: CommitSubOp[] = [];
    const blobs: Uint8Array[] = [];
    for (const a of actions) {
      if (a.t === 'publish') {
        const raw = enc(a.md); const parts = splitBody(raw);
        subOps.push({ op: Op.PUBLISH, path: a.path, contentHash: sha256Sync(raw), compression: Compression.NONE, blobStart: blobs.length, blobCount: parts.length });
        blobs.push(...parts);
      } else if (a.t === 'delete') subOps.push({ op: Op.DELETE, path: a.path });
      else subOps.push({ op: Op.REDIRECT, path: a.from, target: a.to });
    }
    return { head: encodeCommit(subOps), blobs };
  }

  it('mixed ops in one tx resolve, each publish loads from its blob range', async () => {
    const { head, blobs } = buildCommit([
      { t: 'publish', path: '/p1', md: '# P1' },
      { t: 'publish', path: '/p2', md: '# P2 longer body here' },
      { t: 'delete', path: '/gone' },
      { t: 'redirect', from: '/old', to: '/p1' },
    ]);
    const { pages } = await resolve(records({ bytes: [head] }));
    expect(pages.get('/gone')!.state.status).toBe('deleted');
    expect(pages.get('/old')!.state.status).toBe('redirected');
    const p1 = pages.get('/p1')!.state, p2 = pages.get('/p2')!.state;
    if (p1.status === 'published') expect(await loadBody(p1.op.body!, blobs, nodeCrypto)).toBe('# P1');
    if (p2.status === 'published') expect(await loadBody(p2.op.body!, blobs, nodeCrypto)).toBe('# P2 longer body here');
    const r = render(pages, '/old');
    expect(r.kind).toBe('page');
  });

  it('same-transaction ordering: later op index wins', async () => {
    // publish /x then delete /x in the SAME commit -> deleted
    const { head } = buildCommit([{ t: 'publish', path: '/x', md: 'hi' }, { t: 'delete', path: '/x' }]);
    const { pages } = await resolve(records({ bytes: [head] }));
    expect(pages.get('/x')!.state.status).toBe('deleted');
  });
});

describe('v0 / v1 mixed site', () => {
  it('both carriers resolve on the same site', async () => {
    const { publishChunks } = await import('./helpers.js');
    const v0 = publishChunks('/old', '# v0 page', { compression: Compression.NONE });
    const { head, blobs } = v1Publish('/new', '# v1 page');
    const { pages } = await resolve(records({ bytes: v0 }, { bytes: [head] }));
    const oldSt = pages.get('/old')!.state, newSt = pages.get('/new')!.state;
    expect(oldSt.status).toBe('published');
    if (oldSt.status === 'published') expect(oldSt.content).toBe('# v0 page'); // v0 inline
    if (newSt.status === 'published') { expect(newSt.content).toBeNull(); expect(await loadBody(newSt.op.body!, blobs, nodeCrypto)).toBe('# v1 page'); }
  });
});

describe('v1 auth', () => {
  it('forged v1 head from a non-owner tx is ignored', async () => {
    const { head } = v1Publish('/forged', 'evil');
    const { pages } = await resolve(records({ bytes: [head], ownerCall: false }));
    expect(pages.get('/forged')).toBeUndefined();
  });
});

describe('SBOR blob extractor', () => {
  it('extracts an Array<Array<u8>> with LEB128 lengths', () => {
    // Build: 0x20 0x20 <count=2> then (0x07 <len> bytes)*2, embedded in noise.
    const b1 = Uint8Array.from([1, 2, 3, 4]); // len 4
    const b2 = new Uint8Array(200).fill(9); // len 200 -> LEB128 c8 01
    const framed = Uint8Array.from([
      0xde, 0xad, // noise
      0x20, 0x20, 0x02,
      0x07, 0x04, ...b1,
      0x07, 0xc8, 0x01, ...b2,
      0xbe, 0xef, // trailing noise
    ]);
    const blobs = extractBlobs(framed);
    expect(blobs.length).toBe(2);
    expect([...blobs[0]!]).toEqual([1, 2, 3, 4]);
    expect(blobs[1]!.length).toBe(200);
  });
});
