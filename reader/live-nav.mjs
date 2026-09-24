import { chromium } from 'playwright';
const BASE = 'https://quackstra.github.io/radix-markup-language/';
const QUACKDOWN = 'account_tdx_2_128v3pk3nv3xusnvretg0p4haddxa3vkltt80qlhj86dm0q6cv7jnya';
const browser = await chromium.launch();
const page = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }).then((c) => c.newPage());
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.qd-dir-list', { timeout: 60000 });
const dirCount = await page.locator('.qd-dir-item').count();

await page.goto(`${BASE}#/${encodeURIComponent(QUACKDOWN)}/about`, { waitUntil: 'load' });
await page.waitForSelector('.qd-content', { timeout: 60000 });
const navCount = await page.locator('.qd-nav-item').count();
const h1 = await page.locator('.qd-content h1').first().textContent();

console.log('LIVE directory sites:', dirCount, '| /about nav items:', navCount, '| /about h1:', h1, '| console errors:', errors.length ? errors : 'none');
await browser.close();
const ok = dirCount >= 6 && navCount === 4 && h1 === 'About';
console.log(ok ? 'LIVE NAV + CONTENT OK ✅' : 'LIVE CHECK FAIL ❌');
if (!ok) process.exit(1);
