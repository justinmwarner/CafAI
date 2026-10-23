/**
 * A made-up run of a drink for the scenes' tests, shaped like the mockup's
 * and a DE1's: 1.5 s heating, then the drink at work (steam's pressure and
 * flow in a sawtooth), steam's purge, then done. One SceneInput every
 * sixtieth of a second, as SceneCanvas.tsx hands them out.
 */
import type { DrinkKind } from '../../kinds.ts';
import type { SceneInput, ScenePhase } from '../types.ts';

export interface RunShape {
  /** Seconds at work. */
  workS?: number;
  /** How hard it works throughout, 1 as set. */
  strength?: number;
  /** Its heat, 0-1.15. */
  heat?: number;
  /** Seconds after it is done. */
  afterS?: number;
}

export const FRAME_S = 1 / 60;

export function sceneRun(kind: DrinkKind, shape: RunShape = {}): SceneInput[] {
  const workS = shape.workS ?? 12;
  const afterS = shape.afterS ?? 4;
  const strength = shape.strength ?? 1;
  const heat = shape.heat ?? 1;
  const purgeS = kind === 'steam' ? 2.5 : 0;
  const total = 1.5 + workS + purgeS + afterS;
  const inputs: SceneInput[] = [];
  for (let t = 0; t < total; t += FRAME_S) {
    const u = t - 1.5;
    let phase: ScenePhase = 'done';
    if (t < 1.5) phase = 'heating';
    else if (u < workS) phase = 'working';
    else if (u < workS + purgeS) phase = 'purging';
    const working = phase === 'working';
    const progress = Math.min(1, Math.max(0, u / workS));
    const sawtooth = 1 + 0.15 * Math.sin(u * 1.7) + 0.05 * Math.sin(u * 5.3);
    inputs.push({
      kind,
      phase,
      live: phase === 'heating' || working || phase === 'purging',
      progress,
      strength: working ? Math.min(2.2, strength * sawtooth * Math.min(1, u / 1.2)) : 0,
      heat,
      warmth: kind === 'steam' ? progress : Math.min(1, heat),
    });
  }
  return inputs;
}
