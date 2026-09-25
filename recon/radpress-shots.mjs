import { chromium } from 'playwright';
const BASE = 'https://quackstra.github.io/radpress-rml/';
const ALICE = 'account_tdx_2_12yk6sa3pd9zhk8geja39k5azcppeqxcn3yn7pcvq7zet67wchy2azl';
const dir = new URL('./radpress-screens/', import.meta.url).pathname;
import { mkdirSync } from 'node:fs';
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }).then((c) => c.newPage());
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: dir + name, fullPage: true }); console.log('shot', name); };

// Home: directory + latest posts
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.rp-dir-item', { timeout: 60000 });
await page.waitForSelector('.rp-postcard', { timeout: 60000 }).catch(() => console.log('(no postcards yet)'));
await shot('01-home.png');
console.log('home postcards:', await page.locator('.rp-postcard').count(), '| dir items:', await page.locator('.rp-dir-item').count());

// Alice themed site
await page.goto(`${BASE}#/s/${encodeURIComponent(ALICE)}`, { waitUntil: 'load' });
await page.waitForSelector('.rp-profile', { timeout: 60000 });
await shot('02-alice-site.png');
const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
console.log('alice site theme accent:', accent, '| posts:', await page.locator('.rp-postcard').count());

// Alice post + replies
await page.goto(`${BASE}#/s/${encodeURIComponent(ALICE)}/${encodeURIComponent('/posts/hello')}`, { waitUntil: 'load' });
await page.waitForSelector('.rp-content', { timeout: 60000 });
await page.waitForSelector('.rp-reply', { timeout: 60000 }).catch(() => console.log('(no replies rendered)'));
await shot('03-alice-post-replies.png');
console.log('replies shown:', await page.locator('.rp-reply').count());

// Composer
await page.goto(`${BASE}#/compose`, { waitUntil: 'load' });
await page.waitForSelector('.rp-ta', { timeout: 30000 });
await page.fill('.rp-ta', '# My first Radpress post\n\nComposed in the browser, previewed live, headed for the ledger.');
await page.fill('input.rp-in[placeholder="/posts/hello"]', '/posts/first');
await page.click('.rp-btn');
await page.waitForSelector('.rp-checkout', { timeout: 10000 });
await shot('04-compose.png');
console.log('checkout shown:', await page.locator('.rp-checkout').count());

console.log('console errors:', errors.length ? errors : 'none');
await browser.close();
