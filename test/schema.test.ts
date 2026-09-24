import { describe, it, expect } from 'vitest';
import {
  parseFrontMatter, parsePage, serializePage, parseRef, formatRef, extractBlocks,
  asProfile, asPost, asReply, asFollows, asThemeRef, ObjectType,
} from '../src/core/schema.js';

describe('front-matter', () => {
  it('splits JSON front-matter from body', () => {
    const { meta, body } = parseFrontMatter('---\n{"type":"post","title":"Hi"}\n---\n# Hi\n\nbody');
    expect(meta.type).toBe('post');
    expect(body).toBe('# Hi\n\nbody');
  });
  it('no front-matter -> plain page, body untouched', () => {
    const { meta, body } = parseFrontMatter('# Just markdown\n\ntext');
    expect(meta).toEqual({});
    expect(body).toBe('# Just markdown\n\ntext');
    expect(parsePage('# Just markdown').type).toBe(ObjectType.PAGE);
  });
  it('invalid JSON front-matter is tolerated (treated as plain page)', () => {
    const { meta, body } = parseFrontMatter('---\n{not json}\n---\nbody');
    expect(meta).toEqual({});
    expect(body).toContain('body');
  });
  it('round-trips via serializePage', () => {
    const s = serializePage({ type: 'post', title: 'X' }, '# X');
    const p = parsePage(s);
    expect(p.type).toBe('post');
    expect(p.meta.title).toBe('X');
    expect(p.body).toBe('# X');
  });
});

describe('rdx refs', () => {
  it('parses and formats acct/tx/page', () => {
    expect(parseRef('rdx:acct:account_tdx_2_abc')).toEqual({ kind: 'acct', account: 'account_tdx_2_abc' });
    expect(parseRef('rdx:tx:txid_tdx_2_xyz')).toEqual({ kind: 'tx', tx: 'txid_tdx_2_xyz' });
    expect(parseRef('rdx:page:account_tdx_2_abc:/blog/post')).toEqual({ kind: 'page', account: 'account_tdx_2_abc', path: '/blog/post' });
    expect(formatRef({ kind: 'tx', tx: 'txid_1' })).toBe('rdx:tx:txid_1');
    expect(parseRef('http://evil')).toBeNull();
    expect(parseRef(42)).toBeNull();
  });
});

describe('typed core objects', () => {
  it('profile', () => {
    const p = parsePage(serializePage({ type: 'profile', name: 'Alice', theme: 'rdx:tx:txid_theme', links: [{ label: 'x', url: 'https://x' }, { bad: 1 }] }, 'about me'));
    const prof = asProfile(p)!;
    expect(prof.name).toBe('Alice');
    expect(prof.theme).toBe('rdx:tx:txid_theme');
    expect(prof.links).toEqual([{ label: 'x', url: 'https://x' }]); // malformed link dropped
    expect(prof.body).toBe('about me');
    expect(asPost(p)).toBeNull(); // wrong type
  });
  it('post', () => {
    const p = parsePage(serializePage({ type: 'post', title: 'Hello', tags: ['gm', 'radix'], published: '2026-09-24T00:00:00Z' }, '# Hello'));
    const post = asPost(p)!;
    expect(post.title).toBe('Hello');
    expect(post.tags).toEqual(['gm', 'radix']);
  });
  it('reply requires a tx ref target', () => {
    const ok = parsePage(serializePage({ type: 'reply', to: 'rdx:tx:txid_target' }, 'nice post'));
    expect(asReply(ok)!.to).toBe('rdx:tx:txid_target');
    const bad = parsePage(serializePage({ type: 'reply', to: 'rdx:acct:account_x' }, 'x'));
    expect(asReply(bad)).toBeNull(); // account ref is not a valid reply target
  });
  it('follows', () => {
    const p = parsePage(serializePage({ type: 'follows', accounts: ['account_a', 'account_b'] }, ''));
    expect(asFollows(p)!.accounts).toEqual(['account_a', 'account_b']);
    expect(asFollows(parsePage(serializePage({ type: 'follows' }, '')))).toBeNull();
  });
  it('theme-ref', () => {
    const p = parsePage(serializePage({ type: 'theme-ref', theme: 'rdx:tx:txid_theme' }, ''));
    expect(asThemeRef(p)!.theme).toBe('rdx:tx:txid_theme');
  });
  it('unknown type -> plain page, typed views return null', () => {
    const p = parsePage(serializePage({ type: 'radpress:megawidget', foo: 1 }, '# body'));
    expect(p.type).toBe('radpress:megawidget');
    expect(asProfile(p)).toBeNull();
    expect(asPost(p)).toBeNull();
    expect(p.body).toBe('# body'); // still renderable
  });
});

describe('extension blocks', () => {
  it('surfaces namespaced blocks and ignores prose', () => {
    const body = 'intro\n\n```quackdown:radpress:gallery\n{"images":["rdx:tx:a"]}\n```\n\nmore text';
    const blocks = extractBlocks(body);
    expect(blocks.length).toBe(1);
    expect(blocks[0]!.ns).toBe('radpress');
    expect(blocks[0]!.name).toBe('gallery');
    expect((blocks[0]!.data as any).images).toEqual(['rdx:tx:a']);
  });
});
