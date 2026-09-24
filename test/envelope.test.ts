import { describe, it, expect } from 'vitest';
import { decode, encodeDelete, encodeRedirect, encodePublishChunks, normalizePath } from '../src/core/envelope.js';
import { Op, Compression, MAX_MESSAGE_BYTES, CHUNK_PAYLOAD_BYTES } from '../src/core/types.js';
import { snapshotId } from './helpers.js';

describe('path normalization', () => {
  it('adds leading slash, strips trailing, NFC', () => {
    expect(normalizePath('about')).toBe('/about');
    expect(normalizePath('/blog/')).toBe('/blog');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('/a/b/')).toBe('/a/b');
  });
  it('is case-sensitive', () => {
    expect(normalizePath('/About')).toBe('/About');
  });
});

describe('DELETE / REDIRECT round-trip', () => {
  it('delete', () => {
    const d = decode(encodeDelete('/about', 'gone'));
    expect(d.op).toBe(Op.DELETE);
    if (d.op === Op.DELETE) { expect(d.path).toBe('/about'); expect(d.note).toBe('gone'); }
  });
  it('redirect normalizes both paths', () => {
    const r = decode(encodeRedirect('old', 'new/', 'moved'));
    expect(r.op).toBe(Op.REDIRECT);
    if (r.op === Op.REDIRECT) {
      expect(r.path).toBe('/old');
      expect(r.target).toBe('/new');
      expect(r.note).toBe('moved');
    }
  });
});

describe('PUBLISH chunking', () => {
  it('single small chunk decodes head with metadata', () => {
    const chunks = encodePublishChunks(
      { path: '/x', snapshotId: snapshotId(9), contentHash: new Uint8Array(32).fill(7), compression: Compression.NONE },
      new TextEncoder().encode('hi'),
    );
    expect(chunks.length).toBe(1);
    const head = decode(chunks[0]!);
    expect(head.op).toBe(Op.PUBLISH);
    if (head.op === Op.PUBLISH) {
      expect(head.chunkIndex).toBe(0);
      expect(head.chunkCount).toBe(1);
      expect(head.path).toBe('/x');
      expect(head.compression).toBe(Compression.NONE);
    }
  });

  it('splits a large stream and body chunks carry no metadata', () => {
    const stream = new Uint8Array(CHUNK_PAYLOAD_BYTES * 3 + 10).map((_, i) => i & 0xff);
    const chunks = encodePublishChunks(
      { path: '/big', snapshotId: snapshotId(3), contentHash: new Uint8Array(32), compression: Compression.ZSTD },
      stream,
    );
    expect(chunks.length).toBe(4);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
    const body = decode(chunks[1]!);
    if (body.op === Op.PUBLISH) {
      expect(body.chunkIndex).toBe(1);
      expect(body.chunkCount).toBeUndefined();
      expect(body.contentHash).toBeUndefined();
    }
  });
});

describe('decode rejects garbage', () => {
  it('bad magic', () => expect(() => decode(Uint8Array.from([0, 0, 0, 1]))).toThrow(/magic/));
  it('unknown version', () => expect(() => decode(Uint8Array.from([0x51, 0x44, 0x09, 0x01]))).toThrow(/version/));
  it('unknown op', () => expect(() => decode(Uint8Array.from([0x51, 0x44, 0x00, 0x7f]))).toThrow(/op/));
});
