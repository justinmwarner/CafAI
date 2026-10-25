// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { driftLog } from '../../api/drift.ts';
import type { PresenceSettings, WakeSchedule } from '../../api/types.ts';
import { createDisplayPrefsStore } from '../../app/displayPrefs.ts';
import { makeRecord } from '../../spend/testing/fixtures.ts';
import { createMemoryCoachSourceStore, type CoachSource } from '../../storage/coachSource.ts';
import type { KvMirror, Settings } from '../../storage/types.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { doneRecord, servicesWithCare } from '../testing/careServices.ts';
import { createFakeServices, createFakeSpend, SAMPLE_WORKFLOW, type FakeServices } from '../testing/fakeServices.ts';
import { TID } from '../testIds.ts';
import { settingsGroup } from './groups.tsx';
import {
  aboutStatus,
  coachStatus,
  dataStatus,
  displayStatus,
  drinksStatus,
  grinderStatus,
  machineStatus,
} from './groupStatus.ts';
import { forgetOpenedGroup, SettingsScreen } from './SettingsScreen.tsx';
import { SettingsList } from './SettingsList.tsx';

/** Saturday 24 October 2026, 15:00 on this device's clock. */
const NOW = new Date(2026, 9, 24, 15, 0);

const ANTHROPIC: CoachSource = { kind: 'anthropic', address: '', code: '' };
const BRIDGE: CoachSource = { kind: 'computer', address: '192.168.1.20:8877', code: 'ABCDEFGH' };

const coach = (over: Partial<Parameters<typeof coachStatus>[0]> = {}) =>
  coachStatus({ source: ANTHROPIC, keyKnown: true, hasKey: true, model: 'Opus 5.5', monthMicros: 1_840_000, paused: false, ...over });

describe('Coach (D236)', () => {
  it("on the API key: the model and the month's estimated cost", () => {
    expect(coach()).toEqual({ line: 'Opus 5.5 · $1.84 this month', attention: false });
    expect(coach({ monthMicros: 0 })).toEqual({ line: 'Opus 5.5 · $0.00 this month', attention: false });
    // Without the spend service (a preview), the model alone.
    expect(coach({ monthMicros: null })).toEqual({ line: 'Opus 5.5', attention: false });
  });

  it('with no key yet, says so, with a dot', () => {
    expect(coach({ hasKey: false })).toEqual({ line: 'No key yet', attention: true });
  });

  it('paused by the budget, says so, with a dot', () => {
    expect(coach({ paused: true })).toEqual({ line: 'Paused: budget reached', attention: true });
  });

  it('on the computer: says so, with the model, its prices aside', () => {
    expect(coach({ source: BRIDGE, monthMicros: 900_000 })).toEqual({ line: 'On your computer · Opus 5.5', attention: false });
    // The budget never pauses the bridge, and its own code decides whether it is set up.
    expect(coach({ source: BRIDGE, paused: true, hasKey: false })).toEqual({ line: 'On your computer · Opus 5.5', attention: false });
  });

  it('the bridge without a usable address and code: not set up yet, with a dot', () => {
    expect(coach({ source: { ...BRIDGE, code: '' } })).toEqual({ line: 'Not set up yet', attention: true });
    expect(coach({ source: { ...BRIDGE, address: '' } })).toEqual({ line: 'Not set up yet', attention: true });
    expect(coach({ source: { ...BRIDGE, code: 'ABC' } })).toEqual({ line: 'Not set up yet', attention: true });
  });

  it('says nothing live until where the coach runs, the settings and the key are known', () => {
    expect(coach({ source: null })).toBeNull();
    expect(coach({ model: null })).toBeNull();
    expect(coach({ keyKnown: false })).toBeNull();
  });
});

describe('Grinder', () => {
  const grinder = (grinderName: string | null, grinderSetting: string | null) => grinderStatus({ grinderName, grinderSetting });

  it('names the grinder and its setting', () => {
    expect(grinder('Niche Zero', '14')).toEqual({ line: 'Niche Zero · 14', attention: false });
    expect(grinder('Niche Zero', null)).toEqual({ line: 'Niche Zero', attention: false });
    expect(grinder(null, '14')).toEqual({ line: 'Setting 14', attention: false });
  });

  it('says not set yet without a dot: the coach gives directions without one', () => {
    expect(grinder(null, null)).toEqual({ line: 'Not set yet', attention: false });
    expect(grinder('  ', '')).toEqual({ line: 'Not set yet', attention: false });
    expect(grinderStatus(null)).toBeNull();
  });
});

describe('Drinks', () => {
  it("says each drink's time or volume once Decaid's presets are read", () => {
    expect(drinksStatus(SAMPLE_WORKFLOW)).toEqual({ line: 'Steam 50 s · Water 50 ml · Flush 10 s', attention: false });
  });

  it('says steam is off below its heater, and leaves out what Decaid sent unreadable', () => {
    const presets = {
      steamSettings: { ...SAMPLE_WORKFLOW.steamSettings, targetTemperature: 0 },
      hotWaterData: { ...SAMPLE_WORKFLOW.hotWaterData, volume: null },
      rinseData: { ...SAMPLE_WORKFLOW.rinseData, duration: 7.6 },
    };
    expect(drinksStatus(presets)).toEqual({ line: 'Steam off · Flush 8 s', attention: false });
  });

  it('says nothing live until read', () => {
    expect(drinksStatus(null)).toBeNull();
  });
});

const PRESENCE: PresenceSettings = { userPresenceEnabled: true, sleepTimeoutMinutes: 30, schedules: [], keepAwakeUntil: null };
const wake = (time: string, over: Partial<WakeSchedule> = {}): WakeSchedule => ({ id: `w-${time}`, time, daysOfWeek: [], enabled: true, ...over });

describe('Machine', () => {
  const machine = (over: Partial<Parameters<typeof machineStatus>[0]> = {}) =>
    machineStatus({ dueStep: null, presence: PRESENCE, clock: '24h', now: NOW, ...over });

  it('says when the machine sleeps and when it next wakes, in the clock chosen', () => {
    expect(machine()).toEqual({ line: 'Sleeps after 30 min', attention: false });
    expect(machine({ presence: { ...PRESENCE, schedules: [wake('06:30')] } })).toEqual({ line: 'Sleeps after 30 min · Next wake 06:30', attention: false });
    expect(machine({ presence: { ...PRESENCE, schedules: [wake('06:30')] }, clock: '12h' })).toEqual({
      line: 'Sleeps after 30 min · Next wake 6:30 am',
      attention: false,
    });
    expect(machine({ presence: { ...PRESENCE, sleepTimeoutMinutes: 90 } })).toEqual({ line: 'Sleeps after 1 h 30 min', attention: false });
  });

  it('names the day of a next wake beyond tomorrow, and leaves out wake times that are off', () => {
    // Saturday 15:00: a weekday wake comes on Monday.
    const weekdays = wake('06:30', { daysOfWeek: [1, 2, 3, 4, 5] });
    expect(machine({ presence: { ...PRESENCE, schedules: [weekdays] } })?.line).toBe('Sleeps after 30 min · Next wake Mon 06:30');
    expect(machine({ presence: { ...PRESENCE, schedules: [wake('06:30', { enabled: false })] } })?.line).toBe('Sleeps after 30 min');
  });

  it('says never sleeps while Sleep when idle is off', () => {
    expect(machine({ presence: { ...PRESENCE, sleepTimeoutMinutes: 0 } })?.line).toBe('Never sleeps');
    expect(machine({ presence: { ...PRESENCE, userPresenceEnabled: false, schedules: [wake('07:00')] } })?.line).toBe('Never sleeps · Next wake 07:00');
  });

  it('puts a care step that is due first, by its own name, with a dot', () => {
    expect(machine({ dueStep: 'descale' })).toEqual({ line: 'Descale due', attention: true });
    expect(machine({ dueStep: 'detergent-clean', presence: null })).toEqual({ line: 'Weekly clean due', attention: true });
  });

  it('says nothing live until the sleep settings are read and nothing is due', () => {
    expect(machine({ presence: null })).toBeNull();
  });
});

describe('Display', () => {
  it('says the mode, the tint and the temperature unit, and the 12-hour clock once chosen', () => {
    expect(displayStatus({ appearance: { mode: 'dark', tint: 'crema' }, unit: 'celsius', clock: '24h' })).toEqual({
      line: 'Dark · Crema · °C',
      attention: false,
    });
    expect(displayStatus({ appearance: { mode: 'light', tint: 'cold-brew' }, unit: 'fahrenheit', clock: '12h' })?.line).toBe(
      'Light · Cold Brew · °F · 12-hour',
    );
    expect(displayStatus({ appearance: { mode: 'auto', tint: { hue: 200 } }, unit: 'celsius', clock: '24h' })?.line).toBe('Auto · Custom · °C');
    // A tint this build does not know is drawn as the default, so it is named as that.
    expect(displayStatus({ appearance: { mode: 'dark', tint: 'espresso' }, unit: 'celsius', clock: '24h' })?.line).toBe('Dark · Crema · °C');
  });
});

describe('Data and privacy', () => {
  const at = Date.parse('2026-10-24T13:55:00Z');

  it('says how long ago the backup landed', () => {
    expect(dataStatus({ lastPushAt: '2026-10-24T13:50:00Z', lastError: null, known: true }, at)).toEqual({ line: 'Backed up 5 min ago', attention: false });
  });

  it('says the backup is paused, with a dot, and the card says why', () => {
    expect(dataStatus({ lastPushAt: '2026-10-24T13:50:00Z', lastError: 'Could not back up to Decaid: offline', known: true }, at)).toEqual({
      line: 'Backup paused',
      attention: true,
    });
  });

  it('says not backed up yet only once that is known', () => {
    expect(dataStatus({ lastPushAt: null, lastError: null, known: true }, at)).toEqual({ line: 'Not backed up yet', attention: false });
    expect(dataStatus({ lastPushAt: null, lastError: null, known: false }, at)).toBeNull();
  });
});

describe('About', () => {
  it("names CafAI's version and Decaid's, without the build", () => {
    expect(aboutStatus({ appVersion: '0.1.3', decaidVersion: '0.9.0+1', drift: 0 })).toEqual({ line: 'CafAI 0.1.3 · Decaid 0.9.0', attention: false });
    expect(aboutStatus({ appVersion: '0.1.3', decaidVersion: null, drift: 0 })).toEqual({ line: 'CafAI 0.1.3', attention: false });
  });

  it('says a Decaid older than the one CafAI was checked against, with a dot', () => {
    expect(aboutStatus({ appVersion: '0.1.3', decaidVersion: '0.8.6+2790', drift: 0 })).toEqual({ line: 'Decaid 0.8.6 is older than checked', attention: true });
  });

  it('says Decaid sent something unexpected, with a dot', () => {
    expect(aboutStatus({ appVersion: '0.1.3', decaidVersion: '0.9.0', drift: 2 })).toEqual({ line: 'Decaid sent something unexpected', attention: true });
  });
});

// The list, live: each row is described by its status line and shows a dot beside words that need the barista.

const JSDOM_VIEWPORT = { width: window.innerWidth, height: window.innerHeight };

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  window.dispatchEvent(new Event('resize'));
}

const row = (id: string) => screen.getByTestId(TID.settingsGroupRow(id));
const hasDot = (id: string) => row(id).querySelector('[data-dot]') !== null;

beforeEach(() => {
  forgetOpenedGroup();
  // The groups read Decaid's grinders with the global fetch; no test may reach a real network.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })));
});

afterEach(() => {
  setViewport(JSDOM_VIEWPORT.width, JSDOM_VIEWPORT.height);
  vi.unstubAllGlobals();
  driftLog.clear();
  window.location.hash = '';
});

const SETTINGS: Settings = { model: 'claude-opus-5-5', grinderName: 'Niche Zero', grinderSetting: '14', activeBagId: null };

/** Services with the spend on October's $1.84, where the coach runs, and the display store. */
function liveServices(over: { settings?: Partial<Settings>; source?: Partial<CoachSource> } = {}): FakeServices {
  const spend = createFakeSpend({ records: [makeRecord({ day: '2026-10-03', costMicros: 1_840_000 })], now: () => NOW });
  const services = createFakeServices({ spend, storage: { settings: { ...SETTINGS, ...over.settings } } });
  services.coachSource = createMemoryCoachSourceStore(over.source ?? { kind: 'anthropic' });
  return Object.assign(services, { displayPrefs: createDisplayPrefsStore(services.storage.settings) });
}

type MirrorStatus = Partial<Pick<KvMirror, 'lastPushAt' | 'lastError' | 'backupKnown'>>;

/** The fake mirror as it stands after a push or a failure (its fields are the mirror's own to set). */
function withMirror(services: FakeServices, status: MirrorStatus): FakeServices {
  services.storage.mirror = { ...services.storage.mirror, ...status };
  return services;
}

describe('the list, live (D236)', () => {
  it('describes each row by its status line', async () => {
    const services = withMirror(liveServices(), { lastPushAt: new Date(Date.now() - 5 * 60_000).toISOString() });
    renderWithServices(<SettingsList chosen={null} chevrons />, services);
    await waitFor(() => expect(row('coach')).toHaveAccessibleDescription('Opus 5.5 · $1.84 this month'));
    expect(row('grinder')).toHaveAccessibleDescription('Niche Zero · 14');
    // Nothing read from Decaid yet: the groups' plain contents.
    expect(row('drinks')).toHaveAccessibleDescription(settingsGroup('drinks').contents);
    expect(row('machine')).toHaveAccessibleDescription(settingsGroup('machine').contents);
    expect(row('display')).toHaveAccessibleDescription('Dark · Crema · °C');
    expect(row('data')).toHaveAccessibleDescription('Backed up 5 min ago');
    await waitFor(() => expect(row('about')).toHaveAccessibleDescription('CafAI 0.1.0-test · Decaid 0.9.0'));
    for (const id of ['coach', 'grinder', 'drinks', 'machine', 'display', 'data', 'about']) expect(hasDot(id), id).toBe(false);
  });

  it('puts a dot beside the words when something needs the barista', async () => {
    const services = withMirror(liveServices(), { lastError: 'Could not back up to Decaid: offline' });
    services.coach.setState({ hasApiKey: false });
    renderWithServices(<SettingsList chosen={null} chevrons />, services);
    await waitFor(() => expect(row('coach')).toHaveAccessibleDescription('No key yet'));
    expect(hasDot('coach')).toBe(true);
    expect(row('data')).toHaveAccessibleDescription('Backup paused');
    expect(hasDot('data')).toBe(true);
    act(() => driftLog.report({ source: 'GET /api/v1/workflow', problem: 'profile: missing' }));
    expect(row('about')).toHaveAccessibleDescription('Decaid sent something unexpected');
    expect(hasDot('about')).toBe(true);
  });

  it('says the coach is paused once the budget pauses it', async () => {
    const services = liveServices({ settings: { coachBudget: { monthlyUsd: 1, pauseAtBudget: true } } });
    renderWithServices(<SettingsList chosen={null} chevrons />, services);
    await waitFor(() => expect(row('coach')).toHaveAccessibleDescription('Paused: budget reached'));
    expect(hasDot('coach')).toBe(true);
  });

  it('follows where the coach runs: the computer, and a bridge not set up yet', async () => {
    const services = liveServices({ source: BRIDGE });
    renderWithServices(<SettingsList chosen={null} chevrons />, services);
    await waitFor(() => expect(row('coach')).toHaveAccessibleDescription('On your computer · Opus 5.5'));
    await act(async () => {
      await services.coachSource!.set({ ...BRIDGE, code: '' });
    });
    expect(row('coach')).toHaveAccessibleDescription('Not set up yet');
    expect(hasDot('coach')).toBe(true);
  });

  it('says a care step that is due while its reminders are on', async () => {
    const services = await servicesWithCare({ records: [doneRecord('descale', 400)], settings: { reminders: true } });
    renderWithServices(<SettingsList chosen={null} chevrons />, services);
    await waitFor(() => expect(row('machine')).toHaveAccessibleDescription('Descale due'));
    expect(hasDot('machine')).toBe(true);
  });

  it("follows a model and a grinder saved in the group beside it, with no read of the list's own", async () => {
    setViewport(1280, 800);
    const services = liveServices();
    renderWithServices(<SettingsScreen group="coach" />, services);
    await waitFor(() => expect(row('coach')).toHaveAccessibleDescription('Opus 5.5 · $1.84 this month'));
    const model = await screen.findByTestId(TID.modelSelect);
    await waitFor(() => expect(model).not.toBeDisabled());
    await userEvent.selectOptions(model, 'claude-haiku-4-5');
    await waitFor(() => expect(row('coach')).toHaveAccessibleDescription('Haiku 4.5 · $1.84 this month'));
    expect((await services.storage.settings.get()).model).toBe('claude-haiku-4-5');
  });

  it('follows a grinder setting saved beside it', async () => {
    setViewport(1280, 800);
    const services = liveServices();
    renderWithServices(<SettingsScreen group="grinder" />, services);
    await waitFor(() => expect(row('grinder')).toHaveAccessibleDescription('Niche Zero · 14'));
    const setting = await screen.findByTestId(TID.grinderSetting);
    await waitFor(() => expect(setting).not.toBeDisabled());
    await userEvent.clear(setting);
    await userEvent.type(setting, '12{Enter}');
    await waitFor(() => expect(row('grinder')).toHaveAccessibleDescription('Niche Zero · 12'));
  });

  it("says the drinks' times once the Drinks group has read them, and keeps them for this page's life", async () => {
    setViewport(1280, 800);
    const services = liveServices();
    const { unmount } = renderWithServices(<SettingsScreen group="drinks" />, services);
    await waitFor(() => expect(row('drinks')).toHaveAccessibleDescription('Steam 50 s · Water 50 ml · Flush 10 s'));
    unmount();
    setViewport(390, 844);
    renderWithServices(<SettingsScreen group={null} />, services);
    expect(row('drinks')).toHaveAccessibleDescription('Steam 50 s · Water 50 ml · Flush 10 s');
    expect(services.decaid.calls.filter((call) => call.method === 'getWorkflow')).toHaveLength(1);
  });

  it('says when the machine sleeps and wakes once the Machine group has read it', async () => {
    setViewport(1280, 800);
    const services = liveServices();
    services.decaid.presence = { ...PRESENCE, schedules: [wake('06:30')] };
    renderWithServices(<SettingsScreen group="machine" />, services);
    await waitFor(() => expect(row('machine')).toHaveAccessibleDescription(/^Sleeps after 30 min · Next wake 06:30$/));
  });

  it('never reads Decaid for the list alone', async () => {
    setViewport(390, 844);
    const services = liveServices();
    renderWithServices(<SettingsScreen group={null} />, services);
    await waitFor(() => expect(row('coach')).toHaveAccessibleDescription('Opus 5.5 · $1.84 this month'));
    const methods = services.decaid.calls.map((call) => call.method);
    // Decaid's version, which Settings has always asked as it opens (the log's header), once.
    expect(methods).toEqual(['getInfo']);
  });
});
