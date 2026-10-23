/**
 * Each drink's screen as the views and Settings read it (D-SCENE-1, D-BACK-1):
 * the scene resolved against what the drink offers (scenes/catalog.ts), and
 * going back by itself. Outside a ServicesProvider, or with no store (a
 * preview), every drink's default.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { resolveDrinkScreens, type DrinkScreenChoices, type DrinkScreensStore } from '../../app/drinkScreens.ts';
import { useOptionalServices } from '../../app/services.tsx';
import type { DrinkKind } from './kinds.ts';
import { sceneFor } from './scenes/catalog.ts';

export interface DrinkScreenView {
  /** A scene the drink has (catalog.ts). */
  readonly scene: string;
  readonly goBack: boolean;
  readonly goBackSeconds: number;
}

const DEFAULTS = resolveDrinkScreens(undefined);
const unchanging = () => () => undefined;
const defaults = () => DEFAULTS;

/** The store itself, to change a drink's screen; null in a preview. */
export function useDrinkScreensStore(): DrinkScreensStore | null {
  return useOptionalServices()?.drinkScreens ?? null;
}

/** Every drink's screen as chosen, a scene left as its id (or null for none chosen). */
export function useDrinkScreenChoices(): DrinkScreenChoices {
  const store = useDrinkScreensStore();
  return useSyncExternalStore(store?.subscribe ?? unchanging, store?.get ?? defaults);
}

/** One drink's screen, its scene one the drink has. */
export function useDrinkScreen(kind: DrinkKind): DrinkScreenView {
  const choice = useDrinkScreenChoices()[kind];
  return useMemo(
    () => ({ scene: sceneFor(kind, choice.scene), goBack: choice.goBack, goBackSeconds: choice.goBackSeconds }),
    [kind, choice],
  );
}
