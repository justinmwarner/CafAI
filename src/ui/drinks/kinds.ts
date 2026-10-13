/**
 * The drinks besides espresso that the machine row starts, Steam, Flush and
 * Hot water, and the machine states each one runs in (Decaid's names,
 * src/api/machineStates.ts). steamRinse follows steam (Decaid: "Cleaning
 * steam wand"), so it is part of steam's run, as Stop already sits in Steam's
 * place for it (MachineRow.tsx). An air purge, cleaning and descaling are no
 * drink: they have no view of their own.
 */
export type DrinkKind = 'steam' | 'hotWater' | 'flush';

/** In the machine row's order. */
export const DRINK_KINDS: readonly DrinkKind[] = ['steam', 'flush', 'hotWater'];

/** The drink a machine state belongs to, or null for anything else. */
export function drinkOfState(state: string | null | undefined): DrinkKind | null {
  switch (state) {
    case 'steam':
    case 'steamRinse':
      return 'steam';
    case 'hotWater':
      return 'hotWater';
    case 'flush':
      return 'flush';
    default:
      return null;
  }
}
