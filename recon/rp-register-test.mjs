// Verify the Studio "Add my site to the directory" button end-to-end.
import { chromium } from 'playwright';
import { fetchRegistryRecords, resolveRegistry } from '../package/dist/core/index.js';

const BASE = 'http://localhost:4173/';
const browser = await chromium.launch();
const page = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }).then((c) => c.newPage());
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('dialog', (d) => d.accept());

await page.goto(BASE + '#/studio', { waitUntil: 'load' });
await page.waitForSelector('.rp-tab', { timeout: 20000 });
console.log('generating key…');
await page.getByRole('button', { name: 'Generate a Stokenet key' }).click();
await page.waitForSelector('.rp-box', { timeout: 90000 });
const account = (await page.locator('.rp-box').first().textContent()).trim();
console.log('account:', account);

console.log('funding…');
await page.getByRole('button', { name: /Fund from faucet/ }).click();
await page.waitForFunction(() => /[1-9]/.test(document.querySelector('.rp-idbal')?.textContent || ''), { timeout: 90000 });

console.log('adding to directory…');
await page.fill('input.rp-in[placeholder="Display name for your site"]', 'My Studio Site');
await page.getByRole('button', { name: 'Add my site to the directory' }).click();
// wait for the busy indicator to clear (tx committed)
await page.waitForFunction(() => !document.querySelector('.rp-busy'), { timeout: 120000 });
await page.waitForTimeout(1000);
await browser.close();

console.log('verifying directory on-ledger…');
let found = false;
for (let i = 0; i < 8 && !found; i++) {
  const entries = resolveRegistry(await fetchRegistryRecords());
  found = entries.some((e) => e.account === account && e.title === 'My Studio Site');
  if (!found) await new Promise((r) => setTimeout(r, 3000));
}
console.log('console errors:', errors.length ? errors : 'none');
console.log(found ? '\nADD-TO-DIRECTORY OK ✅' : '\nADD-TO-DIRECTORY FAIL ❌');
if (!found) process.exit(1);
