// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CoachState } from '../../app/types.ts';
import type { Settings } from '../../storage/types.ts';
import { createFakeServices, type FakeServices } from '../testing/fakeServices.ts';
import { TID } from '../testIds.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { LIBRARY_HINT, MISSING_LINE } from './grinderPicker.ts';
import { SettingsScreen } from './SettingsScreen.tsx';

const SECRET = 'sk-ant-api03-very-secret-value';

/** Decaid's grinder library as GET /api/v1/grinders sends it (null fields left out). */
const GRINDERS = [
  {
    id: 'g-niche',
    model: 'Niche Zero',
    burrs: '63 mm conical',
    archived: false,
    settingType: 'numeric',
    settingSmallStep: 0.5,
    settingBigStep: 2.0,
    createdAt: '2026-09-28T07:30:05.114862',
    updatedAt: '2026-09-28T07:30:05.114862',
  },
  { id: 'g-c40', model: 'Comandante C40 MK4', archived: false, settingType: 'numeric', settingSmallStep: 1.0 },
  {
    id: 'g-encore',
    model: 'Baratza Encore ESP',
    archived: false,
    settingType: 'preset',
    settingValues: Array.from({ length: 40 }, (_, i) => String(i + 1)),
  },
  { id: 'g-lagom', model: 'Lagom P64', archived: false, settingType: 'numeric', extras: { dye2: true } },
  { id: 'g-old', model: 'Old Mazzer', archived: true, settingType: 'numeric', settingSmallStep: 1.0 },
];

// The screen reads Decaid's grinders with the global fetch; no test may reach a real network.
let grinderReply: () => Response | Promise<Response>;
const fetched: string[] = [];

beforeEach(() => {
  grinderReply = () => new Response(JSON.stringify(GRINDERS), { status: 200, headers: { 'Content-Type': 'application/json' } });
  fetched.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      fetched.push(url);
      if (url.endsWith('/api/v1/grinders')) return grinderReply();
      return new Response('Route not found', { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderSettings(options: { coach?: Partial<CoachState>; settings?: Settings; insideDecaid?: boolean; key?: string } = {}) {
  const services: FakeServices = createFakeServices({
    coach: options.coach,
    insideDecaid: options.insideDecaid,
    storage: options.settings ? { settings: options.settings } : {},
  });
  if (options.key) services.storage.apiKey = options.key;
  renderWithServices(<SettingsScreen />, services);
  return services;
}

const methods = (services: FakeServices) => services.coach.calls.map((c) => c.method);

describe('SettingsScreen API key', () => {
  it('saves the key, refreshes the coach, and never shows the key again', async () => {
    const log = vi.spyOn(console, 'log');
    const error = vi.spyOn(console, 'error');
    const services = renderSettings({ coach: { hasApiKey: false } });
    expect(screen.getByText('No key saved yet. The coach needs one to work.')).toBeInTheDocument();
    expect(screen.getByText('The key stays on this tablet. It is never sent to Decaid or included in exports.')).toBeInTheDocument();
    const input = screen.getByTestId(TID.apiKeyInput);
    expect(input).toHaveAttribute('type', 'password');
    expect(screen.getByTestId(TID.apiKeySave)).toBeDisabled();

    await userEvent.type(input, `  ${SECRET}  `);
    await userEvent.click(screen.getByTestId(TID.apiKeySave));

    await waitFor(() => expect(services.storage.apiKey).toBe(SECRET));
    expect(await screen.findByText('A key is saved on this tablet.')).toBeInTheDocument();
    expect(methods(services)).toContain('refresh');
    expect(screen.getByTestId(TID.apiKeyInput)).toHaveValue('');
    expect(document.body.innerHTML).not.toContain(SECRET);
    for (const field of document.querySelectorAll('input')) expect(field.value).not.toContain(SECRET);
    for (const call of [...log.mock.calls, ...error.mock.calls]) expect(JSON.stringify(call)).not.toContain(SECRET);
  });

  it('shows and hides what is being typed', async () => {
    renderSettings({ coach: { hasApiKey: false } });
    const input = screen.getByTestId(TID.apiKeyInput);
    await userEvent.click(screen.getByRole('button', { name: 'Show key' }));
    expect(input).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Hide key' }));
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'off');
  });

  it('forgets the key only after a confirmation', async () => {
    const services = renderSettings({ coach: { hasApiKey: true }, key: SECRET });
    expect(screen.getByText('A key is saved on this tablet.')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId(TID.forgetKey));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep it' }));
    expect(services.storage.apiKey).toBe(SECRET);

    await userEvent.click(screen.getByTestId(TID.forgetKey));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Forget key' }));
    await waitFor(() => expect(services.storage.apiKey).toBeNull());
    expect(await screen.findByText('No key saved yet. The coach needs one to work.')).toBeInTheDocument();
    expect(methods(services)).toEqual(['refresh']);
    expect(screen.queryByTestId(TID.forgetKey)).toBeNull();
  });
});

describe('SettingsScreen coach settings', () => {
  const settings: Settings = { model: 'claude-opus-5-5', grinderName: 'Niche Zero', grinderSetting: '14', activeBagId: 'bag-1' };

  it('loads the stored model and grinder', async () => {
    renderSettings({ settings });
    await waitFor(() => expect(screen.getByTestId(TID.grinderName)).toHaveValue('Niche Zero'));
    expect(screen.getByTestId(TID.grinderSetting)).toHaveValue('14');
    const select = screen.getByTestId(TID.modelSelect);
    expect(select).toHaveValue('claude-opus-5-5');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Opus 5.5 · $4 / $20 per MTok',
      'Haiku 4.5 · $1 / $5 per MTok',
    ]);
    expect(screen.getByText('Sharpest advice. $4 in / $20 out per million tokens.')).toBeInTheDocument();
  });

  it('persists model and grinder, then refreshes the coach', async () => {
    const services = renderSettings({ settings });
    await waitFor(() => expect(screen.getByTestId(TID.grinderName)).toHaveValue('Niche Zero'));
    await userEvent.selectOptions(screen.getByTestId(TID.modelSelect), 'claude-haiku-4-5');
    await userEvent.clear(screen.getByTestId(TID.grinderName));
    await userEvent.type(screen.getByTestId(TID.grinderName), 'DF64');
    await userEvent.clear(screen.getByTestId(TID.grinderSetting));
    await userEvent.type(screen.getByTestId(TID.grinderSetting), ' 2.5 ');
    await userEvent.click(screen.getByTestId(TID.settingsSave));

    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
    expect(await services.storage.settings.get()).toEqual({
      model: 'claude-haiku-4-5',
      grinderName: 'DF64',
      grinderSetting: '2.5',
      grinderId: null,
      activeBagId: 'bag-1',
    });
    expect(methods(services)).toEqual(['refresh']);
  });

  it('stores blank grinder fields as null', async () => {
    const services = renderSettings({ settings });
    await waitFor(() => expect(screen.getByTestId(TID.grinderName)).toHaveValue('Niche Zero'));
    await userEvent.clear(screen.getByTestId(TID.grinderName));
    await userEvent.clear(screen.getByTestId(TID.grinderSetting));
    await userEvent.click(screen.getByTestId(TID.settingsSave));
    await screen.findByText('Settings saved.');
    expect(await services.storage.settings.get()).toMatchObject({ grinderName: null, grinderSetting: null });
  });
});

describe('SettingsScreen grinder from Decaid', () => {
  const typed: Settings = { model: 'claude-opus-5-5', grinderName: 'Niche Zero', grinderSetting: '14', activeBagId: 'bag-1' };
  const picker = () => screen.getByLabelText('Grinder from Decaid');
  const libraryReady = () => waitFor(() => expect(picker()).toBeEnabled());
  const options = (select: HTMLElement) => within(select).getAllByRole('option').map((option) => option.textContent);

  it("lists Decaid's grinders with their burrs, archived ones left out, plus \"Not in Decaid's list\"", async () => {
    renderSettings({ settings: typed });
    await libraryReady();
    expect(fetched).toContain('http://localhost:8080/api/v1/grinders');
    expect(options(picker())).toEqual(['Niche Zero (63 mm conical)', 'Comandante C40 MK4', 'Baratza Encore ESP', 'Lagom P64', "Not in Decaid's list"]);
    // Typed before grinders could be linked: still free text, with the hint on how to link it.
    expect(picker()).toHaveValue('');
    expect(screen.getByTestId(TID.grinderName)).toHaveValue('Niche Zero');
    expect(screen.getByTestId(TID.grinderSetting)).toHaveValue('14');
    expect(screen.getByText(LIBRARY_HINT)).toBeInTheDocument();
  });

  it('says plainly what CafAI will use for the grinder picked', async () => {
    renderSettings({ settings: typed });
    await libraryReady();
    await userEvent.selectOptions(picker(), 'g-niche');
    expect(screen.getByText('Decaid lists steps of 0.5 for this grinder (big steps 2).')).toBeInTheDocument();
    expect(screen.queryByTestId(TID.grinderName), 'a picked grinder is named by its model').toBeNull();
    expect(screen.getByTestId(TID.grinderSetting)).toHaveValue('14');
    await userEvent.selectOptions(picker(), 'g-c40');
    expect(screen.getByText('Decaid lists steps of 1 for this grinder.')).toBeInTheDocument();
    await userEvent.selectOptions(picker(), 'g-encore');
    expect(screen.getByText('Decaid lists 40 settings for this grinder.')).toBeInTheDocument();
    await userEvent.selectOptions(picker(), 'g-lagom');
    expect(screen.getByText('Decaid has no step size for this grinder, so the coach gives directions only.')).toBeInTheDocument();
    await userEvent.selectOptions(picker(), "Not in Decaid's list");
    expect(screen.getByText(LIBRARY_HINT)).toBeInTheDocument();
    expect(screen.getByTestId(TID.grinderName)).toHaveValue('Niche Zero');
  });

  it('saves the link, the model as the name and the setting, refreshes the coach, and leaves the workflow alone', async () => {
    const services = renderSettings({ settings: typed });
    await libraryReady();
    await userEvent.selectOptions(picker(), 'g-niche');
    await userEvent.clear(screen.getByTestId(TID.grinderSetting));
    await userEvent.type(screen.getByTestId(TID.grinderSetting), '13.5');
    await userEvent.click(screen.getByTestId(TID.settingsSave));
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
    expect(await services.storage.settings.get()).toEqual({
      model: 'claude-opus-5-5',
      grinderName: 'Niche Zero',
      grinderSetting: '13.5',
      grinderId: 'g-niche',
      activeBagId: 'bag-1',
    });
    expect(methods(services)).toEqual(['refresh']);
    expect(services.decaid.calls.map((call) => call.method)).not.toContain('updateWorkflow');
  });

  it('a preset grinder picks its setting from its list, keeping a value Decaid does not list', async () => {
    const services = renderSettings({ settings: { ...typed, grinderId: 'g-encore', grinderName: 'Baratza Encore ESP', grinderSetting: '14.5' } });
    await libraryReady();
    expect(picker()).toHaveValue('g-encore');
    const setting = screen.getByLabelText('Current grinder setting');
    expect(setting.tagName).toBe('SELECT');
    expect(screen.queryByTestId(TID.grinderSetting)).toBeNull();
    expect(setting).toHaveValue('14.5');
    expect(options(setting)[0]).toBe("14.5 (not in Decaid's list)");
    expect(options(setting)).toHaveLength(41);
    await userEvent.selectOptions(setting, '12');
    await userEvent.click(screen.getByTestId(TID.settingsSave));
    await screen.findByText('Settings saved.');
    expect(await services.storage.settings.get()).toMatchObject({ grinderId: 'g-encore', grinderName: 'Baratza Encore ESP', grinderSetting: '12' });
  });

  it('"Not in Decaid\'s list" keeps the free-text name and saves it unlinked', async () => {
    const services = renderSettings({ settings: { ...typed, grinderId: 'g-niche' } });
    await libraryReady();
    expect(picker()).toHaveValue('g-niche');
    expect(screen.queryByTestId(TID.grinderName)).toBeNull();
    await userEvent.selectOptions(picker(), "Not in Decaid's list");
    await userEvent.clear(screen.getByTestId(TID.grinderName));
    await userEvent.type(screen.getByTestId(TID.grinderName), 'DF64');
    await userEvent.click(screen.getByTestId(TID.settingsSave));
    await screen.findByText('Settings saved.');
    expect(await services.storage.settings.get()).toMatchObject({ grinderId: null, grinderName: 'DF64', grinderSetting: '14' });
  });

  it('keeps the link to a grinder Decaid no longer lists until another is picked', async () => {
    const services = renderSettings({ settings: { ...typed, grinderId: 'g-gone', grinderName: 'Old grinder' } });
    await libraryReady();
    expect(picker()).toHaveValue('g-gone');
    expect(options(picker())[0]).toBe("Old grinder (no longer in Decaid's list)");
    expect(screen.getByText(MISSING_LINE)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId(TID.settingsSave));
    await screen.findByText('Settings saved.');
    expect(await services.storage.settings.get()).toMatchObject({ grinderId: 'g-gone', grinderName: 'Old grinder' });
  });

  const unreachable = () => {
    throw new TypeError('Failed to fetch');
  };
  for (const [why, reply] of [
    ['Decaid cannot be reached', unreachable],
    ['Decaid has no grinders', () => new Response('[]', { status: 200 })],
    ['Decaid is too old to have a grinder library', () => new Response('Route not found', { status: 404 })],
  ] as const) {
    it(`keeps the two text fields and adds the library hint when ${why}`, async () => {
      grinderReply = reply;
      const services = renderSettings({ settings: { ...typed, grinderId: 'g-niche' } });
      expect(await screen.findByText(LIBRARY_HINT)).toBeInTheDocument();
      expect(screen.queryByLabelText('Grinder from Decaid')).toBeNull();
      expect(screen.getByTestId(TID.grinderName)).toHaveValue('Niche Zero');
      expect(screen.getByTestId(TID.grinderSetting)).toHaveValue('14');
      // An unchanged name is the same grinder: the link is kept.
      await userEvent.click(screen.getByTestId(TID.settingsSave));
      await screen.findByText('Settings saved.');
      expect(await services.storage.settings.get()).toMatchObject({ grinderId: 'g-niche', grinderName: 'Niche Zero' });
      expect(methods(services)).toEqual(['refresh']);
    });
  }

  it("drops the link when the grinder is renamed while Decaid's list is out of reach", async () => {
    grinderReply = unreachable;
    const services = renderSettings({ settings: { ...typed, grinderId: 'g-niche' } });
    await screen.findByText(LIBRARY_HINT);
    await userEvent.clear(screen.getByTestId(TID.grinderName));
    await userEvent.type(screen.getByTestId(TID.grinderName), 'DF64');
    await userEvent.click(screen.getByTestId(TID.settingsSave));
    await screen.findByText('Settings saved.');
    expect(await services.storage.settings.get()).toMatchObject({ grinderId: null, grinderName: 'DF64' });
  });
});

describe('SettingsScreen about', () => {
  it('shows the app version and the Decaid version from the API', async () => {
    renderSettings();
    expect(screen.getByText('CafAI 0.1.0-test')).toBeInTheDocument();
    expect(await screen.findByText('Decaid 0.9.0+1')).toBeInTheDocument();
  });

  it('prefers the version Decaid reports to the skin', () => {
    const services = renderSettings({ insideDecaid: true });
    expect(screen.getByText('Decaid 0.9.0')).toBeInTheDocument();
    expect(services.decaid.calls.map((c) => c.method)).not.toContain('getInfo');
  });
});
