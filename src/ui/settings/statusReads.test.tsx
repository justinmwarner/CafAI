// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { describe, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { ServicesProvider } from '../../app/services.tsx';
import type { Settings } from '../../storage/types.ts';
import { createFakeServices, SAMPLE_WORKFLOW } from '../testing/fakeServices.ts';
import {
  keepDrinkPresets,
  keepPresence,
  SettingsWatchContext,
  useKeptDrinkPresets,
  useKeptPresence,
  useWatchedSettings,
  watchSettings,
} from './statusReads.ts';

const SETTINGS: Settings = { model: 'claude-opus-5-5', grinderName: 'Niche Zero', grinderSetting: '14', activeBagId: null };

describe('watchSettings: the settings as the cards last read or saved them (D236)', () => {
  it('passes reads and saves through, and keeps what each returned', async () => {
    const services = createFakeServices({ storage: { settings: SETTINGS } });
    const watch = watchSettings(services.storage.settings);
    expect(watch.current()).toBeNull();
    const heard: Array<string | null> = [];
    watch.subscribe(() => heard.push(watch.current()?.grinderSetting ?? null));

    expect((await watch.repository.get()).grinderSetting).toBe('14');
    expect(watch.current()?.grinderSetting).toBe('14');
    expect((await watch.repository.update({ grinderSetting: '15' })).grinderSetting).toBe('15');
    expect(watch.current()?.grinderSetting).toBe('15');
    // The repository underneath holds the save: the watch only listens.
    expect((await services.storage.settings.get()).grinderSetting).toBe('15');
    expect(heard).toEqual(['14', '15']);
  });

  it('never lets an older read that answers late hide a newer save', async () => {
    let answerRead: (settings: Settings) => void = () => undefined;
    const slow = {
      get: () => new Promise<Settings>((resolve) => (answerRead = resolve)),
      update: async () => ({ ...SETTINGS, model: 'claude-fable-5-1' }),
    };
    const watch = watchSettings(slow);
    const read = watch.repository.get();
    await watch.repository.update({ model: 'claude-fable-5-1' });
    answerRead(SETTINGS);
    await read;
    expect(watch.current()?.model).toBe('claude-fable-5-1');
  });

  it('calls the repository as it is when asked, so a spy put on it later still hears', async () => {
    const services = createFakeServices({ storage: { settings: SETTINGS } });
    const watch = watchSettings(services.storage.settings);
    const calls: string[] = [];
    const original = services.storage.settings.update;
    services.storage.settings.update = async (patch) => {
      calls.push(JSON.stringify(patch));
      return original(patch);
    };
    await watch.repository.update({ grinderName: 'EK43' });
    expect(calls).toEqual(['{"grinderName":"EK43"}']);
  });
});

function WatchedProbe() {
  const settings = useWatchedSettings();
  return <span data-testid="probe">{settings ? `${settings.grinderName} ${settings.grinderSetting}` : 'none'}</span>;
}

describe('useWatchedSettings', () => {
  it("reads the settings once through the screen's watch, and follows each save made through it", async () => {
    const services = createFakeServices({ storage: { settings: SETTINGS } });
    const watch = watchSettings(services.storage.settings);
    render(
      <ServicesProvider services={services}>
        <SettingsWatchContext.Provider value={watch}>
          <WatchedProbe />
        </SettingsWatchContext.Provider>
      </ServicesProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('Niche Zero 14'));
    await act(async () => {
      await watch.repository.update({ grinderSetting: '12' });
    });
    expect(screen.getByTestId('probe')).toHaveTextContent('Niche Zero 12');
  });

  it('reads them once on its own without a watch, as a list alone in a test', async () => {
    const services = createFakeServices({ storage: { settings: SETTINGS } });
    render(
      <ServicesProvider services={services}>
        <WatchedProbe />
      </ServicesProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('Niche Zero 14'));
  });
});

function KeptProbe() {
  const presets = useKeptDrinkPresets();
  const presence = useKeptPresence();
  return (
    <>
      <span data-testid="presets">{presets ? String(presets.steamSettings.duration) : 'none'}</span>
      <span data-testid="presence">{presence ? String(presence.sleepTimeoutMinutes) : 'none'}</span>
    </>
  );
}

describe("what the groups read from Decaid, kept for this page's life", () => {
  it('is nothing until a group keeps it, then what it kept last, per Decaid client', () => {
    const services = createFakeServices();
    const other = createFakeServices();
    render(
      <ServicesProvider services={services}>
        <KeptProbe />
      </ServicesProvider>,
    );
    expect(screen.getByTestId('presets')).toHaveTextContent('none');
    expect(screen.getByTestId('presence')).toHaveTextContent('none');

    act(() => keepDrinkPresets(other.decaid, SAMPLE_WORKFLOW));
    expect(screen.getByTestId('presets')).toHaveTextContent('none');

    act(() => keepDrinkPresets(services.decaid, SAMPLE_WORKFLOW));
    act(() => keepPresence(services.decaid, { ...services.decaid.presence, sleepTimeoutMinutes: 45 }));
    expect(screen.getByTestId('presets')).toHaveTextContent('50');
    expect(screen.getByTestId('presence')).toHaveTextContent('45');

    act(() => keepDrinkPresets(services.decaid, { ...SAMPLE_WORKFLOW, steamSettings: { ...SAMPLE_WORKFLOW.steamSettings, duration: 35 } }));
    expect(screen.getByTestId('presets')).toHaveTextContent('35');
  });
});
