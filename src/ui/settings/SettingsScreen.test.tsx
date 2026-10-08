// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CoachState } from '../../app/types.ts';
import { applySettingsPatch, DEFAULT_APPEARANCE, normalizeSettings } from '../../storage/settings.ts';
import type { Settings } from '../../storage/types.ts';
import { createFakeServices, type FakeServices } from '../testing/fakeServices.ts';
import { TID } from '../testIds.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { LIBRARY_HINT, MISSING_LINE, UNREACHABLE_LINE } from './grinderPicker.ts';
import { KEY_TAKEN_OUT, SettingsScreen } from './SettingsScreen.tsx';

const SECRET = 'sk-ant-api03-very-secret-value';
/** A made-up key, built at run time so no key-shaped literal sits in the source. */
const PASTED_KEY = ['sk', 'ant', 'api03', 'sEtTiNgSuItEsT0123456789', 'AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789AA'].join('-');
const DEFAULT_MODEL = 'claude-opus-5-5';

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
  // The fake stores a patch as given; CafAI's storage reads and writes every
  // record through the settings rules (src/storage/repositories.ts), and the
  // screen must show what those rules really saved.
  let stored = normalizeSettings(options.settings, DEFAULT_MODEL);
  services.storage.settings = {
    get: async () => stored,
    update: async (patch) => (stored = applySettingsPatch(stored, patch, DEFAULT_MODEL)),
  };
  if (options.key) services.storage.apiKey = options.key;
  renderWithServices(<SettingsScreen />, services);
  return services;
}

/** A reply the test sends when it chooses, to see the screen while Decaid's list is on its way. */
function laterReply() {
  let send: (response: Response) => void = () => undefined;
  const reply = new Promise<Response>((resolve) => {
    send = resolve;
  });
  return { reply: () => reply, send: () => send(new Response(JSON.stringify(GRINDERS), { status: 200 })) };
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
      appearance: DEFAULT_APPEARANCE,
    });
    expect(methods(services)).toEqual(['refresh']);
    // The fields show what was saved; nothing was taken out, so nothing more is said.
    expect(screen.getByTestId(TID.grinderSetting)).toHaveValue('2.5');
    expect(screen.queryByText(KEY_TAKEN_OUT)).toBeNull();
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

describe('SettingsScreen keeps a pasted API key out of the settings (D37)', () => {
  const typed: Settings = { model: DEFAULT_MODEL, grinderName: 'Niche Zero', grinderSetting: '14', activeBagId: 'bag-1' };
  const noKeyInAnyField = () => {
    for (const field of document.querySelectorAll('input, select')) expect((field as HTMLInputElement).value).not.toContain('sk-ant-');
  };

  it('takes a key pasted into the grinder fields out, says so, and shows what was saved', async () => {
    const log = vi.spyOn(console, 'log');
    const error = vi.spyOn(console, 'error');
    const services = renderSettings({ settings: typed });
    await waitFor(() => expect(screen.getByTestId(TID.grinderName)).toHaveValue('Niche Zero'));
    // Pasted after the name, and over the setting (which keeps 20 characters).
    await userEvent.click(screen.getByTestId(TID.grinderName));
    await userEvent.paste(` ${PASTED_KEY}`);
    await userEvent.clear(screen.getByTestId(TID.grinderSetting));
    await userEvent.paste(PASTED_KEY);
    expect(screen.getByTestId(TID.grinderSetting)).toHaveValue(PASTED_KEY.slice(0, 20));
    await userEvent.click(screen.getByTestId(TID.settingsSave));

    expect(await screen.findByText(KEY_TAKEN_OUT)).toBeInTheDocument();
    expect(KEY_TAKEN_OUT).toBe('That looked like an API key, so CafAI took it out. Keys go in the API key field above.');
    expect(screen.getByText('Settings saved.')).toBeInTheDocument();
    expect(screen.getByTestId(TID.grinderName)).toHaveValue('Niche Zero');
    expect(screen.getByTestId(TID.grinderSetting)).toHaveValue('');
    expect(await services.storage.settings.get()).toEqual({ ...typed, grinderSetting: null, grinderId: null, appearance: DEFAULT_APPEARANCE });
    expect(methods(services)).toEqual(['refresh']);
    noKeyInAnyField();
    expect(document.body.innerHTML).not.toContain(PASTED_KEY.slice(0, 20));
    for (const call of [...log.mock.calls, ...error.mock.calls]) expect(JSON.stringify(call)).not.toContain('sk-ant-api03');
  });

  it('never saves a key as the model: the default model is used, and the screen says why', async () => {
    const services = renderSettings({ settings: { ...typed, model: 'claude-haiku-4-5' } });
    const model = screen.getByTestId(TID.modelSelect);
    await waitFor(() => expect(model).toHaveValue('claude-haiku-4-5'));
    // The model is a list, so only a crafted value can carry a key: plant one.
    const planted = document.createElement('option');
    planted.value = PASTED_KEY;
    planted.textContent = 'Planted';
    model.appendChild(planted);
    await userEvent.selectOptions(model, PASTED_KEY);
    planted.remove();
    await userEvent.click(screen.getByTestId(TID.settingsSave));

    expect(await screen.findByText(KEY_TAKEN_OUT)).toBeInTheDocument();
    expect(model).toHaveValue(DEFAULT_MODEL);
    expect(await services.storage.settings.get()).toMatchObject({ model: DEFAULT_MODEL, grinderName: 'Niche Zero', grinderSetting: '14' });
    noKeyInAnyField();
    expect(document.body.innerHTML).not.toContain(PASTED_KEY);
  });

  it('a later save without a key clears the notice', async () => {
    renderSettings({ settings: typed });
    await waitFor(() => expect(screen.getByTestId(TID.grinderName)).toHaveValue('Niche Zero'));
    await userEvent.clear(screen.getByTestId(TID.grinderSetting));
    await userEvent.paste(PASTED_KEY);
    await userEvent.click(screen.getByTestId(TID.settingsSave));
    await screen.findByText(KEY_TAKEN_OUT);
    await userEvent.type(screen.getByTestId(TID.grinderSetting), '15');
    await userEvent.click(screen.getByTestId(TID.settingsSave));
    await waitFor(() => expect(screen.queryByText(KEY_TAKEN_OUT)).toBeNull());
    expect(screen.getByText('Settings saved.')).toBeInTheDocument();
    expect(screen.getByTestId(TID.grinderSetting)).toHaveValue('15');
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
      appearance: DEFAULT_APPEARANCE,
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
  const noGrinders = () => new Response('[]', { status: 200 });
  const noLibrary = () => new Response('Route not found', { status: 404 });
  for (const [why, reply] of [
    ['Decaid cannot be reached', unreachable],
    ['Decaid has no grinders', noGrinders],
    ['Decaid is too old to have a grinder library', noLibrary],
  ] as const) {
    it(`keeps the two text fields of a typed grinder and adds the library hint when ${why}`, async () => {
      grinderReply = reply;
      const services = renderSettings({ settings: typed });
      expect(await screen.findByText(LIBRARY_HINT)).toBeInTheDocument();
      expect(screen.queryByLabelText('Grinder from Decaid')).toBeNull();
      expect(screen.getByTestId(TID.grinderName)).toHaveValue('Niche Zero');
      expect(screen.getByTestId(TID.grinderSetting)).toHaveValue('14');
      await userEvent.click(screen.getByTestId(TID.settingsSave));
      await screen.findByText('Settings saved.');
      expect(await services.storage.settings.get()).toMatchObject({ grinderId: null, grinderName: 'Niche Zero', grinderSetting: '14' });
      expect(methods(services)).toEqual(['refresh']);
    });
  }

  for (const [why, reply] of [
    ['Decaid lists no grinders', noGrinders],
    ['Decaid has no grinder library', noLibrary],
  ] as const) {
    it(`a link to a grinder Decaid no longer lists is kept and says so when ${why}`, async () => {
      grinderReply = reply;
      const services = renderSettings({ settings: { ...typed, grinderId: 'g-niche' } });
      expect(await screen.findByText(MISSING_LINE)).toBeInTheDocument();
      expect(picker()).toHaveValue('g-niche');
      expect(options(picker())).toEqual(["Niche Zero (no longer in Decaid's list)", "Not in Decaid's list"]);
      expect(screen.queryByText(LIBRARY_HINT)).toBeNull();
      expect(screen.queryByTestId(TID.grinderName), 'a linked grinder is named by its link').toBeNull();
      expect(screen.getByTestId(TID.grinderSetting)).toHaveValue('14');
      await userEvent.click(screen.getByTestId(TID.settingsSave));
      await screen.findByText('Settings saved.');
      expect(await services.storage.settings.get()).toMatchObject({ grinderId: 'g-niche', grinderName: 'Niche Zero', grinderSetting: '14' });
      expect(methods(services)).toEqual(['refresh']);
    });
  }

  it('with Decaid listing no grinders, "Not in Decaid\'s list" unlinks the grinder and names it by hand', async () => {
    grinderReply = noGrinders;
    const services = renderSettings({ settings: { ...typed, grinderId: 'g-niche' } });
    await screen.findByText(MISSING_LINE);
    await userEvent.selectOptions(picker(), "Not in Decaid's list");
    expect(screen.getByText(LIBRARY_HINT)).toBeInTheDocument();
    expect(screen.getByTestId(TID.grinderName)).toHaveValue('Niche Zero');
    await userEvent.clear(screen.getByTestId(TID.grinderName));
    await userEvent.type(screen.getByTestId(TID.grinderName), 'DF64');
    await userEvent.click(screen.getByTestId(TID.settingsSave));
    await screen.findByText('Settings saved.');
    expect(await services.storage.settings.get()).toMatchObject({ grinderId: null, grinderName: 'DF64', grinderSetting: '14' });
  });

  it("says Decaid can't be reached for a linked grinder, and keeps the link while the name is unchanged", async () => {
    grinderReply = unreachable;
    const services = renderSettings({ settings: { ...typed, grinderId: 'g-niche' } });
    expect(await screen.findByText(UNREACHABLE_LINE)).toBeInTheDocument();
    expect(screen.queryByText(LIBRARY_HINT)).toBeNull();
    expect(screen.queryByLabelText('Grinder from Decaid')).toBeNull();
    expect(screen.getByTestId(TID.grinderName)).toHaveValue('Niche Zero');
    expect(screen.getByTestId(TID.grinderSetting)).toHaveValue('14');
    await userEvent.click(screen.getByTestId(TID.settingsSave));
    await screen.findByText('Settings saved.');
    expect(await services.storage.settings.get()).toMatchObject({ grinderId: 'g-niche', grinderName: 'Niche Zero' });
    expect(methods(services)).toEqual(['refresh']);
  });

  it("drops the link when the grinder is renamed while Decaid's list is out of reach", async () => {
    grinderReply = unreachable;
    const services = renderSettings({ settings: { ...typed, grinderId: 'g-niche' } });
    await screen.findByText(UNREACHABLE_LINE);
    await userEvent.clear(screen.getByTestId(TID.grinderName));
    await userEvent.type(screen.getByTestId(TID.grinderName), 'DF64');
    await userEvent.click(screen.getByTestId(TID.settingsSave));
    await screen.findByText('Settings saved.');
    expect(await services.storage.settings.get()).toMatchObject({ grinderId: null, grinderName: 'DF64' });
    // Saved unlinked, so the screen speaks of a typed grinder now.
    expect(screen.getByText(LIBRARY_HINT)).toBeInTheDocument();
    expect(screen.queryByText(UNREACHABLE_LINE)).toBeNull();
  });

  it("shows a preset grinder's setting only as its list: a disabled placeholder until Decaid's list arrives", async () => {
    const later = laterReply();
    grinderReply = later.reply;
    renderSettings({ settings: { ...typed, grinderId: 'g-encore', grinderName: 'Baratza Encore ESP', grinderSetting: '12' } });
    await waitFor(() => expect(picker()).toHaveValue('g-encore'));
    const placeholder = screen.getByLabelText('Current grinder setting');
    expect(placeholder).toBeDisabled();
    expect(placeholder.tagName).toBe('INPUT');
    expect(placeholder).toHaveValue('');
    expect(placeholder).toHaveAttribute('placeholder', 'Loading…');
    expect(screen.queryByTestId(TID.grinderSetting), 'never the free-text field, not even for a moment').toBeNull();

    later.send();
    await libraryReady();
    const setting = screen.getByLabelText('Current grinder setting');
    expect(setting.tagName).toBe('SELECT');
    expect(setting).toBeEnabled();
    expect(setting).toHaveValue('12');
  });

  it("shows a typed grinder's setting at once, while Decaid's list is still on its way", async () => {
    const later = laterReply();
    grinderReply = later.reply;
    renderSettings({ settings: typed });
    await waitFor(() => expect(screen.getByTestId(TID.grinderSetting)).toHaveValue('14'));
    expect(screen.getByTestId(TID.grinderSetting)).toBeEnabled();
    expect(picker()).toBeDisabled();
    later.send();
    await libraryReady();
    expect(screen.getByTestId(TID.grinderSetting)).toHaveValue('14');
  });

  it('a pick brings the setting and Save into view, scrolling only the Settings column', async () => {
    renderSettings({ settings: typed });
    await libraryReady();
    const column = screen.getByRole('heading', { level: 1, name: 'Settings' }).parentElement?.parentElement;
    if (!column) throw new Error('No Settings column');
    // jsdom has no layout. At 962x602 the column runs from the 64 px top bar
    // to the bottom of the window, and the setting and Save sit about 700 px
    // down its content: below the fold.
    const box = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 600, width: 600, height, x: 0, y: top }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this === column ? box(64, 538) : box(64 + 700 - column.scrollTop, 48);
    });
    const page = { top: document.documentElement.scrollTop, body: document.body.scrollTop };

    await userEvent.selectOptions(picker(), 'g-encore');
    expect(screen.getByLabelText('Current grinder setting').tagName).toBe('SELECT');
    expect(column.scrollTop).toBe(700 + 48 + 16 - 538);
    expect({ top: document.documentElement.scrollTop, body: document.body.scrollTop }).toEqual(page);
  });

  it('Save brings what it says into view, the key notice included', async () => {
    renderSettings({ settings: typed });
    await waitFor(() => expect(screen.getByTestId(TID.grinderName)).toHaveValue('Niche Zero'));
    const column = screen.getByRole('heading', { level: 1, name: 'Settings' }).parentElement?.parentElement;
    if (!column) throw new Error('No Settings column');
    // Save sits at the bottom of the view; the messages under it, below the fold.
    const box = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 600, width: 600, height, x: 0, y: top }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === column) return box(64, 538);
      if (this.textContent?.includes('Settings saved.')) return box(64 + 560 - column.scrollTop, 120);
      return box(64 + 470 - column.scrollTop, 48);
    });
    await userEvent.clear(screen.getByTestId(TID.grinderSetting));
    await userEvent.paste(PASTED_KEY);
    await userEvent.click(screen.getByTestId(TID.settingsSave));
    await screen.findByText(KEY_TAKEN_OUT);
    expect(column.scrollTop).toBe(560 + 120 + 16 - 538);
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
