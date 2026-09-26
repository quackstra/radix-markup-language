import { describe, it, expect } from 'vitest';
import {
  parseFrontMatter, parsePage, serializePage, parseRef, formatRef, refForOp, extractBlocks,
  asProfile, asPost, asReply, asFollows, asThemeRef, asTheme, validateThemeTokens, ObjectType,
} from '../src/core/schema.js';

const A_TDX = 'account_tdx_2_12yk6sa3pd9zhk8geja39k5azcppeqxcn3yn7pcvq7zet67wchy2azl';
const B_TDX = 'account_tdx_2_128w3neufp3dd5gwlg6h0tps6gf24wyq35fr3cdyh6lapc9qnlgf6en';

describe('front-matter (strict)', () => {
  it('splits JSON front-matter from body', () => {
    const { meta, body } = parseFrontMatter('---\n{"type":"post","title":"Hi"}\n---\n# Hi');
    expect(meta.type).toBe('post');
    expect(body).toBe('# Hi');
  });
  it('no front-matter -> plain page', () => {
    expect(parsePage('# Just markdown').type).toBe(ObjectType.PAGE);
  });
  it('invalid JSON -> plain page', () => {
    expect(parsePage('---\n{not json}\n---\nbody').type).toBe(ObjectType.PAGE);
  });
  it('duplicate keys -> rejected (plain page)', () => {
    const p = parsePage('---\n{"type":"post","type":"profile"}\n---\nx');
    expect(p.type).toBe(ObjectType.PAGE);
    expect(p.meta).toEqual({});
  });
  it('unsafe integer -> rejected', () => {
    expect(parsePage('---\n{"type":"post","n":123456789012345678901234}\n---\nx').type).toBe(ObjectType.PAGE);
  });
  it('floats are allowed (for namespaced extensions)', () => {
    const p = parsePage('---\n{"type":"post","x.universe:confidence":0.87}\n---\nx');
    expect(p.type).toBe('post');
    expect(p.meta['x.universe:confidence']).toBe(0.87);
  });
});

describe('rdx refs with batch op index', () => {
  it('bare tx ref = op 0', () => expect(parseRef('rdx:tx:txid_1')).toEqual({ kind: 'tx', tx: 'txid_1', opIndex: 0 }));
  it('tx#n ref', () => expect(parseRef('rdx:tx:txid_1#3')).toEqual({ kind: 'tx', tx: 'txid_1', opIndex: 3 }));
  it('formatRef round-trips op index', () => {
    expect(formatRef({ kind: 'tx', tx: 't', opIndex: 0 })).toBe('rdx:tx:t');
    expect(formatRef({ kind: 'tx', tx: 't', opIndex: 2 })).toBe('rdx:tx:t#2');
    expect(refForOp('t', 1)).toBe('rdx:tx:t#1');
  });
  it('page + acct refs', () => {
    expect(parseRef(`rdx:page:${A_TDX}:/blog`)).toEqual({ kind: 'page', account: A_TDX, path: '/blog' });
    expect(parseRef(`rdx:acct:${A_TDX}`)).toEqual({ kind: 'acct', account: A_TDX });
    expect(parseRef('rdx:tx:t#-1')).toBeNull();
  });
});

describe('typed objects', () => {
  it('post + profile', () => {
    expect(asPost(parsePage(serializePage({ type: 'post', title: 'Hello', tags: ['gm'] }, '# Hi')))!.title).toBe('Hello');
    expect(asProfile(parsePage(serializePage({ type: 'profile', name: 'Alice' }, 'bio')))!.name).toBe('Alice');
  });
  it('reply requires a tx ref, carries opIndex; invalid degrades to page', () => {
    const ok = parsePage(serializePage({ type: 'reply', to: 'rdx:tx:txid_x#2' }, 'nice'));
    expect(ok.type).toBe('reply');
    expect(asReply(ok)).toMatchObject({ to: 'rdx:tx:txid_x#2', opIndex: 2 });
    const bad = parsePage(serializePage({ type: 'reply', to: `rdx:acct:${A_TDX}` }, 'x'));
    expect(bad.type).toBe(ObjectType.PAGE); // degraded
  });
  it('follows drops wrong-network / garbage addresses', () => {
    const p = parsePage(serializePage({ type: 'follows', accounts: [A_TDX, 'account_rdx1abc', 'garbage', `rdx:acct:${B_TDX}`] }, ''));
    expect(asFollows(p)!.accounts).toEqual([A_TDX, B_TDX]);
  });
  it('theme-ref', () => {
    expect(asThemeRef(parsePage(serializePage({ type: 'theme-ref', theme: 'rdx:tx:t' }, '')))!.theme).toBe('rdx:tx:t');
  });
});

describe('theme tokens', () => {
  it('keeps colors/lengths/fonts, drops url() and raw css', () => {
    const t = validateThemeTokens({ bg: '#0f1216', accent: '#48d597aa', pad: '12px', scale: '1.5rem', font: 'monospace', evil: 'url(http://x)', js: 'expression(1)', num: 5 });
    expect(t).toEqual({ bg: '#0f1216', accent: '#48d597aa', pad: '12px', scale: '1.5rem', font: 'monospace' });
  });
  it('asTheme validates tokens + remix-of', () => {
    const th = asTheme(parsePage(serializePage({ type: 'theme', name: 'Pond', tokens: { bg: '#000', evil: 'url(x)' }, 'remix-of': 'rdx:tx:parent' }, '')))!;
    expect(th.name).toBe('Pond');
    expect(th.tokens).toEqual({ bg: '#000' });
    expect(th.remixOf).toBe('rdx:tx:parent');
  });
});

describe('extension blocks', () => {
  it('surfaces namespaced blocks', () => {
    const b = extractBlocks('x\n\n```quackdown:radpress:gallery\n{"images":["rdx:tx:a"]}\n```\n');
    expect(b[0]).toMatchObject({ ns: 'radpress', name: 'gallery' });
    expect((b[0]!.data as any).images).toEqual(['rdx:tx:a']);
  });
});
