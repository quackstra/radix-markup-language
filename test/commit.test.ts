import { describe, it, expect } from 'vitest';
import { buildCommit, type CommitBuildItem } from '../src/core/commit.js';
import { Op, Compression } from '../src/core/types.js';
import { sha256Sync } from '../src/node/env.js';

const enc = (s: string) => new TextEncoder().encode(s);
const pub = (path: string, body: string): CommitBuildItem => ({ op: Op.PUBLISH, path, bodyBytes: enc(body), contentHash: sha256Sync(enc(body)), compression: Compression.NONE });

describe('buildCommit blob dedupe (DuplicateBlob fix)', () => {
  it('two identical bodies -> one blob, both ops share the range', () => {
    const { blobs, subOps } = buildCommit([pub('/a', 'same body'), pub('/b', 'same body')]);
    expect(blobs.length).toBe(1);
    expect(subOps.map((o) => (o.op === Op.PUBLISH ? [o.blobStart, o.blobCount] : null))).toEqual([[0, 1], [0, 1]]);
  });

  it('two empty-body pages -> one (empty) blob, no duplicate', () => {
    const { blobs, subOps } = buildCommit([pub('/x', ''), pub('/y', '')]);
    expect(blobs.length).toBe(1);
    expect(blobs[0]!.length).toBe(0);
    expect(subOps.every((o) => o.op === Op.PUBLISH && o.blobStart === 0)).toBe(true);
  });

  it('distinct bodies -> distinct blobs', () => {
    const { blobs, subOps } = buildCommit([pub('/a', 'one'), pub('/b', 'two')]);
    expect(blobs.length).toBe(2);
    expect(subOps.map((o) => (o.op === Op.PUBLISH ? o.blobStart : -1))).toEqual([0, 1]);
  });

  it('mixed ops: delete/redirect carry no blobs', () => {
    const items: CommitBuildItem[] = [
      pub('/p', 'hi'),
      { op: Op.DELETE, path: '/gone' },
      { op: Op.REDIRECT, path: '/old', target: '/p' },
      pub('/q', 'hi'), // identical to /p -> shares blob
    ];
    const { blobs, subOps } = buildCommit(items);
    expect(blobs.length).toBe(1);
    expect(subOps.length).toBe(4);
    const pubs = subOps.filter((o) => o.op === Op.PUBLISH) as any[];
    expect(pubs[0].blobStart).toBe(0);
    expect(pubs[1].blobStart).toBe(0); // deduped to the same blob
  });
});
