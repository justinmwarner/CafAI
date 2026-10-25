/**
 * The drinks' screens (D217, D221, D222) as live state, as the
 * temperature unit is (temperatureUnit.ts): each drink's scene and whether
 * its view goes back by itself, read by the drink's view and changed in
 * Settings > Drinks (each drink's On screen, D235), a change showing at once and saved with the
 * other settings, so it is mirrored to Decaid and exported like them.
 *
 * The scene stays the id that was chosen, or null for none: which ids a
 * drink has is the dial's to say (src/ui/drinks/scenes/catalog.ts), so a
 * newer build's scene survives here and reads as the default there.
 */
import { DRINK_SCREEN_KINDS } from '../storage/settings.ts';
import type { DrinkScreen, DrinkScreenKind, DrinkScreensSettings, SettingsRepository } from '../storage/types.ts';

/** Going back by itself until someone turns it off: on, after 10 s (the owner's answer, 2026-10-22). */
export const DEFAULT_GO_BACK = true;
export const DEFAULT_GO_BACK_SECONDS = 10;

export interface DrinkScreenChoice {
  /** The scene chosen, or null for the drink's default. */
  readonly scene: string | null;
  readonly goBack: boolean;
  readonly goBackSeconds: number;
}

export type DrinkScreenChoices = Readonly<Record<DrinkScreenKind, DrinkScreenChoice>>;

export interface DrinkScreensStore {
  get(): DrinkScreenChoices;
  subscribe(listener: () => void): () => void;
  /** Shows and saves one drink's change. A failed save rejects; the change stays on screen for this session and goes again with that drink's next one. */
  set(kind: DrinkScreenKind, change: Partial<DrinkScreen>): Promise<void>;
  /** Re-reads what was saved (after an import or a restore). */
  reload(): Promise<void>;
}

/** Every drink's screen, the defaults where nothing was chosen. */
export function resolveDrinkScreens(stored: DrinkScreensSettings | undefined): DrinkScreenChoices {
  const choices = {} as Record<DrinkScreenKind, DrinkScreenChoice>;
  for (const kind of DRINK_SCREEN_KINDS) {
    const screen = stored?.[kind];
    choices[kind] = {
      scene: screen?.scene ?? null,
      goBack: screen?.goBack ?? DEFAULT_GO_BACK,
      goBackSeconds: screen?.goBackSeconds ?? DEFAULT_GO_BACK_SECONDS,
    };
  }
  return choices;
}

const sameChoices = (a: DrinkScreenChoices, b: DrinkScreenChoices) =>
  DRINK_SCREEN_KINDS.every(
    (kind) => a[kind].scene === b[kind].scene && a[kind].goBack === b[kind].goBack && a[kind].goBackSeconds === b[kind].goBackSeconds,
  );

/** `initial`: what was saved, or nothing (every default). */
export function createDrinkScreensStore(settings: SettingsRepository, initial?: DrinkScreensSettings): DrinkScreensStore {
  let saved = resolveDrinkScreens(initial);
  /** Changes a save refused: kept on screen for the session, over whatever is saved later, and sent with their drink's next change. */
  const unsaved: DrinkScreensSettings = {};
  let current = saved;
  let latest = 0;
  const listeners = new Set<() => void>();
  const show = (next: DrinkScreenChoices) => {
    if (sameChoices(next, current)) return;
    current = next;
    for (const listener of [...listeners]) listener();
  };
  const withUnsaved = (choices: DrinkScreenChoices): DrinkScreenChoices => {
    const shown = { ...choices };
    for (const kind of DRINK_SCREEN_KINDS) shown[kind] = { ...choices[kind], ...unsaved[kind] };
    return shown;
  };
  return {
    get: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async set(kind, change) {
      const ticket = ++latest;
      show({ ...current, [kind]: { ...current[kind], ...change } });
      // A change of this drink that did not save goes again with this one, as a card's does (D234).
      const pending: Partial<DrinkScreen> = { ...unsaved[kind] };
      let result;
      try {
        result = await settings.update({ drinkScreens: { [kind]: { ...pending, ...change } } });
      } catch (error) {
        unsaved[kind] = { ...unsaved[kind], ...change };
        throw error;
      }
      // Saved now, as it was or under this change: no longer kept over storage, unless refused again while this one was out.
      const left = Object.entries(unsaved[kind] ?? {}).filter(([field, value]) => pending[field as keyof DrinkScreen] !== value);
      unsaved[kind] = Object.fromEntries(left);
      saved = resolveDrinkScreens(result.drinkScreens);
      // A later change may have been made while this one was saving: that one's save says what holds.
      if (ticket === latest) show(withUnsaved(saved));
    },
    async reload() {
      saved = resolveDrinkScreens((await settings.get()).drinkScreens);
      show(withUnsaved(saved));
    },
  };
}
