// Dev tool: screenshots one frame of a screensaver from the dev preview
// (dev/preview-saver.html), with the vite dev server already running on --port
// (npx vite --port 5181 --strictPort). Screenshots go to the git-ignored .verify/.
//
// usage: node scripts/shoot-saver.mjs --port 5181 --saver beanfield [--seed 1] [--at 8000]
//          [--still 1] [--tint crema] [--numbers 9.0,36.4,28] [--fps 1 --wait 3000]
//          [--width 962 --height 602 --scale 1.33] [--out .verify/beanfield.png]
//
// --at plays to that millisecond (every frame stepped and drawn) and holds it; without it the animation runs,
// and --wait lets it run that long first (with --fps 1 it prints the frame timing).
import { chromium } from '@playwright/test';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, all) => (cur.startsWith('--') ? [...acc, [cur.slice(2), all[i + 1]]] : acc), []),
);
const query = new URLSearchParams();
for (const key of ['saver', 'seed', 'at', 'still', 'tint', 'numbers', 'fps']) if (args[key] !== undefined) query.set(key, args[key]);
const url = `http://127.0.0.1:${args.port ?? '5181'}/dev/preview-saver.html?${query}`;
const out = args.out ?? `.verify/${args.saver ?? 'saver'}.png`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Number(args.width ?? 962), height: Number(args.height ?? 602) },
  deviceScaleFactor: Number(args.scale ?? 1.33),
});
const problems = [];
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`);
});
await page.goto(url);
await page.waitForSelector('body[data-ready="1"]', { timeout: 20_000 });
if (args.wait) await page.waitForTimeout(Number(args.wait));
await page.screenshot({ path: out });
if (args.fps) console.log('timing:', await page.textContent('#fps'));
console.log(problems.length ? problems.join('\n') : 'no errors', '->', out);
await browser.close();
