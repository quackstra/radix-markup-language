// Verifies the reader's data + crypto path (Web Crypto + fzstd + fetch-only
// gateway) against a REAL Stokenet site — the account from scripts/acceptance.ts.
// No DOM: exercises gateway -> resolveSite(browserCrypto) -> markdown render.
import { fetchSiteRecords } from './src/gateway.js';
import { browserCrypto } from './src/browser-env.js';
import { makeRenderer } from './src/md.js';
import { resolveSite, render } from '../src/core/resolver.js';

const SITE = 'account_tdx_2_12925rep8cd554n78w9tnjqmagv2sdlzmzyadu9zkez9thuya85m0wu';

const records = await fetchSiteRecords(SITE);
const { pages } = await resolveSite(records, browserCrypto);
const md = makeRenderer(SITE);

console.log(`fetched ${records.length} record(s) via reader gateway`);
for (const path of [...pages.keys()].sort()) {
  console.log(`  ${path}: ${pages.get(path)!.state.status}`);
}

const about = render(pages, '/about');
const blog = render(pages, '/blog/first-post');
const oldRedir = render(pages, '/old');

console.log('\n/about render kind:', about.kind);
if (about.kind === 'page') console.log('  html:', md(about.content).slice(0, 80).replace(/\n/g, ' '), '…');
console.log('/blog/first-post kind:', blog.kind, blog.kind === 'page' ? `(${blog.content.length} chars, multi-chunk reassembled)` : '');
console.log('/old (redirect) resolves to kind:', oldRedir.kind, oldRedir.kind === 'page' ? oldRedir.content.slice(0, 20) : '');

const ok =
  about.kind === 'page' && about.content.startsWith('# About') && !about.content.includes('EVIL') &&
  blog.kind === 'page' && blog.content.length > 1500 &&
  oldRedir.kind === 'page' && oldRedir.content.startsWith('# About');
console.log(ok ? '\nREADER DATA PATH OK ✅ (browser crypto + fzstd match, forgery absent)' : '\nREADER DATA PATH FAIL ❌');
if (!ok) process.exit(1);
