// Drive the built reader SPA in a headless browser at phone size (390×844)
// against the live Stokenet acceptance site, capturing each screen.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:4173/';
const SITE = 'account_tdx_2_12925rep8cd554n78w9tnjqmagv2sdlzmzyadu9zkez9thuya85m0wu';
const enc = encodeURIComponent(SITE);
const dir = new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }).then((c) => c.newPage());
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const shot = async (name) => { await page.screenshot({ path: dir + name, fullPage: true }); console.log('shot:', name); };
const contentReady = () => page.waitForSelector('.qd-content, .qd-notice, .qd-history', { timeout: 45000 });
const clickMode = async (label) => { await page.locator('.qd-mode', { hasText: label }).click(); await contentReady(); await page.waitForTimeout(300); };

// 1. Landing
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.qd-landing');
await page.fill('.qd-landing input', SITE);
await shot('01-landing.png');

// 2. /about clean (first load fetches the site; resolution is cached after)
await page.goto(BASE + '#/' + enc + '/about', { waitUntil: 'load' });
await contentReady();
await shot('02-about-clean.png');

// 3. /blog/first-post clean (multi-chunk page reassembled)
await page.goto(BASE + '#/' + enc + '/blog/first-post', { waitUntil: 'load' });
await contentReady();
await shot('03-blog-multichunk.png');

// 4. /old clean -> redirect followed to /about
await page.goto(BASE + '#/' + enc + '/old', { waitUntil: 'load' });
await contentReady();
await shot('04-old-redirect-followed.png');

// 5. /old in Redirects mode (don't follow; "Moved to" + old content)
await clickMode('Redirects');
await shot('05-old-redirects-mode.png');

// 6. /temp in Deletes mode (banner + state version)
await page.goto(BASE + '#/' + enc + '/temp', { waitUntil: 'load' });
await contentReady();
await clickMode('Deletes');
await shot('06-temp-deletes-mode.png');

// 7. /about in History mode, then open the snapshot
await page.goto(BASE + '#/' + enc + '/about', { waitUntil: 'load' });
await contentReady();
await clickMode('History');
await shot('07-about-history.png');
const snap = page.locator('.qd-snap-btn').first();
if (await snap.count()) { await snap.click(); await page.waitForTimeout(300); await shot('08-about-history-snapshot-open.png'); }

console.log('console errors:', errors.length ? errors : 'none');
await browser.close();
