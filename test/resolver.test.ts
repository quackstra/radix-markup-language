import { describe, it, expect, beforeEach } from 'vitest';
import { resolveSite, render } from '../src/core/resolver.js';
import { nodeCrypto } from '../src/node/env.js';
import { encodePublishChunks } from '../src/core/envelope.js';
import { Compression } from '../src/core/types.js';
import { zstdCompress, sha256Sync } from '../src/node/env.js';
import { publishChunks, records, resetCounters, encodeDelete, encodeRedirect, snapshotId } from './helpers.js';

beforeEach(resetCounters);
const resolve = (recs: Parameters<typeof resolveSite>[0]) => resolveSite(recs, nodeCrypto);

describe('latest-wins by state version', () => {
  it('later publish replaces earlier, even if chunks arrive out of order', async () => {
    const v1 = publishChunks('/p', '# v1');
    const v2 = publishChunks('/p', '# v2');
    // interleave/scramble arrival order; state versions still assigned in push order
    const recs = records({ bytes: [v1[0]!] }, { bytes: [v2[0]!] });
    // scramble the array order to prove sorting is by stateVersion not array order
    recs.reverse();
    const { pages } = await resolve(recs);
    const page = pages.get('/p')!;
    expect(page.state.status).toBe('published');
    if (page.state.status === 'published') expect(page.state.content).toBe('# v2');
  });
});

describe('publish -> delete -> publish (restore)', () => {
  it('restores the page', async () => {
    const recs = records(
      { bytes: publishChunks('/a', 'first') },
      { bytes: [encodeDelete('/a', 'bye')] },
      { bytes: publishChunks('/a', 'back') },
    );
    const { pages } = await resolve(recs);
    const s = pages.get('/a')!.state;
    expect(s.status).toBe('published');
    if (s.status === 'published') expect(s.content).toBe('back');
    expect(pages.get('/a')!.history.length).toBe(3);
  });

  it('delete after publish leaves deleted', async () => {
    const recs = records({ bytes: publishChunks('/a', 'x') }, { bytes: [encodeDelete('/a')] });
    const s = (await resolve(recs)).pages.get('/a')!.state;
    expect(s.status).toBe('deleted');
  });
});

describe('redirects', () => {
  it('follows a chain within the limit', async () => {
    const recs = records(
      { bytes: publishChunks('/dest', 'here') },
      { bytes: [encodeRedirect('/b', '/mid')] },
      { bytes: [encodeRedirect('/mid', '/dest')] },
    );
    const { pages } = await resolve(recs);
    const r = render(pages, '/b');
    expect(r.kind).toBe('page');
    if (r.kind === 'page') expect(r.content).toBe('here');
  });

  it('detects a loop', async () => {
    const recs = records(
      { bytes: [encodeRedirect('/x', '/y')] },
      { bytes: [encodeRedirect('/y', '/x')] },
    );
    const r = render((await resolve(recs)).pages, '/x');
    expect(r.kind).toBe('redirect-loop');
  });

  it('over the hop limit reports a loop/limit', async () => {
    const groups = [];
    for (let i = 0; i < 8; i++) groups.push({ bytes: [encodeRedirect('/h' + i, '/h' + (i + 1))] });
    const r = render((await resolve(records(...groups))).pages, '/h0');
    expect(r.kind).toBe('redirect-loop');
  });

  it('redirect to a deleted path shows deleted', async () => {
    const recs = records(
      { bytes: publishChunks('/d', 'x') },
      { bytes: [encodeDelete('/d', 'removed')] },
      { bytes: [encodeRedirect('/r', '/d')] },
    );
    const r = render((await resolve(recs)).pages, '/r');
    expect(r.kind).toBe('deleted');
    if (r.kind === 'deleted') { expect(r.path).toBe('/d'); expect(r.note).toBe('removed'); }
  });

  it('redirect to a nonexistent path shows not-found naming the redirect', async () => {
    const recs = records({ bytes: [encodeRedirect('/r', '/nope')] });
    const r = render((await resolve(recs)).pages, '/r');
    expect(r.kind).toBe('not-found');
    if (r.kind === 'not-found') { expect(r.path).toBe('/nope'); expect(r.via).toBe('/r'); }
  });

  it('a DELETE on a redirected path removes the redirect', async () => {
    const recs = records(
      { bytes: [encodeRedirect('/r', '/somewhere')] },
      { bytes: [encodeDelete('/r')] },
    );
    const s = (await resolve(recs)).pages.get('/r')!.state;
    expect(s.status).toBe('deleted');
  });
});

describe('snapshot integrity', () => {
  it('incomplete snapshot is excluded from resolution but kept in history', async () => {
    const chunks = publishChunks('/big', 'z'.repeat(5000), { compression: Compression.NONE }); // force multi-chunk
    expect(chunks.length).toBeGreaterThan(1);
    const recs = records({ bytes: chunks.slice(0, chunks.length - 1) }); // drop last chunk
    const page = (await resolve(recs)).pages.get('/big')!;
    expect(page.state.status).toBe('nonexistent');
    expect(page.history[0]!.kind).toBe('publish');
    if (page.history[0]!.kind === 'publish') {
      expect(page.history[0]!.complete).toBe(false);
      expect(page.history[0]!.resolvable).toBe(false);
    }
  });

  it('hash-mismatch snapshot is excluded from resolution', async () => {
    // Build a publish whose content_hash does not match its payload.
    const raw = new TextEncoder().encode('honest');
    const chunks = encodePublishChunks(
      { path: '/h', snapshotId: snapshotId(42), contentHash: sha256Sync(new TextEncoder().encode('LIE')), compression: Compression.ZSTD },
      zstdCompress(raw),
    );
    const page = (await resolve(records({ bytes: chunks }))).pages.get('/h')!;
    expect(page.state.status).toBe('nonexistent');
    if (page.history[0]!.kind === 'publish') {
      expect(page.history[0]!.hashOk).toBe(false);
      expect(page.history[0]!.reason).toMatch(/mismatch/);
    }
  });

  it('an incomplete newer snapshot does not clobber an older complete one', async () => {
    const good = publishChunks('/p', 'good');
    const brokenChunks = publishChunks('/p', 'w'.repeat(5000), { compression: Compression.NONE });
    expect(brokenChunks.length).toBeGreaterThan(1);
    const recs = records({ bytes: good }, { bytes: brokenChunks.slice(0, 1) }); // only head of the big one
    const s = (await resolve(recs)).pages.get('/p')!.state;
    expect(s.status).toBe('published');
    if (s.status === 'published') expect(s.content).toBe('good');
  });
});

describe('auth boundary (owner call + committed)', () => {
  it('ignores a valid-looking envelope from a tx without an owner call', async () => {
    const recs = records({ bytes: publishChunks('/forged', 'evil'), ownerCall: false });
    expect((await resolve(recs)).pages.get('/forged')).toBeUndefined();
  });
  it('ignores a tx that did not commit successfully', async () => {
    const recs = records({ bytes: publishChunks('/f', 'x'), committedSuccess: false });
    expect((await resolve(recs)).pages.get('/f')).toBeUndefined();
  });
});

describe('garbage is silently dropped', () => {
  it('undecodable bytes do not throw and do not appear', async () => {
    const recs = records({ bytes: [Uint8Array.from([1, 2, 3, 4])] }, { bytes: publishChunks('/ok', 'fine') });
    const { pages } = await resolve(recs);
    expect(pages.get('/ok')!.state.status).toBe('published');
  });
});
