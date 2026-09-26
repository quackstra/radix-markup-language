import { fetchSiteRecords, fetchRegistryRecords, fetchRawPayload } from './gateway.js';
import { browserCrypto } from './browser-env.js';
import { makeRenderer } from './md.js';
import { resolveSite, render, loadBody, type ResolvedPage, type PublishOp } from '../../src/core/resolver.js';
import { resolveRegistry, type RegistryEntry } from '../../src/core/registry.js';
import { extractBlobs } from '../../src/core/sbor.js';
import { normalizePath } from '../../src/core/envelope.js';
import { parsePage, asPost, asProfile } from '../../src/core/schema.js';

type Mode = 'clean' | 'deletes' | 'redirects' | 'history';
const MODES: { id: Mode; label: string }[] = [
  { id: 'clean', label: 'Clean' },
  { id: 'deletes', label: 'Deletes' },
  { id: 'redirects', label: 'Redirects' },
  { id: 'history', label: 'History' },
];

const app = document.getElementById('app')!;
const cache = new Map<string, Map<string, ResolvedPage>>();
let openSnapshot: string | null = null;

const getMode = (): Mode => (localStorage.getItem('qd-mode') as Mode) || 'clean';
const setMode = (m: Mode) => { localStorage.setItem('qd-mode', m); route(); };

function parseHash(): { site?: string; path: string } {
  const h = location.hash.replace(/^#\/?/, '');
  if (!h) return { path: '/' };
  const slash = h.indexOf('/');
  if (slash < 0) return { site: decodeURIComponent(h), path: '/' };
  return { site: decodeURIComponent(h.slice(0, slash)), path: normalizePath(h.slice(slash)) };
}

function el(tag: string, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const k of kids) e.append(k);
  return e;
}

async function landing() {
  openSnapshot = null;
  const form = el('form', { class: 'qd-landing' });
  const input = el('input', { type: 'text', placeholder: 'account_tdx_2_… (site address)', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const btn = el('button', { type: 'submit' }, 'Open site');
  form.append(el('h1', {}, '🦆 Quackdown'), el('p', { class: 'muted' }, 'A website that lives on the Radix ledger.'), input, btn);
  form.addEventListener('submit', (e) => { e.preventDefault(); const v = input.value.trim(); if (v) location.hash = `#/${encodeURIComponent(v)}/`; });

  const dir = el('section', { class: 'qd-dir' }, el('h2', {}, 'Directory'), el('p', { class: 'muted qd-dir-loading' }, 'Loading registered sites…'));
  app.replaceChildren(form, dir);

  try {
    const entries = resolveRegistry(await fetchRegistryRecords());
    renderDirectory(dir, entries);
  } catch {
    dir.querySelector('.qd-dir-loading')!.textContent = 'Could not load the directory.';
  }
}

function renderDirectory(dir: HTMLElement, entries: RegistryEntry[]) {
  dir.replaceChildren(el('h2', {}, `Directory (${entries.length})`));
  if (!entries.length) {
    dir.append(el('p', { class: 'muted' }, 'No sites registered yet. Be the first: qd register --title "My Site".'));
    return;
  }
  const list = el('ul', { class: 'qd-dir-list' });
  for (const e of entries) {
    const a = el('a', { href: `#/${encodeURIComponent(e.account)}/`, class: 'qd-dir-item' });
    a.append(el('div', { class: 'qd-dir-title' }, e.title || '(untitled site)'));
    a.append(el('div', { class: 'qd-dir-acct' }, e.account.slice(0, 24) + '…' + e.account.slice(-6)));
    list.append(el('li', {}, a));
  }
  dir.append(list);
}

function chrome(site: string, path: string): { header: HTMLElement; main: HTMLElement } {
  const mode = getMode();
  const modeBar = el('div', { class: 'qd-modes', role: 'tablist' });
  for (const m of MODES) {
    const b = el('button', { class: 'qd-mode' + (m.id === mode ? ' active' : '') }, m.label);
    b.addEventListener('click', () => setMode(m.id));
    modeBar.append(b);
  }
  const header = el('header', { class: 'qd-header' },
    el('a', { href: '#/', class: 'qd-home' }, '🦆'),
    el('div', { class: 'qd-crumbs' },
      el('div', { class: 'qd-site', title: site }, site.slice(0, 18) + '…' + site.slice(-6)),
      el('div', { class: 'qd-path' }, path)),
    modeBar);
  const main = el('main', { class: 'qd-main' });
  return { header, main };
}

function notice(kind: string, title: string, body?: string): HTMLElement {
  const box = el('div', { class: `qd-notice qd-${kind}` }, el('strong', {}, title));
  if (body) box.append(el('p', {}, body));
  return box;
}

function lastPublished(page: ResolvedPage): PublishOp | undefined {
  return [...page.history].reverse().find((o): o is PublishOp => o.kind === 'publish' && o.resolvable);
}

// A nav strip of the site's published pages (root first, then alphabetical).
function renderNav(site: string, pages: Map<string, ResolvedPage>, currentPath: string): HTMLElement | null {
  const paths = [...pages.entries()]
    .filter(([, p]) => p.state.status === 'published')
    .map(([path]) => path)
    .sort((a, b) => (a === '/' ? -1 : b === '/' ? 1 : a.localeCompare(b)));
  if (paths.length < 2) return null; // nothing to navigate to
  const nav = el('nav', { class: 'qd-nav' }, el('div', { class: 'qd-nav-label' }, 'Pages'));
  const list = el('div', { class: 'qd-nav-list' });
  for (const path of paths) {
    const a = el('a', {
      href: `#/${encodeURIComponent(site)}${path}`,
      class: 'qd-nav-item' + (path === currentPath ? ' active' : ''),
    }, path === '/' ? 'home' : path);
    list.append(a);
  }
  nav.append(list);
  return nav;
}

// Schema-aware: strip the front-matter block, use title/name as the heading, and
// render only the body. Unknown types just render as a plain page (their body).
function renderContent(main: HTMLElement, site: string, rawContent: string) {
  const p = parsePage(rawContent);
  const heading = asPost(p)?.title ?? asProfile(p)?.name;
  if (heading) main.append(el('h1', { class: 'qd-page-title' }, heading));
  const article = el('article', { class: 'qd-content' });
  article.innerHTML = makeRenderer(site)(p.body); // html:false -> content cannot inject scripts
  main.append(article);
}

// Get a publish op's markdown: v0 inline, or v1 by fetching raw_hex, extracting
// blobs, and verifying against content_hash. Cached by content_hash.
const bodyCache = new Map<string, string>();
async function materialize(op: PublishOp): Promise<string | null> {
  if (op.content != null) return op.content; // v0
  if (!op.body) return null;
  if (bodyCache.has(op.contentHash)) return bodyCache.get(op.contentHash)!;
  try {
    const blobs = extractBlobs(await fetchRawPayload(op.body.txId));
    const content = await loadBody(op.body, blobs, browserCrypto);
    if (content != null) bodyCache.set(op.contentHash, content);
    return content;
  } catch { return null; }
}

async function view(site: string, path: string) {
  app.replaceChildren(el('div', { class: 'qd-loading' }, 'Loading from the ledger…'));
  let pages = cache.get(site);
  if (!pages) {
    try {
      const records = await fetchSiteRecords(site);
      pages = (await resolveSite(records, browserCrypto)).pages;
      cache.set(site, pages);
    } catch (e) {
      app.replaceChildren(notice('error', 'Could not load site', (e as Error).message));
      return;
    }
  }
  const { header, main } = chrome(site, path);
  const mode = getMode();
  const page = pages.get(path);

  const nav = renderNav(site, pages, path);
  if (nav) main.append(nav);

  if (mode === 'history') {
    await renderHistory(main, site, path, page);
  } else if (mode === 'redirects') {
    const state = page?.state;
    if (state?.status === 'redirected') {
      main.append(notice('redirect', `Moved to ${state.target}`, state.note));
      const lp = lastPublished(page!);
      if (lp) { const c = await materialize(lp); if (c) renderContent(main, site, c); }
    } else await renderResolved(main, site, path, pages);
  } else if (mode === 'deletes') {
    const state = page?.state;
    if (state?.status === 'deleted') {
      main.append(notice('deleted', 'This page was deleted', `at ledger state version ${state.stateVersion}${state.note ? ` — ${state.note}` : ''}`));
    } else await renderResolved(main, site, path, pages);
  } else {
    await renderResolved(main, site, path, pages);
  }

  app.replaceChildren(header, main);
}

async function renderResolved(main: HTMLElement, site: string, path: string, pages: Map<string, ResolvedPage>) {
  const r = render(pages, path);
  switch (r.kind) {
    case 'page': {
      const content = await materialize(r.op);
      if (content == null) main.append(notice('error', 'Content unavailable', 'The page body is missing or failed its integrity check.'));
      else renderContent(main, site, content);
      return;
    }
    case 'deleted': return void main.append(notice('deleted', 'This page was deleted', r.note));
    case 'not-found': return void main.append(notice('notfound', 'Not found', r.via ? `Redirect from ${r.via} points to a page that never existed.` : `No page at ${r.path}.`));
    case 'redirect-loop': return void main.append(notice('error', 'Redirect loop', r.chain.join(' → ')));
  }
}

function snapKey(op: PublishOp): string { return op.snapshotId ?? `${op.txId}#${op.opIndex}`; }

async function renderHistory(main: HTMLElement, site: string, path: string, page?: ResolvedPage) {
  if (!page || !page.history.length) { main.append(notice('notfound', 'No history', `Nothing has been published at ${path}.`)); return; }
  const list = el('ol', { class: 'qd-history' });
  for (const op of page.history) {
    const row = el('li', { class: 'qd-op qd-op-' + op.kind });
    if (op.kind === 'publish') {
      const status = op.resolvable ? 'ok' : `excluded — ${op.reason}`;
      const carrier = op.body ? `blob×${op.body.blobCount}` : `${op.presentChunks}/${op.chunkCount} chunks`;
      row.append(el('div', { class: 'qd-op-h' }, `v${op.stateVersion} · publish · ${carrier} · ${status}`));
      if (op.note) row.append(el('div', { class: 'qd-op-note' }, op.note));
      if (op.resolvable) {
        const key = snapKey(op);
        const open = openSnapshot === key;
        const btn = el('button', { class: 'qd-snap-btn' }, open ? 'Hide snapshot' : 'Open snapshot');
        btn.addEventListener('click', () => { openSnapshot = open ? null : key; route(); });
        row.append(btn);
        if (open) { const content = await materialize(op); if (content != null) { const c = el('div', {}); renderContent(c, site, content); row.append(c); } }
      }
    } else if (op.kind === 'delete') {
      row.append(el('div', { class: 'qd-op-h' }, `v${op.stateVersion} · delete`));
      if (op.note) row.append(el('div', { class: 'qd-op-note' }, op.note));
    } else {
      row.append(el('div', { class: 'qd-op-h' }, `v${op.stateVersion} · redirect → ${op.target}`));
      if (op.note) row.append(el('div', { class: 'qd-op-note' }, op.note));
    }
    list.append(row);
  }
  main.append(list);
}

function route() {
  const { site, path } = parseHash();
  if (!site) { landing(); return; }
  view(site, path);
}

window.addEventListener('hashchange', route);
route();
