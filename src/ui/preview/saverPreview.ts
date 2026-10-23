/**
 * Dev preview of one canvas screensaver on the whole window, for looking at
 * it, timing it and taking screenshots while building it. Never part of a
 * build (only dev/preview-saver.html loads it).
 *
 *   npx vite --port 5181 --strictPort
 *   http://localhost:5181/dev/preview-saver.html?saver=beanfield&seed=1
 *
 * saver:   an id from src/ui/saver/registry.ts (default: the first there)
 * seed:    the seed (default 1)
 * at:      milliseconds to step to, then that one frame, held
 * still=1: the screensaver's still, as under reduced motion
 * tint:    crema (default), matcha, cold-brew, blueberry, plum, cherry,
 *          tamper, or a hue 0-359
 * numbers: the last shot's numbers, comma-separated (default 9.0,36.4,28)
 * fps=1:   frames a second, and the average time a frame's step and draw take
 *
 * Once the asked-for frame is painted, <body> carries data-ready="1".
 */
import '../fonts.ts';
import { paletteFor } from '../appearance.ts';
import { CANVAS_SAVERS, canvasSaver } from '../saver/registry.ts';
import { backingScale, runSaver, sizeSaver, stepFor } from '../saver/runner.ts';
import type { SaverEnv, SaverInstance } from '../saver/types.ts';

const params = new URLSearchParams(window.location.search);
const saver = canvasSaver(params.get('saver') ?? '') ?? CANVAS_SAVERS[0]!;
const tintParam = params.get('tint') ?? 'crema';
const env: SaverEnv = {
  palette: paletteFor({ mode: 'dark', tint: /^\d+$/.test(tintParam) ? { hue: Number(tintParam) } : tintParam }, true),
  seed: Number(params.get('seed') ?? 1),
  numbers: (params.get('numbers') ?? '9.0,36.4,28').split(',').filter(Boolean),
};

const canvas = document.getElementById('saver') as HTMLCanvasElement;
const fpsLabel = document.getElementById('fps') as HTMLDivElement;
document.body.style.background = env.palette.background;
document.title = `${saver.label}: CafAI screensaver preview`;

/** With fps=1, the same screensaver with its frames timed. */
function timed(instance: SaverInstance): SaverInstance {
  if (params.get('fps') !== '1') return instance;
  fpsLabel.hidden = false;
  let spent = 0;
  let frames = 0;
  let since = performance.now();
  const measure = (work: () => void) => {
    const start = performance.now();
    work();
    spent += performance.now() - start;
  };
  return {
    ...instance,
    step: (dtMs) => measure(() => instance.step(dtMs)),
    draw: () => {
      measure(() => instance.draw());
      frames += 1;
      const now = performance.now();
      if (now - since >= 1000) {
        fpsLabel.textContent = `${frames} fps, ${(spent / frames).toFixed(2)} ms a frame`;
        spent = 0;
        frames = 0;
        since = now;
      }
    },
  };
}

async function start() {
  await document.fonts.ready;
  const created = saver.create(canvas, env);
  if (!created) {
    document.body.textContent = `${saver.label} could not get its ${saver.context} context here.`;
    return;
  }
  const instance = timed(created);
  const fit = () => sizeSaver(canvas, instance, window.innerWidth, window.innerHeight, backingScale(window.devicePixelRatio));
  fit();
  if (params.get('still') === '1') {
    instance.still();
  } else if (params.has('at')) {
    stepFor(instance, Number(params.get('at')));
    instance.draw();
  } else {
    window.addEventListener('resize', fit);
    runSaver(instance, {
      onError: (error) => {
        document.body.textContent = String(error);
      },
    });
  }
  document.body.dataset.ready = '1';
}

void start();
