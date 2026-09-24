// Quackdown core social schema (v1) — the composability contract. Deliberately
// tiny, versioned, and extensible. Isomorphic, dependency-free.
//
// Design: the object TYPE and its structured fields live in a JSON front-matter
// block at the TOP of the page body (not in the wire envelope), so the Quackdown
// *format* and the social *schema* stay separable — a fork can adopt or replace
// this schema without touching the envelope, and anyone can still write plain
// Quackdown with nothing but a transaction. Everything beyond the core keys is
// namespaced (e.g. `radpress:gallery`); readers IGNORE what they don't understand.

export const SCHEMA_VERSION = 1;

export const ObjectType = {
  PAGE: 'page',        // default: a plain page, no front-matter or unknown type
  PROFILE: 'profile',  // at "/"
  POST: 'post',
  REPLY: 'reply',
  FOLLOWS: 'follows',
  THEME_REF: 'theme-ref',
  THEME: 'theme',
} as const;
export type ObjectTypeName = (typeof ObjectType)[keyof typeof ObjectType];

export interface FrontMatter { [key: string]: unknown; }
export interface ParsedPage { type: string; meta: FrontMatter; body: string; }

// Split a leading JSON front-matter block delimited by `---` fences from the body.
// Tolerant: no/invalid front-matter -> empty meta, original content as body.
export function parseFrontMatter(content: string): { meta: FrontMatter; body: string } {
  const src = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  if (!/^---[ \t]*\r?\n/.test(src)) return { meta: {}, body: content };
  const end = src.indexOf('\n---', 4);
  if (end < 0) return { meta: {}, body: content };
  const fmText = src.slice(src.indexOf('\n') + 1, end);
  // body starts after the closing fence line
  const afterFence = src.indexOf('\n', end + 1);
  const body = afterFence < 0 ? '' : src.slice(afterFence + 1);
  try {
    const meta = JSON.parse(fmText);
    if (meta && typeof meta === 'object' && !Array.isArray(meta)) return { meta, body };
  } catch { /* fall through */ }
  return { meta: {}, body: content };
}

export function parsePage(content: string): ParsedPage {
  const { meta, body } = parseFrontMatter(content);
  const type = typeof meta.type === 'string' ? meta.type : ObjectType.PAGE;
  return { type, meta, body };
}

// Serialize front-matter + body (used by writers/tests).
export function serializePage(meta: FrontMatter, body: string): string {
  return `---\n${JSON.stringify(meta)}\n---\n${body}`;
}

// ---- references: rdx:acct / rdx:tx / rdx:page ----
export type RdxRef =
  | { kind: 'acct'; account: string }
  | { kind: 'tx'; tx: string }
  | { kind: 'page'; account: string; path: string };

export function parseRef(s: unknown): RdxRef | null {
  if (typeof s !== 'string') return null;
  if (s.startsWith('rdx:acct:')) return { kind: 'acct', account: s.slice(9) };
  if (s.startsWith('rdx:tx:')) return { kind: 'tx', tx: s.slice(7) };
  if (s.startsWith('rdx:page:')) {
    const rest = s.slice(9);
    const i = rest.indexOf(':/');
    if (i < 0) return null;
    return { kind: 'page', account: rest.slice(0, i), path: rest.slice(i + 1) };
  }
  return null;
}

export function formatRef(ref: RdxRef): string {
  if (ref.kind === 'acct') return `rdx:acct:${ref.account}`;
  if (ref.kind === 'tx') return `rdx:tx:${ref.tx}`;
  return `rdx:page:${ref.account}:${ref.path}`;
}

// ---- typed views of the core objects (return null if type/shape doesn't match) ----
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const strArr = (v: unknown): string[] | undefined => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : undefined);

export interface Profile { name?: string; bio?: string; avatar?: string; links?: { label: string; url: string }[]; theme?: string; body: string; }
export function asProfile(p: ParsedPage): Profile | null {
  if (p.type !== ObjectType.PROFILE) return null;
  const links = Array.isArray(p.meta.links)
    ? (p.meta.links as any[]).filter((l) => l && typeof l.label === 'string' && typeof l.url === 'string').map((l) => ({ label: l.label, url: l.url }))
    : undefined;
  return { name: str(p.meta.name), bio: str(p.meta.bio), avatar: str(p.meta.avatar), links, theme: str(p.meta.theme), body: p.body };
}

export interface Post { title?: string; published?: string; tags?: string[]; summary?: string; body: string; }
export function asPost(p: ParsedPage): Post | null {
  if (p.type !== ObjectType.POST) return null;
  return { title: str(p.meta.title), published: str(p.meta.published), tags: strArr(p.meta.tags), summary: str(p.meta.summary), body: p.body };
}

// A reply lives on the REPLIER's own site and references the target post's transaction.
export interface Reply { to: string; title?: string; body: string; }
export function asReply(p: ParsedPage): Reply | null {
  if (p.type !== ObjectType.REPLY) return null;
  const to = str(p.meta.to);
  if (!to || parseRef(to)?.kind !== 'tx') return null; // must reference a tx
  return { to, title: str(p.meta.title), body: p.body };
}

export interface Follows { accounts: string[]; }
export function asFollows(p: ParsedPage): Follows | null {
  if (p.type !== ObjectType.FOLLOWS) return null;
  const accounts = strArr(p.meta.accounts);
  if (!accounts) return null;
  return { accounts };
}

export interface ThemeRef { theme: string; }
export function asThemeRef(p: ParsedPage): ThemeRef | null {
  if (p.type !== ObjectType.THEME_REF) return null;
  const theme = str(p.meta.theme);
  return theme ? { theme } : null;
}

// Namespaced render blocks in a body: ```quackdown:<ns>:<name>\n<json>\n```
// Core doesn't render them (that's the client's job) — this just surfaces them so
// a reader can draw the ones it knows and ignore the rest.
export interface ExtensionBlock { ns: string; name: string; data: unknown; raw: string; }
export function extractBlocks(body: string): ExtensionBlock[] {
  const out: ExtensionBlock[] = [];
  const re = /```quackdown:([a-z0-9.]+):([a-z0-9-]+)[ \t]*\r?\n([\s\S]*?)\r?\n```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    let data: unknown = undefined;
    try { data = JSON.parse(m[3]!); } catch { /* leave undefined */ }
    out.push({ ns: m[1]!, name: m[2]!, data, raw: m[3]! });
  }
  return out;
}
