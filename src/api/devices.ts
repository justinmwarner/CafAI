// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/gateway/devices.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: typed against src/api/types.ts DeviceEntry.
/**
 * Reading Decaid's device list.
 */
import type { DeviceEntry } from './types.ts';

/**
 * Why a connect attempt found nothing, in the words that name the fix.
 *
 * Decaid distinguishes a device it has never seen from one it remembers but
 * cannot currently reach — the latter comes back with `available: false`,
 * which in practice means the hardware is off, asleep or out of range. That is
 * a different problem from "no machine paired", and telling them apart saves
 * hunting in the wrong place.
 */
export function describeFailedConnect(kind: 'machine' | 'scale', devices: readonly DeviceEntry[]): string {
  const noun = kind === 'machine' ? 'machine' : 'scale';
  const known = devices.find((device) => device.type === kind);

  if (!known) return `No ${noun} found. Check it is switched on and in Bluetooth range.`;
  if (known.available === false) {
    return `${known.name} is paired but not responding. Switch it on, or wake it if it has been idle.`;
  }
  return `${known.name} was found but would not connect. Try again, or reconnect it from Decaid.`;
}
