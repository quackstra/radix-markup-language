// End-to-end test of the Radpress Studio in-browser signer: generate a Stokenet
// key, fund from faucet, compose, and PUBLISH — all in a real browser — then verify
// the post landed on the ledger. Runs against the local preview build.
import { chromium } from 'playwright';
import { fetchSiteRecords, resolveSite, render, loadBody, fetchRawPayload, extractBlobs, parsePage, asPost } from '../package/dist/core/index.js';
import { nodeCrypto } from '../package/dist/node/env.js';

const BASE = 'http://localhost:4173/';
const browser = await chromium.launch();
const page = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }).then((c) => c.newPage());
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('dialog', (d) => d.accept()); // key-reveal + success alerts

await page.goto(BASE + '#/studio', { waitUntil: 'load' });
await page.waitForSelector('.rp-tab', { timeout: 20000 });

console.log('generating key (loads RET wasm)…');
await page.getByRole('button', { name: 'Generate a Stokenet key' }).click();
await page.waitForSelector('.rp-box', { timeout: 90000 }); // account address box appears
const account = (await page.locator('.rp-box').first().textContent()).trim();
console.log('account:', account);

console.log('funding from faucet…');
await page.getByRole('button', { name: /Fund from faucet/ }).click();
await page.waitForFunction(() => /[1-9]/.test(document.querySelector('.rp-idbal')?.textContent || ''), { timeout: 90000 });
console.log('balance:', await page.locator('.rp-idbal').textContent());

console.log('composing…');
await page.locator('.rp-tab', { hasText: 'compose' }).click();
await page.waitForSelector('.rp-ta');
await page.fill('input.rp-in[placeholder="/posts/hello"]', '/posts/studio');
await page.fill('.rp-ta', '# Made in the Studio\n\nGenerated a key, funded from the faucet, and published — all in the browser.');
await page.getByRole('button', { name: 'Add to cart' }).click();
await page.waitForSelector('.rp-checkout');

console.log('publishing (sign in-browser)…');
await page.getByRole('button', { name: /Publish now/ }).click();
await page.waitForFunction(() => /Cart \(0\)/.test(document.body.textContent || ''), { timeout: 120000 });
console.log('cart cleared after publish ✓');

await browser.close();

console.log('verifying on ledger…');
const { pages } = await resolveSite(await fetchSiteRecords(account), nodeCrypto);
const r = render(pages, '/posts/studio');
let body = null;
if (r.kind === 'page') body = r.content ?? await loadBody(r.op.body, extractBlobs(await fetchRawPayload(r.op.body.txId)), nodeCrypto);
const parsed = body ? parsePage(body) : null;
console.log('/posts/studio on ledger:', r.kind, '| type:', parsed?.type, '| body:', parsed ? '"' + parsed.body.slice(0, 40) + '…"' : '');
const ok = r.kind === 'page' && !!parsed && parsed.type === 'post' && parsed.body.startsWith('# Made in the Studio');
console.log('console errors:', errors.length ? errors : 'none');
console.log(ok ? '\nSTUDIO IN-BROWSER PUBLISH OK ✅' : '\nSTUDIO PUBLISH FAIL ❌');
if (!ok) process.exit(1);
