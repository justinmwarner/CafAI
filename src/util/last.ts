// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/domain/last.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: comment retargeted at the Chromium 91 WebView.

/**
 * The last element of an array.
 *
 * `Array.prototype.at(-1)` would be the obvious way, but it landed in Chrome
 * 92 and the oldest Decent tablets run a Chromium 91 WebView that cannot be
 * updated. Crema shipped three `.at(-1)` calls that threw there while every
 * Node test passed, so this stays a plain index.
 */
export function last<T>(values: readonly T[]): T | undefined {
  return values.length === 0 ? undefined : values[values.length - 1];
}
