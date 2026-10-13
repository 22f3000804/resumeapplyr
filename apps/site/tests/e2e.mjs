// Browser checks for the landing page: copy, signup flow, layout and accessibility.
// Run with `npm run test:e2e` (needs a Playwright Chromium: `npx playwright install chromium`).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { startServer } from './server.mjs';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const PAGES = ['index.html', 'hero-ticker.html', 'hero-poster.html', 'privacy.html'];
// Light-on-vermilion text is 3.75:1, under WCAG AA's 4.5:1. It comes from the Modernist tokens and
// is fixed in the design system, not here; every other axe rule must pass.
const KNOWN_AXE = new Set(['color-contrast']);
const failures = [];
const check = async (name, fn) => {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.log(`FAIL ${name}\n     ${e.message}`); }
};

const site = await startServer({ port: 0 });
const closedSite = await startServer({ port: 0, db: null });
const browser = await chromium.launch();

await check('no page still says Volley or quotes made-up numbers', async () => {
  const dir = new URL('../public/', import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(new URL(file, dir), 'utf8');
    assert.ok(!/volley/i.test(html), `${file} mentions Volley`);
    assert.ok(!/1,284|41 (job )?boards|fifteen minutes/i.test(html), `${file} still quotes an invented number`);
  }
});

for (const path of PAGES) {
  await check(`${path}: loads cleanly, no overflow 320–1440px, axe clean apart from known contrast`, async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.goto(`${site.url}/${path}`);
    assert.deepEqual(errors, []);
    for (const width of [320, 375, 768, 1080, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.equal(over, 0, `horizontal overflow of ${over}px at ${width}px`);
    }
    await page.addScriptTag({ content: AXE });
    const violations = await page.evaluate(async () => (await window.axe.run(document)).violations.map((v) => v.id));
    assert.deepEqual(violations.filter((id) => !KNOWN_AXE.has(id)), []);
    await page.close();
  });
}

await check('nav button keeps light text at rest and on hover', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${site.url}/index.html`);
  const color = () => page.$eval('.site-nav .btn-primary', (el) => getComputedStyle(el).color);
  assert.equal(await color(), 'rgb(243, 242, 242)');
  await page.hover('.site-nav .btn-primary');
  assert.equal(await color(), 'rgb(243, 242, 242)');
  await page.close();
});

await check('signup: bad address, then a good one that is stored', async () => {
  const page = await browser.newPage();
  await page.goto(`${site.url}/index.html`);
  const form = page.locator('form[data-source="hero"]');
  const status = page.locator('.hero .signup-status');
  await form.locator('input[type=email]').fill('nope');
  await form.locator('button').click();
  assert.match(await status.textContent(), /doesn’t look like an email/);
  await form.locator('input[type=email]').fill('Person@Example.com');
  await form.locator('button').click();
  await page.waitForFunction(() => document.querySelector('.hero .signup-status').dataset.state === 'ok');
  assert.match(await status.textContent(), /on the list/);
  assert.equal(site.db.rows.get('person@example.com')?.source, 'hero');
  await page.close();
});

await check('signup: honeypot fills are acknowledged but not stored', async () => {
  const page = await browser.newPage();
  await page.goto(`${site.url}/index.html`);
  const form = page.locator('form[data-source="footer"]');
  await form.locator('input[name=website]').evaluate((el) => { el.value = 'http://spam.example'; });
  await form.locator('input[type=email]').fill('bot@spam.example');
  await form.locator('button').click();
  await page.waitForFunction(() => document.querySelector('.cta .signup-status').dataset.state === 'ok');
  assert.equal(site.db.rows.has('bot@spam.example'), false);
  await page.close();
});

await check('signup: without a database the page says so', async () => {
  const page = await browser.newPage();
  await page.goto(`${closedSite.url}/index.html`);
  const form = page.locator('form[data-source="hero"]');
  await form.locator('input[type=email]').fill('a@b.co');
  await form.locator('button').click();
  await page.waitForFunction(() => document.querySelector('.hero .signup-status').dataset.state === 'error');
  assert.match(await page.locator('.hero .signup-status').textContent(), /aren’t switched on yet/);
  await page.close();
});

await check('signup: a network failure shows our own words, not the browser’s', async () => {
  const page = await browser.newPage();
  await page.route('**/api/signup', (route) => route.abort());
  await page.goto(`${site.url}/index.html`);
  const form = page.locator('form[data-source="hero"]');
  await form.locator('input[type=email]').fill('a@b.co');
  await form.locator('button').click();
  await page.waitForFunction(() => document.querySelector('.hero .signup-status').dataset.state === 'error');
  assert.match(await page.locator('.hero .signup-status').textContent(), /couldn’t reach the server/);
  await page.close();
});

await check('sample CV renders inside the slot, captioned as fictional', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${site.url}/index.html`);
  const box = await page.locator('.cv-page').boundingBox();
  assert.ok(box && box.width > 300, 'cv page too small');
  assert.match(await page.locator('.output-figure figcaption').textContent(), /fictional/);
  await page.close();
});

await check('unknown paths get the 404 page with a 404 status', async () => {
  const page = await browser.newPage();
  const res = await page.goto(`${site.url}/nope`);
  assert.equal(res.status(), 404);
  assert.match(await page.textContent('h1'), /isn’t here/);
  await page.close();
});

await browser.close();
site.server.close();
closedSite.server.close();
if (failures.length) { console.log(`\n${failures.length} check(s) failed`); process.exit(1); }
console.log('\nall browser checks passed');
