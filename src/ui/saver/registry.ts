/**
 * Every screensaver, in the order Settings > Screensaver lists them
 * (D227): Nightstand first, the quiet one, then the canvas ones.
 */
import { beanfield } from './savers/beanfield.ts';
import { latte } from './savers/latte.ts';
import { lava } from './savers/lava.ts';
import { pipes } from './savers/pipes.ts';
import { portafilter } from './savers/portafilter.ts';
import { rain } from './savers/rain.ts';
import { steam } from './savers/steam.ts';
import type { CanvasSaver, SaverId } from './types.ts';

export const CANVAS_SAVERS: readonly CanvasSaver[] = [portafilter, pipes, beanfield, steam, lava, rain, latte];

export interface SaverChoice {
  id: SaverId;
  label: string;
  /** Nightstand is React text; the others draw on a canvas with this context. */
  context: 'text' | CanvasSaver['context'];
}

export const SAVERS: readonly SaverChoice[] = [
  { id: 'nightstand', label: 'Nightstand', context: 'text' },
  ...CANVAS_SAVERS.map(({ id, label, context }) => ({ id, label, context })),
];

export function isSaverId(value: unknown): value is SaverId {
  return typeof value === 'string' && SAVERS.some((saver) => saver.id === value);
}

/** The canvas screensaver with this id; undefined for Nightstand and for any id this build does not know. */
export function canvasSaver(id: string): CanvasSaver | undefined {
  return CANVAS_SAVERS.find((saver) => saver.id === id);
}
