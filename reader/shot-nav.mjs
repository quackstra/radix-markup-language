import { chromium } from 'playwright';
const BASE = 'http://localhost:4173/';
const QUACKDOWN = 'account_tdx_2_128v3pk3nv3xusnvretg0p4haddxa3vkltt80qlhj86dm0q6cv7jnya';
const EARLY = 'account_tdx_2_129d7s4jzyhwqaqse7nmj7skhu83x5z5eafdteysyntnsea02ecxmx5';
const dir = new URL('./screenshots/', import.meta.url).pathname;

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }).then((c) => c.newPage());
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const go = async (acct, path, name, waitSel = '.qd-content') => {
  await page.goto(`${BASE}#/${encodeURIComponent(acct)}${path}`, { waitUntil: 'load' });
  await page.waitForSelector(waitSel, { timeout: 45000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: dir + name, fullPage: true });
  console.log('shot', name);
};

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.qd-dir-list', { timeout: 45000 });
console.log('directory entries:', await page.locator('.qd-dir-item').count());
await page.screenshot({ path: dir + '12-directory-seeded.png', fullPage: true });

await go(QUACKDOWN, '/about', '13-quackdown-about-nav.png');
console.log('nav items on /about:', await page.locator('.qd-nav-item').count());
await go(EARLY, '/gm', '14-early-gm.png');

console.log('console errors:', errors.length ? errors : 'none');
await browser.close();
