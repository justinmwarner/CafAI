/**
 * Whether the machine has a group-head controller, remembered across loads.
 *
 * The top bar's machine row depends on it (a GHC machine has no on-screen
 * start buttons), and waiting for GET /machine/info on every boot would draw the
 * wrong layout first and then correct it, which reads as a flicker (Crema's
 * lesson). It is a fact about the hardware, so a disconnect never clears it.
 */
export const GHC_CACHE_KEY = 'cafai.machine.ghc.v1';

type Readable = Pick<Storage, 'getItem'>;
type Writable = Pick<Storage, 'setItem'>;

function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function loadKnownGhc(storage: Readable | undefined = defaultStorage()): boolean | null {
  try {
    const raw = storage?.getItem(GHC_CACHE_KEY) ?? null;
    return raw === 'true' ? true : raw === 'false' ? false : null;
  } catch {
    return null;
  }
}

export function saveKnownGhc(hasGhc: boolean, storage: Writable | undefined = defaultStorage()): void {
  try {
    storage?.setItem(GHC_CACHE_KEY, hasGhc ? 'true' : 'false');
  } catch {
    // Not knowing next time only costs one relayout.
  }
}
