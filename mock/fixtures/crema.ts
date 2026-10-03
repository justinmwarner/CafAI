// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/test/profile.test.ts, gateway.test.ts and live-connections.test.ts
// (https://github.com/yarneo/crema @ 628cd714), Copyright (C) 2026 Yarden (yarneo).
// Modified for CafAI: lifted into shared fixtures, typed against src/api/types.ts.
/**
 * Payloads Crema recorded from live Decaid gateways (0.8.4 / 0.8.6). They
 * pin the real wire shapes the verified examples were built to match.
 */
import type { DecaidErrorBody, DeviceEntry, WeightSnapshot } from '../../src/api/types.ts';
import { clone } from '../../src/util/clone.ts';

/** Verbatim from a live Decaid 0.8.4 (`GET /api/v1/profiles`, the "Adaptive v3" profile). */
const liveStep = {
  name: 'Fill',
  pump: 'flow',
  transition: 'fast',
  exit: { type: 'pressure', condition: 'over', value: 3.0 },
  volume: 100.0,
  seconds: 12.0,
  weight: 0.0,
  temperature: 93.0,
  sensor: 'coffee',
  flow: 8.0,
  limiter: { value: 0.0, range: 0.6 },
};

/** Crema's workflow fixture, shaped like a real Decaid step (verified against 0.8.4). */
const workflow = {
  id: 'wf-1',
  profile: {
    version: '2',
    title: 'Gentle Decline',
    steps: [
      { name: 'fill', pump: 'flow', transition: 'fast', exit: { type: 'pressure', condition: 'over', value: 3 }, volume: 100, seconds: 8, weight: 0, temperature: 89, sensor: 'coffee', flow: 4, limiter: null },
      { name: 'bloom', pump: 'flow', transition: 'fast', exit: null, volume: 100, seconds: 20, weight: 0, temperature: 89, sensor: 'coffee', flow: 0.8, limiter: null },
      { name: 'extract', pump: 'pressure', transition: 'smooth', exit: null, volume: 0, seconds: 40, weight: 0, temperature: 92, sensor: 'coffee', pressure: 6, limiter: { value: 0, range: 0.6 } },
    ],
  },
  context: { targetDoseWeight: 18, targetYield: 40, grinderModel: 'Lagom 01', grinderSetting: '12.4' },
};

/** Verbatim from a live gateway with no machine paired (HTTP 500). */
const machineNotConnectedBody = '{"error":"DeviceNotConnectedException: machine not connected"}';

/** Measured on a real DE1 that was switched off: still listed, with available:false. */
const switchedOffMachine: DeviceEntry[] = [
  { name: 'Decent Scale', id: 'a', state: 'connected', type: 'scale', available: true },
  { name: 'DE1', id: 'b', state: 'disconnected', type: 'machine', available: false },
];

/** ws/v1/scale/snapshot frames: status frames are distinct from weight frames. */
const scaleFrames: {
  connected: { status: 'connected' };
  disconnected: { status: 'disconnected' };
  weight: Pick<WeightSnapshot, 'weight' | 'weightFlow' | 'battery'>;
} = {
  connected: { status: 'connected' },
  disconnected: { status: 'disconnected' },
  weight: { weight: 18.5, weightFlow: 2.1, battery: 84 },
};

export const cremaFixtures = {
  liveStep: () => clone(liveStep),
  workflow: () => clone(workflow),
  machineNotConnectedBody,
  machineNotConnectedError: (): DecaidErrorBody => JSON.parse(machineNotConnectedBody) as DecaidErrorBody,
  switchedOffMachine: () => clone(switchedOffMachine),
  scaleFrames: () => clone(scaleFrames),
};
