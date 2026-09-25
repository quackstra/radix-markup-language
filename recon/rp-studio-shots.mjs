import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = 'https://quackstra.github.io/radpress-rml/';
const dir = new URL('./radpress-screens/', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }).then((c) => c.newPage());
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const shot = async (n) => { await page.waitForTimeout(400); await page.screenshot({ path: dir + n, fullPage: true }); console.log('shot', n); };

await page.goto(BASE + '#/studio', { waitUntil: 'load' });
await page.waitForSelector('.rp-tab', { timeout: 30000 });
await shot('05-studio-account.png');

await page.locator('.rp-tab', { hasText: 'theme' }).click();
await page.waitForSelector('.rp-tokgrid', { timeout: 10000 });
await shot('06-studio-theme.png');

await page.locator('.rp-tab', { hasText: 'compose' }).click();
await page.waitForSelector('.rp-ta', { timeout: 10000 });
await page.fill('.rp-ta', '# Hello from the Studio\n\nType here, preview live, publish on-ledger.');
await shot('07-studio-compose.png');

console.log('console errors:', errors.length ? errors : 'none');
await browser.close();
