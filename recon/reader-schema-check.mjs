// Part A: a Radpress-published post (front-matter) renders cleanly in the reference
// reader — no raw JSON, title used as heading.
import { chromium } from 'playwright';
const READER = 'https://quackstra.github.io/radix-markup-language/';
const ALICE = 'account_tdx_2_12yk6sa3pd9zhk8geja39k5azcppeqxcn3yn7pcvq7zet67wchy2azl';
const browser = await chromium.launch();
const page = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }).then((c) => c.newPage());
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(`${READER}#/${encodeURIComponent(ALICE)}/posts/hello`, { waitUntil: 'load' });
await page.waitForSelector('.qd-content', { timeout: 60000 });
await page.waitForTimeout(500);
const contentText = (await page.locator('.qd-content').first().textContent()) || '';
const title = (await page.locator('.qd-page-title').first().textContent().catch(() => null));
const rawFrontMatter = contentText.includes('"type"') || contentText.includes('---');
await page.screenshot({ path: new URL('./radpress-screens/08-reader-schema.png', import.meta.url).pathname, fullPage: true });
await browser.close();

console.log('title heading:', JSON.stringify(title));
console.log('content shows raw front-matter JSON:', rawFrontMatter);
console.log('console errors:', errors.length ? errors : 'none');
const ok = title === 'Hello, ledger' && !rawFrontMatter;
console.log(ok ? '\nREADER SCHEMA-AWARE OK ✅' : '\nREADER SCHEMA-AWARE FAIL ❌');
if (!ok) process.exit(1);
