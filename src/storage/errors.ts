/**
 * Storage failures as sentences a barista can act on.
 *
 * IndexedDB reports DOMExceptions ("QuotaExceededError: ...") that mean
 * nothing at the espresso machine, and the engine shows error messages as they
 * are. The messages are fixed sentences: they never repeat the original error
 * text, which can quote stored data and so, in the worst case, the API key.
 * Only the DOMException name is kept, in `detail`, for diagnostics.
 */
/**
 * `superseded`: a newer CafAI in another window upgraded a database this page
 * had open, and closed this page's connection to it.
 * `newer`: a database could not be opened at all, because a newer CafAI saved
 * it (IndexedDB's VersionError: its version on disk is higher than this
 * CafAI's), so only that CafAI can read it.
 */
export type StorageErrorKind = 'unavailable' | 'quota' | 'superseded' | 'newer' | 'read' | 'write';

export const STORAGE_MESSAGES: Readonly<Record<StorageErrorKind, string>> = {
  unavailable: 'This browser blocked storage, so CafAI cannot save anything. Allow site data for this page, then reload.',
  quota: 'This device is out of storage space, so the change was not saved. Free up some space and try again.',
  superseded: 'A newer version of CafAI is open in another window. Reload this page to keep working.',
  newer: 'The data on this device was saved by a newer version of CafAI. Install that version again to keep using it.',
  read: 'Could not read the saved data on this device. Reload the page and try again.',
  write: 'Could not save to this device. Try again.',
};

export class StorageError extends Error {
  readonly kind: StorageErrorKind;
  /** The original error's name (e.g. "DataError"), never its message. */
  readonly detail: string | null;

  constructor(kind: StorageErrorKind, message: string = STORAGE_MESSAGES[kind], detail: string | null = null) {
    super(message);
    this.name = 'StorageError';
    this.kind = kind;
    this.detail = detail;
  }
}

function errorName(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string') return error.name;
  return null;
}

export function toStorageError(error: unknown, fallback: 'read' | 'write' | 'unavailable'): StorageError {
  if (error instanceof StorageError) return error;
  const name = errorName(error);
  if (name === 'QuotaExceededError') return new StorageError('quota', STORAGE_MESSAGES.quota, name);
  // Whichever database it comes from: CafAI's data, machine care's, the key's.
  if (name === 'VersionError') return new StorageError('newer', STORAGE_MESSAGES.newer, name);
  return new StorageError(fallback, STORAGE_MESSAGES[fallback], name);
}

/**
 * A StorageError that says why this CafAI cannot use a database at all, a
 * newer CafAI's (open in another window, or saved on this device): a store
 * with its own sentences passes it on as it is.
 */
export function isVersionError(error: unknown): error is StorageError {
  return error instanceof StorageError && (error.kind === 'superseded' || error.kind === 'newer');
}
