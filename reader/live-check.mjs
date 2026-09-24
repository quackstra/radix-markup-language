// Smoke-test the DEPLOYED public site (GitHub Pages) end-to-end in a real browser.
import { chromium } from 'playwright';
const BASE = 'https://quackstra.github.io/radix-markup-language/';
const SITE = 'account_tdx_2_12925rep8cd554n78w9tnjqmagv2sdlzmzyadu9zkez9thuya85m0wu';

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }).then((c) => c.newPage());
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(BASE + '#/' + encodeURIComponent(SITE) + '/about', { waitUntil: 'load' });
await page.waitForSelector('.qd-content, .qd-notice', { timeout: 45000 });
const heading = await page.locator('.qd-content h1').first().textContent().catch(() => null);
await page.screenshot({ path: new URL('./screenshots/09-LIVE-pages-about.png', import.meta.url).pathname, fullPage: true });
console.log('live URL   :', BASE);
console.log('/about h1  :', heading);
console.log('console err:', errors.length ? errors : 'none');
await browser.close();
console.log(heading === 'About' ? 'LIVE SITE OK ✅' : 'LIVE SITE FAIL ❌');
if (heading !== 'About') process.exit(1);
