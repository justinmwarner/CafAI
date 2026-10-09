// The whole coach loop in a real Chromium 91 (puppeteer 9), against the
// mock-mode build: settings -> new bag (the chat opens with the live stats
// card, which the first message takes away) -> templates -> v1 -> Stats
// brings the card back -> scripted shot from Espresso in the top bar's
// machine row (it turns into Stop, the Shot view takes the screen, the coach
// comes back with the card) -> taste chip -> confirmed v2. Fails on any page
// error or console error.
//
// usage: npm run build:mock && node tools/chrome91/loop.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../../dist-mock');
const outDir = path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
};
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname;
  const file = path.join(dist, pathname === '/' ? 'index.html' : decodeURIComponent(pathname));
  if (!file.startsWith(dist) || !fs.existsSync(file)) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const version = await browser.version();
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1.125, hasTouch: true });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
});

const tid = (id) => `[data-testid="${id}"]`;
const steps = [];
async function step(name, fn) {
  const started = Date.now();
  await fn();
  steps.push(`${name} (${Date.now() - started} ms)`);
}
async function fill(testId, text) {
  await page.waitForSelector(tid(testId), { timeout: 15000 });
  const handle = await page.$(tid(testId));
  const tag = await handle.evaluate((el) => el.tagName.toLowerCase());
  const input = tag === 'input' || tag === 'textarea' ? handle : await handle.$('input, textarea');
  await input.click({ clickCount: 3 });
  await input.type(text);
}
// A tap lands only where the element itself takes it: for 350 ms after the
// app switches screens by itself a guard covers the main pane (TapGuard; the
// top bar is never covered) and swallows every tap. So wait until the
// element's centre, in view, is the element (or inside it) before tapping it.
async function tap(testId, timeout = 15000) {
  await tapAt(tid(testId), timeout);
}
async function tapAt(target, timeout = 15000) {
  const selector = `${target}:not([disabled])`;
  await page.waitForSelector(selector, { timeout, visible: true });
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        return false;
      }
      const hit = document.elementFromPoint(x, y);
      return hit !== null && el.contains(hit);
    },
    { timeout, polling: 'raf' },
    selector,
  );
  await page.click(selector);
}
async function waitText(testId, text, timeout = 30000) {
  await page.waitForFunction(
    (sel, expected) => document.querySelector(sel)?.textContent?.includes(expected),
    { timeout },
    tid(testId),
    text,
  );
}

let failed = null;
try {
  await step('open', async () => {
    await page.goto(`http://127.0.0.1:${server.address().port}/?mockSpeed=25#/settings`, { waitUntil: 'load' });
    await page.waitForSelector(tid('app-ready'), { timeout: 20000 });
  });
  await step('save API key', async () => {
    await fill('api-key-input', 'sk-ant-chrome91');
    await tap('api-key-save');
  });
  await step('new bag: the chat opens with the live stats card', async () => {
    await tap('nav-coach');
    await tap('new-bag');
    await page.waitForSelector(`${tid('chat')} ${tid('stats-card')}`, { timeout: 15000, visible: true });
    await waitText('machine-state', 'Ready');
  });
  await step('describe the bag: the card goes', async () => {
    await fill('composer-input', 'Kiambu AA, light roast, washed, blackcurrant');
    await tap('composer-send');
    await page.waitForSelector(tid('stats-card'), { timeout: 15000, hidden: true });
  });
  await step('pick a template', async () => tap('template-pick-blooming-espresso', 30000));
  await step('v1 loaded', async () => waitText('active-version', 'v1'));
  await step('Stats brings the card back', async () => {
    // Once the coach is done: anything that lands after the card takes it away again.
    await page.waitForSelector(`${tid('chat')}:not([data-busy])`, { timeout: 30000 });
    await tap('stats-prompt');
    await page.waitForSelector(`${tid('chat')} ${tid('stats-card')}`, { timeout: 15000, visible: true });
  });
  await step('pull the scripted shot from the top bar: Espresso turns into Stop, the Shot view takes the main pane', async () => {
    await tapAt(`${tid('machine-row')} ${tid('espresso-button')}`);
    await page.waitForSelector(`${tid('machine-row')} ${tid('stop-button')}`, { timeout: 15000 });
    await page.waitForSelector(tid('shot-view'), { timeout: 30000, visible: true });
  });
  // The coach stays mounted under the Shot view, hidden: its card is in the
  // page before it is on screen, and the coach comes back with it by itself.
  await step('the coach comes back with the shot card', async () => {
    await page.waitForSelector(tid('shot-card'), { timeout: 60000, visible: true });
    await page.waitForFunction(() => window.location.hash === '#/', { timeout: 15000 });
  });
  await step('tap a taste chip', async () => tap('option-sour-sharp', 30000));
  await step('confirm the change', async () => {
    await page.waitForSelector(tid('diff-card'), { timeout: 30000 });
    await tap('diff-confirm');
  });
  await step('v2 loaded', async () => waitText('active-version', 'v2'));
} catch (error) {
  failed = error.message;
}

await page.screenshot({ path: path.join(outDir, 'loop.png') });
await browser.close();
server.close();

const ok = !failed && problems.length === 0;
console.log(JSON.stringify({ browser: version, ok, steps, failed, problems }, null, 2));
process.exit(ok ? 0 : 1);
