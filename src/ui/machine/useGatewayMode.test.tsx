// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup } from '@testing-library/react';
import { GatewayError, type DecaidSettings } from '../../api/types.ts';
import { createFakeServices, type FakeServices } from '../testing/fakeServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { useGatewayMode, type GatewayMode } from './useGatewayMode.ts';

/** Renders the hook and hands back its latest value. */
async function renderGateway(services: FakeServices = createFakeServices()) {
  const seen: { current: GatewayMode | null } = { current: null };
  function Probe() {
    seen.current = useGatewayMode();
    return null;
  }
  renderWithServices(<Probe />, services);
  await act(async () => {});
  return { services, gateway: () => seen.current! };
}

/** Decaid in Full gateway mode, and the call log cleared. */
async function full(services = createFakeServices()) {
  await services.decaid.updateSettings({ gatewayMode: 'full' });
  services.decaid.calls.length = 0;
  return services;
}

const reads = (services: FakeServices) => services.decaid.calls.filter((call) => call.method === 'getSettings').length;

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('useGatewayMode', () => {
  it("reads Decaid's gateway mode on mount", async () => {
    const { gateway } = await renderGateway();
    expect(gateway()).toMatchObject({ mode: 'tracking', fixing: false, error: null });
    const inFull = await renderGateway(await full());
    expect(inFull.gateway().mode).toBe('full');
  });

  it('reads it again each time the machine connects, and when the page comes back into view', async () => {
    const services = createFakeServices({ telemetry: { machineConnected: false } });
    const { gateway } = await renderGateway(services);
    expect(reads(services)).toBe(1);
    await services.decaid.updateSettings({ gatewayMode: 'full' });
    await act(async () => services.telemetry.setState({ machineConnected: true }));
    expect(reads(services)).toBe(2);
    expect(gateway().mode).toBe('full');

    await act(async () => setVisibility('hidden'));
    expect(reads(services)).toBe(2);
    await act(async () => setVisibility('visible'));
    expect(reads(services)).toBe(3);
  });

  it('the fix asks Decaid for Tracking and follows the settings it reads back', async () => {
    const services = await full();
    let release: (settings: DecaidSettings) => void = () => {};
    services.decaid.updateSettings = (patch) => {
      services.decaid.calls.push({ method: 'updateSettings', args: [patch] });
      return new Promise((resolve) => (release = resolve));
    };
    const { gateway } = await renderGateway(services);
    act(() => gateway().fix());
    expect(gateway().fixing).toBe(true);
    // A second tap while the first is on its way sends nothing.
    act(() => gateway().fix());
    expect(services.decaid.calls.filter((call) => call.method === 'updateSettings').map((call) => call.args)).toEqual([[{ gatewayMode: 'tracking' }]]);
    await act(async () => release({ gatewayMode: 'tracking' }));
    expect(gateway()).toMatchObject({ mode: 'tracking', fixing: false, error: null });
  });

  it('a failed fix keeps the mode and says why', async () => {
    const services = await full();
    services.decaid.failNext('updateSettings', new GatewayError(0, '/api/v1/settings', 'Decaid did not answer in time. Check that it is running, then try again.', 'timeout'));
    const { gateway } = await renderGateway(services);
    await act(async () => gateway().fix());
    expect(gateway()).toMatchObject({
      mode: 'full',
      fixing: false,
      error: "Couldn't change Decaid's setting. Decaid did not answer in time. Check that it is running, then try again.",
    });
  });

  it('a fix Decaid answered but did not take says where to change it', async () => {
    const services = await full();
    services.decaid.updateSettings = async (patch) => {
      services.decaid.calls.push({ method: 'updateSettings', args: [patch] });
      return { gatewayMode: 'full' };
    };
    const { gateway } = await renderGateway(services);
    await act(async () => gateway().fix());
    expect(gateway()).toMatchObject({ mode: 'full', error: "Decaid kept its setting. Set Gateway Mode to Tracking in Decaid's settings." });
  });

  it('says nothing it is not sure of: a reply it cannot read, or a mode left out, is no mode', async () => {
    const services = createFakeServices();
    services.decaid.failNext('getSettings', new GatewayError(200, '/api/v1/settings', "Decaid sent a reply CafAI doesn't recognise.", 'unexpected_reply'));
    expect((await renderGateway(services)).gateway().mode).toBeNull();
    cleanup();

    const leftOut = createFakeServices();
    leftOut.decaid.getSettings = async () => ({ blockOnNoScale: false });
    expect((await renderGateway(leftOut)).gateway().mode).toBeNull();
  });

  it('an older read that lands late never undoes what the fix found', async () => {
    const services = await full();
    let lateRead: (settings: DecaidSettings) => void = () => {};
    services.decaid.getSettings = () => new Promise((resolve) => (lateRead = resolve));
    services.decaid.updateSettings = async () => ({ gatewayMode: 'tracking' });
    const { gateway } = await renderGateway(services);
    await act(async () => gateway().fix());
    expect(gateway().mode).toBe('tracking');
    await act(async () => lateRead({ gatewayMode: 'full' }));
    expect(gateway().mode).toBe('tracking');
  });
});
