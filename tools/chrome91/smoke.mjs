// Chromium 91 smoke test: serves a built dist/ folder, loads it in the exact
// Chromium milestone that Decaid's oldest tablets ship (91, via puppeteer 9),
// and fails on page errors, console errors or a missing readiness marker.
//
// usage: node smoke.mjs [--dist ../../dist] [--wait "<js expression>"]
//                       [--hash "#/"] [--name probe] [--timeout 20000]
//                       [--motion reduce]   (prefers-reduced-motion: reduce)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((acc, cur, i, all) => (cur.startsWith('--') ? [...acc, [cur.slice(2), all[i + 1]]] : acc), []),
);
const dist = path.resolve(here, args.dist ?? '../../dist');
const waitExpr = args.wait ?? 'window.__probe && window.__probe.checks && window.__probe.checks.ready';
const hash = args.hash ?? '';
const name = args.name ?? 'smoke';
const timeout = Number(args.timeout ?? 20000);
const outDir = path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = path.join(dist, decodeURIComponent(url.pathname));
  if (file.endsWith(path.sep) || url.pathname === '/') file = path.join(dist, 'index.html');
  if (!file.startsWith(dist) || !fs.existsSync(file)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const version = await browser.version();
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1.125, hasTouch: true });
if (args.motion === 'reduce') await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
});
page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

let ready = false;
let probe = null;
try {
  await page.goto(`http://127.0.0.1:${port}/${hash}`, { waitUntil: 'load', timeout });
  await page.waitForFunction(waitExpr, { timeout });
  ready = true;
} catch (e) {
  problems.push(`not ready: ${e.message}`);
}
await new Promise((r) => setTimeout(r, 1500));
try {
  probe = await page.evaluate(() => window.__probe ?? null);
} catch {
  /* ignore */
}
const shot = path.join(outDir, `${name}.png`);
await page.screenshot({ path: shot });
await browser.close();
server.close();

const report = { browser: version, url: `/${hash}`, ready, problems, probe, screenshot: shot };
console.log(JSON.stringify(report, null, 2));
process.exit(ready && problems.length === 0 && !(probe && probe.errors && probe.errors.length) ? 0 : 1);
