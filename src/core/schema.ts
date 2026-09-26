// Quackdown core social schema (v1) — the composability contract. Tiny, versioned,
// extensible, isomorphic, dependency-free. The object TYPE and structured fields live
// in a JSON front-matter block at the top of the page body (see docs/quackdown-schema-v1.md).
import { NETWORKS, DEFAULT_NETWORK } from './config.js';

export const SCHEMA_VERSION = 1;

export const ObjectType = {
  PAGE: 'page', PROFILE: 'profile', POST: 'post', REPLY: 'reply',
  FOLLOWS: 'follows', THEME_REF: 'theme-ref', THEME: 'theme',
} as const;
export type ObjectTypeName = (typeof ObjectType)[keyof typeof ObjectType];

export interface FrontMatter { [key: string]: unknown; }
export interface ParsedPage { type: string; meta: FrontMatter; body: string; }

// ---- strict JSON: deterministic front-matter for the indexer ----
// Reject duplicate keys, non-finite numbers, and integers outside the JS safe range
// (silent precision loss). Returns null on any violation.
function hasDuplicateKeys(text: string): boolean {
  const stack: (Set<string> | null)[] = [];
  let expectKey = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '{') { stack.push(new Set()); expectKey = true; continue; }
    if (c === '[') { stack.push(null); expectKey = false; continue; }
    if (c === '}' || c === ']') { stack.pop(); expectKey = false; continue; }
    if (c === ':') { expectKey = false; continue; }
    if (c === ',') { expectKey = stack[stack.length - 1] instanceof Set; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < text.length) { if (text[j] === '\\') { j += 2; continue; } if (text[j] === '"') break; j++; }
      const raw = text.slice(i, j + 1);
      i = j;
      const top = stack[stack.length - 1];
      if (top instanceof Set && expectKey) {
        let key: string;
        try { key = JSON.parse(raw); } catch { return false; }
        if (top.has(key)) return true;
        top.add(key);
      }
    }
  }
  return false;
}

function numbersSafe(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v) && !(Number.isInteger(v) && Math.abs(v) > Number.MAX_SAFE_INTEGER);
  if (Array.isArray(v)) return v.every(numbersSafe);
  if (v && typeof v === 'object') return Object.values(v).every(numbersSafe);
  return true;
}

function strictJsonObject(text: string): FrontMatter | null {
  if (text.includes('�')) return null; // invalid UTF-8 replacement char
  if (hasDuplicateKeys(text)) return null;
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  if (!numbersSafe(v)) return null;
  return v as FrontMatter;
}

// Split a leading JSON front-matter block (`---` fences) from the body. Any violation
// of strict JSON => no front-matter (the page is treated as a plain page).
export function parseFrontMatter(content: string): { meta: FrontMatter; body: string } {
  const src = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  if (!/^---[ \t]*\r?\n/.test(src)) return { meta: {}, body: content };
  const end = src.indexOf('\n---', 4);
  if (end < 0) return { meta: {}, body: content };
  const fmText = src.slice(src.indexOf('\n') + 1, end);
  const afterFence = src.indexOf('\n', end + 1);
  const body = afterFence < 0 ? '' : src.slice(afterFence + 1);
  const meta = strictJsonObject(fmText);
  return meta ? { meta, body } : { meta: {}, body: content };
}

// A known core type with a malformed shape degrades to `page` (render body, skip typed handling).
function typeIsValid(type: string, meta: FrontMatter): boolean {
  if (type === ObjectType.REPLY) return parseRef(meta.to)?.kind === 'tx';
  if (type === ObjectType.FOLLOWS) return Array.isArray(meta.accounts) && (meta.accounts as unknown[]).every((s) => typeof s === 'string');
  if (type === ObjectType.THEME_REF) return typeof meta.theme === 'string';
  return true; // page / profile / post / theme / unknown (namespaced) pass through
}

export function parsePage(content: string): ParsedPage {
  const { meta, body } = parseFrontMatter(content);
  let type = typeof meta.type === 'string' ? meta.type : ObjectType.PAGE;
  if (!typeIsValid(type, meta)) type = ObjectType.PAGE;
  return { type, meta, body };
}

export function serializePage(meta: FrontMatter, body: string): string {
  return `---\n${JSON.stringify(meta)}\n---\n${body}`;
}

// ---- references: rdx:acct / rdx:tx(#op) / rdx:page ----
export type RdxRef =
  | { kind: 'acct'; account: string }
  | { kind: 'tx'; tx: string; opIndex: number } // op inside a COMMIT batch; bare hash = op 0
  | { kind: 'page'; account: string; path: string };

export function parseRef(s: unknown): RdxRef | null {
  if (typeof s !== 'string') return null;
  if (s.startsWith('rdx:acct:')) return { kind: 'acct', account: s.slice(9) };
  if (s.startsWith('rdx:tx:')) {
    const rest = s.slice(7);
    const hash = rest.indexOf('#');
    if (hash < 0) return { kind: 'tx', tx: rest, opIndex: 0 };
    const idx = Number(rest.slice(hash + 1));
    if (!Number.isInteger(idx) || idx < 0) return null;
    return { kind: 'tx', tx: rest.slice(0, hash), opIndex: idx };
  }
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
  if (ref.kind === 'tx') return ref.opIndex ? `rdx:tx:${ref.tx}#${ref.opIndex}` : `rdx:tx:${ref.tx}`;
  return `rdx:page:${ref.account}:${ref.path}`;
}

// Ref to a published op: a v1 op inside its transaction, or a v0 snapshot's final tx.
export function refForOp(txId: string, opIndex = 0): string {
  return formatRef({ kind: 'tx', tx: txId, opIndex });
}

// ---- typed views (return null if type/shape doesn't match) ----
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

export interface Reply { to: string; opIndex: number; title?: string; body: string; }
export function asReply(p: ParsedPage): Reply | null {
  if (p.type !== ObjectType.REPLY) return null;
  const ref = parseRef(p.meta.to);
  if (ref?.kind !== 'tx') return null;
  return { to: str(p.meta.to)!, opIndex: ref.opIndex, title: str(p.meta.title), body: p.body };
}

export interface Follows { accounts: string[]; }
export function asFollows(p: ParsedPage, network = DEFAULT_NETWORK): Follows | null {
  if (p.type !== ObjectType.FOLLOWS) return null;
  const raw = strArr(p.meta.accounts);
  if (!raw) return null;
  const prefix = NETWORKS[network]?.accountPrefix ?? 'account_';
  const accounts = raw.map((a) => (a.startsWith('rdx:acct:') ? a.slice(9) : a)).filter((a) => a.startsWith(prefix));
  return { accounts };
}

export interface ThemeRef { theme: string; }
export function asThemeRef(p: ParsedPage): ThemeRef | null {
  if (p.type !== ObjectType.THEME_REF) return null;
  const theme = str(p.meta.theme);
  return theme ? { theme } : null;
}

// ---- theme tokens: colors / lengths / allowlisted fonts only (no url(), no raw CSS) ----
const COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const LENGTH = /^-?(\d+|\d*\.\d+)(px|rem|em|%)$/;
const FONTS = new Set(['system-ui', 'sans-serif', 'serif', 'monospace', 'ui-monospace', 'ui-sans-serif', 'ui-serif']);
export function validateThemeTokens(tokens: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return out;
  for (const [k, v] of Object.entries(tokens)) {
    if (typeof v !== 'string') continue;
    if (COLOR.test(v) || LENGTH.test(v) || FONTS.has(v)) out[k] = v;
  }
  return out;
}

export interface Theme { name?: string; tokens: Record<string, string>; remixOf?: string; }
export function asTheme(p: ParsedPage): Theme | null {
  if (p.type !== ObjectType.THEME) return null;
  return { name: str(p.meta.name), tokens: validateThemeTokens(p.meta.tokens), remixOf: str(p.meta['remix-of']) };
}

// Namespaced render blocks: ```quackdown:<ns>:<name>\n<json>\n```
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
