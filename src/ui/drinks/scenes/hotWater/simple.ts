/**
 * Hot water: Simple, the stream and water of D149 (docs/superpowers/specs/2026-10-22-drink-scenes-design.md, section 4).
 * A blank scene until it is built.
 */
import { blankScene } from '../canvas.ts';
import type { SceneFactory } from '../types.ts';

export const createSimpleHotWater: SceneFactory = () => blankScene();
