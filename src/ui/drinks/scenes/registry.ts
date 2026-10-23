/**
 * Every drink's scenes by id (catalog.ts): what SceneCanvas.tsx makes for a
 * drink's view. An id the drink does not have makes the drink's default.
 */
import type { DrinkKind } from '../kinds.ts';
import { sceneFor } from './catalog.ts';
import { createScreen } from './flush/screen.ts';
import { createShower } from './flush/shower.ts';
import { createSimpleFlush } from './flush/simple.ts';
import { createAbove } from './hotWater/above.ts';
import { createPour } from './hotWater/pour.ts';
import { createSimpleHotWater } from './hotWater/simple.ts';
import { createRosetta } from './steam/rosetta.ts';
import { createSimpleSteam } from './steam/simple.ts';
import { createSpray } from './steam/spray.ts';
import { createWhirlpool } from './steam/whirlpool.ts';
import type { Scene, SceneFactory } from './types.ts';

export const FACTORIES: Readonly<Record<DrinkKind, Readonly<Record<string, SceneFactory>>>> = {
  steam: { spray: createSpray, whirlpool: createWhirlpool, rosetta: createRosetta, simple: createSimpleSteam },
  hotWater: { pour: createPour, above: createAbove, simple: createSimpleHotWater },
  flush: { shower: createShower, screen: createScreen, simple: createSimpleFlush },
};

/** A fresh scene for the drink: the one named, or the drink's default. */
export function createScene(kind: DrinkKind, id: string, random?: () => number): Scene {
  return FACTORIES[kind][sceneFor(kind, id)]!(random);
}
