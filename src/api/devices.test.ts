// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/test/gateway.test.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: Vitest and the shared live-gateway fixture.
import { describe, expect, it } from 'vitest';
import { cremaFixtures } from '../../mock/fixtures/index.ts';
import { describeFailedConnect } from './devices.ts';

describe('describeFailedConnect', () => {
  it('a paired-but-unreachable device is not reported as missing', () => {
    // Measured on a real DE1 that was switched off: Decaid still lists it, with
    // available:false. Saying "no machine found" would send someone looking for
    // a pairing problem they do not have.
    const devices = cremaFixtures.switchedOffMachine();
    expect(describeFailedConnect('machine', devices)).toMatch(/DE1 is paired but not responding/);
    expect(describeFailedConnect('machine', devices)).toMatch(/switch it on/i);
  });

  it('a device the gateway has never seen reads as missing', () => {
    expect(describeFailedConnect('machine', [])).toMatch(/No machine found/);
    expect(describeFailedConnect('scale', [])).toMatch(/No scale found/);
    expect(describeFailedConnect('scale', [])).toMatch(/Bluetooth range/);
  });

  it('a reachable device that still refuses is its own case', () => {
    const devices = [{ name: 'DE1', id: 'b', state: 'disconnected', type: 'machine', available: true }];
    expect(describeFailedConnect('machine', devices)).toMatch(/found but would not connect/);
  });
});
