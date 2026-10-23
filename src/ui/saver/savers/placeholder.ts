/**
 * A stand-in for a screensaver still being built: the page's colour and the
 * screensaver's name, drifting slowly, so the host can be seen running it.
 * Each savers/<id>.ts starts as one and is replaced by the real thing; this
 * file goes once none is left.
 */
import type { CanvasSaver, CanvasSaverId, SaverInstance } from '../types.ts';

export function placeholderSaver(id: CanvasSaverId, label: string): CanvasSaver {
  return {
    id,
    label,
    context: '2d',
    create(canvas, env) {
      const context = canvas.getContext('2d');
      if (!context) return null;
      let width = 0;
      let height = 0;
      let scale = 1;
      let elapsed = 0;
      const draw = () => {
        context.setTransform(scale, 0, 0, scale, 0, 0);
        context.fillStyle = env.palette.background;
        context.fillRect(0, 0, width, height);
        context.fillStyle = env.palette.inkMuted;
        context.font = '600 24px "Figtree", system-ui, sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(label, width / 2 + Math.sin(elapsed / 4000) * width * 0.2, height / 2);
      };
      const instance: SaverInstance = {
        step(dtMs) {
          elapsed += dtMs;
        },
        draw,
        resize(nextWidth, nextHeight, nextScale) {
          width = nextWidth;
          height = nextHeight;
          scale = nextScale;
        },
        still() {
          elapsed = 0;
          draw();
        },
        dispose() {},
      };
      return instance;
    },
  };
}
