/**
 * Each drink's scenes, as Settings > Drink screens lists them (the design's
 * sections 4 and 6, D217): the default first and Simple, the drink's
 * scene before these (D149), last. An id is what storage keeps; a name is
 * what the barista reads.
 */
import type { DrinkKind } from '../kinds.ts';

export interface SceneChoice {
  readonly id: string;
  readonly name: string;
}

export const SCENES: Readonly<Record<DrinkKind, readonly SceneChoice[]>> = {
  steam: [
    { id: 'spray', name: 'Wand and spray' },
    { id: 'whirlpool', name: 'Whirlpool' },
    { id: 'rosetta', name: 'Rosetta' },
    { id: 'simple', name: 'Simple' },
  ],
  hotWater: [
    { id: 'pour', name: 'Pour' },
    { id: 'above', name: 'From above' },
    { id: 'simple', name: 'Simple' },
  ],
  flush: [
    { id: 'shower', name: 'Shower' },
    { id: 'screen', name: 'Screen' },
    { id: 'simple', name: 'Simple' },
  ],
};

/** The scene a drink draws until someone picks another. */
export function defaultScene(kind: DrinkKind): string {
  return SCENES[kind][0]!.id;
}

/** A scene the drink has, or its default for anything else (a newer build's choice, nothing chosen). */
export function sceneFor(kind: DrinkKind, id: unknown): string {
  return SCENES[kind].some((scene) => scene.id === id) ? (id as string) : defaultScene(kind);
}
