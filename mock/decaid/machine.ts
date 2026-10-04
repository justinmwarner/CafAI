/**
 * The mock DE1's own copy of the profile, and the one queue every machine
 * write goes through.
 *
 * Decaid answers PUT /workflow at once and uploads the profile to the DE1
 * afterwards (a45961b: controllers/workflow_device_sync.dart), so for a moment
 * the machine still runs the old profile while the workflow already names the
 * new one: a shot pulled then runs the old profile and its record (a copy of
 * the workflow at shot end) names the new one. The sync uploads only the
 * latest workflow profile, and only when it differs from what the DE1 holds
 * (Profile equality covers all ten keys, title and notes included); with no
 * machine it waits for the next connect.
 *
 * Decaid sends every machine write through one first-in first-out queue
 * (De1Controller.runDeviceWrite): the sync's upload, POST /machine/profile
 * (which uploads only when the DE1 holds something else, so it doubles as a
 * barrier: unified_de1.dart setProfile) and every state request but idle. So
 * a barrier or a REST espresso start waits for an upload in flight, while a
 * group-head press (the DE1 starts by itself) does not.
 *
 * The upload takes `uploadMs` of wall-clock time, not scaled by the shot
 * player's speed: it stands for Bluetooth writes, not for brewing.
 */
import type { WireProfile } from '../../src/api/types.ts';
import { clone } from '../../src/util/clone.ts';
import { isPlainObject } from './json.ts';

export const DEFAULT_UPLOAD_MS = 800;

export interface MachineProfileOptions {
  /** What the DE1 holds at start (Decaid uploaded the workflow profile when it connected). */
  initial: WireProfile;
  uploadMs: number;
  isConnected(): boolean;
  /** The workflow's profile now: what Decaid's sync wants on the machine. */
  wanted(): WireProfile;
  /** What a write meets with no machine (Decaid's DeviceNotConnectedException). */
  notConnected(): Error;
}

export interface MachineProfile {
  /** The profile the DE1 runs (a copy). */
  current(): WireProfile;
  /** An upload is on its way to the DE1. */
  uploading(): boolean;
  /** Run `job` after every write queued before it, one at a time. */
  write<T>(job: () => T | Promise<T>): Promise<T>;
  /** For use inside a write: upload `profile` unless the DE1 already holds an equal one. */
  upload(profile: WireProfile): Promise<void>;
  /** The workflow changed or the machine connected: queue an upload of the latest workflow profile. */
  sync(): void;
  /** The machine dropped: an upload in flight fails. */
  disconnected(): void;
  /** Stop the upload timer (end of a test). */
  dispose(): void;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Profile equality as Decaid's Equatable sees it: every one of the ten keys, steps included. */
export function sameProfile(a: WireProfile, b: WireProfile): boolean {
  return canonical(a) === canonical(b);
}

export function createMachineProfile(options: MachineProfileOptions): MachineProfile {
  let held = clone(options.initial);
  let active: { timer: ReturnType<typeof setTimeout> | null; fail(error: Error): void } | null = null;
  const jobs: Array<() => Promise<void>> = [];
  let draining = false;
  let syncQueued = false;
  let disposed = false;

  async function drain(): Promise<void> {
    draining = true;
    try {
      for (let job = jobs.shift(); job; job = jobs.shift()) await job();
    } finally {
      draining = false;
    }
  }

  function write<T>(job: () => T | Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      jobs.push(async () => {
        try {
          resolve(await job());
        } catch (error) {
          reject(error);
        }
      });
      // An idle queue starts the job at once (synchronously), so an upload is
      // visible as soon as the PUT that caused it returns.
      if (!draining) void drain();
    });
  }

  function upload(profile: WireProfile): Promise<void> {
    if (!options.isConnected()) return Promise.reject(options.notConnected());
    if (sameProfile(held, profile)) return Promise.resolve();
    const target = clone(profile);
    if (options.uploadMs <= 0 || disposed) {
      held = target;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const entry = {
        timer: null as ReturnType<typeof setTimeout> | null,
        fail(error: Error) {
          if (entry.timer !== null) clearTimeout(entry.timer);
          entry.timer = null;
          if (active === entry) active = null;
          reject(error);
        },
      };
      entry.timer = setTimeout(() => {
        entry.timer = null;
        if (active === entry) active = null;
        held = target;
        resolve();
      }, options.uploadMs);
      active = entry;
    });
  }

  return {
    current: () => clone(held),
    uploading: () => active !== null,
    write,
    upload,
    sync() {
      // One queued sync is enough: it reads the workflow when its turn comes,
      // so the newest profile wins over any it replaced while waiting.
      if (syncQueued || disposed || !options.isConnected()) return;
      syncQueued = true;
      write(async () => {
        syncQueued = false;
        if (!options.isConnected()) return;
        await upload(options.wanted());
      }).catch(() => undefined);
    },
    disconnected() {
      active?.fail(options.notConnected());
    },
    dispose() {
      disposed = true;
      if (active?.timer != null) clearTimeout(active.timer);
      active = null;
    },
  };
}
