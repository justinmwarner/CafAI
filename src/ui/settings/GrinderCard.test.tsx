// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { applySettingsPatch, DEFAULT_APPEARANCE, normalizeSettings } from '../../storage/settings.ts';
import type { Settings } from '../../storage/types.ts';
import { createFakeServices, type FakeServices } from '../testing/fakeServices.ts';
import { TID } from '../testIds.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { GRINDER_CARD_TITLE, GrinderCard } from './GrinderCard.tsx';
import { LIBRARY_HINT, MISSING_LINE, UNREACHABLE_LINE } from './grinderPicker.ts';
import { GroupPage } from './GroupPage.tsx';
import { KEY_TAKEN_OUT, SAVED } from './SaveLine.tsx';

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

// The card reads Decaid's grinders with the global fetch; no test may reach a real network.
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
  vi.restoreAllMocks();
});

const typed: Settings = { model: DEFAULT_MODEL, grinderName: 'Niche Zero', grinderSetting: '14', activeBagId: 'bag-1' };

/** The card (or its whole group page) over a settings store that keeps what CafAI's storage would. */
function renderCard(settings: Settings = typed, ui = <GrinderCard />) {
  const services: FakeServices = createFakeServices({ storage: { settings } });
  let stored = normalizeSettings(settings, DEFAULT_MODEL);
  services.storage.settings = {
    get: async () => stored,
    update: vi.fn(async (patch: Partial<Settings>) => (stored = applySettingsPatch(stored, patch, DEFAULT_MODEL))),
  };
  renderWithServices(ui, services);
  return services;
}

/** A reply the test sends when it chooses, to see the card while Decaid's list is on its way. */
function laterReply() {
  let send: (response: Response) => void = () => undefined;
  const reply = new Promise<Response>((resolve) => {
    send = resolve;
  });
  return { reply: () => reply, send: () => send(new Response(JSON.stringify(GRINDERS), { status: 200 })) };
}

const methods = (services: FakeServices) => services.coach.calls.map((c) => c.method);
const updates = (services: FakeServices) => (services.storage.settings.update as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
const line = () => screen.getByTestId(TID.settingsSaved('grinder'));
const saved = () => waitFor(() => expect(line()).toHaveTextContent(SAVED));
const loaded = () => waitFor(() => expect(screen.getByTestId(TID.grinderName)).toHaveValue('Niche Zero'));
/** Leave a typed field, as a tap elsewhere does: its value is saved. */
const leave = (testId: string) => act(() => screen.getByTestId(testId).blur());

describe('Settings > Grinder > Your grinder: typed', () => {
  it('loads the stored grinder, with no Save', async () => {
    renderCard();
    expect(screen.getByRole('region', { name: GRINDER_CARD_TITLE })).toBeInTheDocument();
    await loaded();
    expect(screen.getByTestId(TID.grinderSetting)).toHaveValue('14');
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    expect(screen.getByText('The coach uses your grinder and its dial setting to say how far to turn it.')).toBeInTheDocument();
  });

  it('saves the typed name and setting when each is left, trimmed, then the coach re-reads them', async () => {
    const services = renderCard();
    await loaded();
    await userEvent.clear(screen.getByTestId(TID.grinderName));
    await userEvent.type(screen.getByTestId(TID.grinderName), 'DF64');
    // Typing saves nothing.
    expect(updates(services)).toEqual([]);
    await userEvent.click(screen.getByTestId(TID.grinderSetting));
    await saved();
    expect(updates(services)).toEqual([{ grinderId: null, grinderName: 'DF64', grinderSetting: '14' }]);

    await userEvent.clear(screen.getByTestId(TID.grinderSetting));
    await userEvent.type(screen.getByTestId(TID.grinderSetting), ' 2.5 ');
    leave(TID.grinderSetting);
    await waitFor(() => expect(updates(services)).toHaveLength(2));
    expect(await services.storage.settings.get()).toEqual({
      model: DEFAULT_MODEL,
      grinderName: 'DF64',
      grinderSetting: '2.5',
      grinderId: null,
      activeBagId: 'bag-1',
      appearance: DEFAULT_APPEARANCE,
    });
    expect(methods(services)).toEqual(['refresh', 'refresh']);
    // The field shows what was saved; nothing was taken out, so nothing more is said.
    await waitFor(() => expect(screen.getByTestId(TID.grinderSetting)).toHaveValue('2.5'));
    expect(screen.queryByText(KEY_TAKEN_OUT)).toBeNull();
  });

  it('saves on Enter too', async () => {
    const services = renderCard();
    await loaded();
    await userEvent.clear(screen.getByTestId(TID.grinderSetting));
    await userEvent.type(screen.getByTestId(TID.grinderSetting), '15{Enter}');
    await saved();
    expect(updates(services)).toEqual([{ grinderId: null, grinderName: 'Niche Zero', grinderSetting: '15' }]);
    expect(screen.getByTestId(TID.grinderSetting)).toHaveFocus();
  });

  it('saves nothing for a field left as it was, or typed back to what was saved', async () => {
    const services = renderCard();
    await loaded();
    await userEvent.click(screen.getByTestId(TID.grinderName));
    leave(TID.grinderName);
    await userEvent.type(screen.getByTestId(TID.grinderSetting), '5{Backspace}{Enter}');
    leave(TID.grinderSetting);
    await act(async () => undefined);
    expect(updates(services)).toEqual([]);
    expect(line()).toHaveTextContent('');
  });

  it('stores blank grinder fields as null', async () => {
    const services = renderCard();
    await loaded();
    await userEvent.clear(screen.getByTestId(TID.grinderName));
    await userEvent.clear(screen.getByTestId(TID.grinderSetting));
    leave(TID.grinderSetting);
    await waitFor(() => expect(updates(services).at(-1)).toEqual({ grinderId: null, grinderName: null, grinderSetting: null }));
    expect(await services.storage.settings.get()).toMatchObject({ grinderName: null, grinderSetting: null });
  });

  it('a save that fails says why, keeps what was typed, and the next one that saves carries it', async () => {
    const services = renderCard();
    await loaded();
    (services.storage.settings.update as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('disk full'));
    await userEvent.clear(screen.getByTestId(TID.grinderSetting));
    await userEvent.type(screen.getByTestId(TID.grinderSetting), '16');
    leave(TID.grinderSetting);
    await waitFor(() => expect(line()).toHaveTextContent('Could not save the grinder: disk full. Try again.'));
    expect(screen.getByTestId(TID.grinderSetting)).toHaveValue('16');
    expect(methods(services)).toEqual([]);
    // Left again, unchanged since the failure: it goes again, as it never reached storage.
    await userEvent.click(screen.getByTestId(TID.grinderSetting));
    leave(TID.grinderSetting);
    await saved();
    expect(await services.storage.settings.get()).toMatchObject({ grinderSetting: '16' });
  });

  it('keeps what is typed into another field while a save is on its way', async () => {
    const services = renderCard();
    await loaded();
    let land: () => void = () => undefined;
    const update = services.storage.settings.update as Mock<(patch: Partial<Settings>) => Promise<Settings>>;
    const real = update.getMockImplementation()!;
    update.mockImplementationOnce((patch: Partial<Settings>) => new Promise((resolve) => (land = () => resolve(real(patch)))));
    await userEvent.clear(screen.getByTestId(TID.grinderName));
    await userEvent.type(screen.getByTestId(TID.grinderName), 'DF64');
    await userEvent.click(screen.getByTestId(TID.grinderSetting));
    await userEvent.type(screen.getByTestId(TID.grinderSetting), '.5');
    await act(async () => land());
    await saved();
    expect(screen.getByTestId(TID.grinderName)).toHaveValue('DF64');
    expect(screen.getByTestId(TID.grinderSetting)).toHaveValue('14.5');
  });
});

describe('Settings > Grinder keeps a pasted API key out of the settings (D37)', () => {
  const noKeyInAnyField = () => {
    for (const field of document.querySelectorAll('input, select')) expect((field as HTMLInputElement).value).not.toContain('sk-ant-');
  };

  it('takes a key pasted into the grinder fields out, says so, and shows what was saved', async () => {
    const log = vi.spyOn(console, 'log');
    const error = vi.spyOn(console, 'error');
    const services = renderCard();
    await loaded();
    // Pasted after the name, and over the setting (which keeps 20 characters).
    await userEvent.click(screen.getByTestId(TID.grinderName));
    await userEvent.paste(` ${PASTED_KEY}`);
    await userEvent.clear(screen.getByTestId(TID.grinderSetting));
    await userEvent.paste(PASTED_KEY);
    expect(screen.getByTestId(TID.grinderSetting)).toHaveValue(PASTED_KEY.slice(0, 20));
    leave(TID.grinderSetting);

    expect(await screen.findByText(KEY_TAKEN_OUT)).toBeInTheDocument();
    expect(line()).toHaveTextContent(SAVED);
    await waitFor(() => expect(screen.getByTestId(TID.grinderName)).toHaveValue('Niche Zero'));
    expect(screen.getByTestId(TID.grinderSetting)).toHaveValue('');
    expect(await services.storage.settings.get()).toEqual({
      ...typed,
      grinderSetting: null,
      grinderId: null,
      appearance: DEFAULT_APPEARANCE,
    });
    noKeyInAnyField();
    expect(document.body.innerHTML).not.toContain(PASTED_KEY.slice(0, 20));
    for (const call of [...log.mock.calls, ...error.mock.calls]) expect(JSON.stringify(call)).not.toContain('sk-ant-api03');
  });

  it('a later save without a key clears the notice', async () => {
    renderCard();
    await loaded();
    await userEvent.clear(screen.getByTestId(TID.grinderSetting));
    await userEvent.paste(PASTED_KEY);
    leave(TID.grinderSetting);
    await screen.findByText(KEY_TAKEN_OUT);
    await userEvent.type(screen.getByTestId(TID.grinderSetting), '15');
    leave(TID.grinderSetting);
    await waitFor(() => expect(screen.queryByText(KEY_TAKEN_OUT)).toBeNull());
    expect(line()).toHaveTextContent(SAVED);
    expect(screen.getByTestId(TID.grinderSetting)).toHaveValue('15');
  });
});

describe('Settings > Grinder from Decaid', () => {
  const picker = () => screen.getByLabelText('Grinder from Decaid');
  const libraryReady = () => waitFor(() => expect(picker()).toBeEnabled());
  const options = (select: HTMLElement) => within(select).getAllByRole('option').map((option) => option.textContent);

  it("lists Decaid's grinders with their burrs, archived ones left out, plus \"Not in Decaid's list\"", async () => {
    renderCard();
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
    renderCard();
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

  it('a pick links at once: the link, the model as the name and the setting, the coach told, the workflow left alone', async () => {
    const services = renderCard();
    await libraryReady();
    await userEvent.selectOptions(picker(), 'g-niche');
    await saved();
    expect(updates(services)).toEqual([{ grinderId: 'g-niche', grinderName: 'Niche Zero', grinderSetting: '14' }]);
    await userEvent.clear(screen.getByTestId(TID.grinderSetting));
    await userEvent.type(screen.getByTestId(TID.grinderSetting), '13.5');
    leave(TID.grinderSetting);
    await waitFor(() => expect(updates(services)).toHaveLength(2));
    expect(await services.storage.settings.get()).toEqual({
      model: DEFAULT_MODEL,
      grinderName: 'Niche Zero',
      grinderSetting: '13.5',
      grinderId: 'g-niche',
      activeBagId: 'bag-1',
      appearance: DEFAULT_APPEARANCE,
    });
    expect(methods(services)).toEqual(['refresh', 'refresh']);
    expect(services.decaid.calls.map((call) => call.method)).not.toContain('updateWorkflow');
  });

  it('a preset grinder picks its setting from its list, saved at once, keeping a value Decaid does not list until then', async () => {
    const services = renderCard({ ...typed, grinderId: 'g-encore', grinderName: 'Baratza Encore ESP', grinderSetting: '14.5' });
    await libraryReady();
    expect(picker()).toHaveValue('g-encore');
    const setting = screen.getByLabelText('Current grinder setting');
    expect(setting.tagName).toBe('SELECT');
    expect(screen.queryByTestId(TID.grinderSetting)).toBeNull();
    expect(setting).toHaveValue('14.5');
    expect(options(setting)[0]).toBe("14.5 (not in Decaid's list)");
    expect(options(setting)).toHaveLength(41);
    await userEvent.selectOptions(setting, '12');
    await saved();
    expect(await services.storage.settings.get()).toMatchObject({ grinderId: 'g-encore', grinderName: 'Baratza Encore ESP', grinderSetting: '12' });
  });

  it('"Not in Decaid\'s list" unlinks at once, keeping the free-text name, and a typed name saves when left', async () => {
    const services = renderCard({ ...typed, grinderId: 'g-niche' });
    await libraryReady();
    expect(picker()).toHaveValue('g-niche');
    expect(screen.queryByTestId(TID.grinderName)).toBeNull();
    await userEvent.selectOptions(picker(), "Not in Decaid's list");
    await saved();
    expect(await services.storage.settings.get()).toMatchObject({ grinderId: null, grinderName: 'Niche Zero', grinderSetting: '14' });
    await userEvent.clear(screen.getByTestId(TID.grinderName));
    await userEvent.type(screen.getByTestId(TID.grinderName), 'DF64');
    leave(TID.grinderName);
    await waitFor(async () => expect(await services.storage.settings.get()).toMatchObject({ grinderId: null, grinderName: 'DF64', grinderSetting: '14' }));
  });

  it('keeps the link to a grinder Decaid no longer lists, saving nothing, until another is picked', async () => {
    const services = renderCard({ ...typed, grinderId: 'g-gone', grinderName: 'Old grinder' });
    await libraryReady();
    expect(picker()).toHaveValue('g-gone');
    expect(options(picker())[0]).toBe("Old grinder (no longer in Decaid's list)");
    expect(screen.getByText(MISSING_LINE)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId(TID.grinderSetting));
    leave(TID.grinderSetting);
    await act(async () => undefined);
    expect(updates(services)).toEqual([]);
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
      const services = renderCard();
      expect(await screen.findByText(LIBRARY_HINT)).toBeInTheDocument();
      expect(screen.queryByLabelText('Grinder from Decaid')).toBeNull();
      expect(screen.getByTestId(TID.grinderName)).toHaveValue('Niche Zero');
      expect(screen.getByTestId(TID.grinderSetting)).toHaveValue('14');
      await userEvent.type(screen.getByTestId(TID.grinderSetting), '{Backspace}5');
      leave(TID.grinderSetting);
      await saved();
      expect(await services.storage.settings.get()).toMatchObject({ grinderId: null, grinderName: 'Niche Zero', grinderSetting: '15' });
      expect(methods(services)).toEqual(['refresh']);
    });
  }

  for (const [why, reply] of [
    ['Decaid lists no grinders', noGrinders],
    ['Decaid has no grinder library', noLibrary],
  ] as const) {
    it(`a link to a grinder Decaid no longer lists is kept and says so when ${why}`, async () => {
      grinderReply = reply;
      const services = renderCard({ ...typed, grinderId: 'g-niche' });
      expect(await screen.findByText(MISSING_LINE)).toBeInTheDocument();
      expect(picker()).toHaveValue('g-niche');
      expect(options(picker())).toEqual(["Niche Zero (no longer in Decaid's list)", "Not in Decaid's list"]);
      expect(screen.queryByText(LIBRARY_HINT)).toBeNull();
      expect(screen.queryByTestId(TID.grinderName), 'a linked grinder is named by its link').toBeNull();
      expect(screen.getByTestId(TID.grinderSetting)).toHaveValue('14');
      await userEvent.type(screen.getByTestId(TID.grinderSetting), '{Backspace}5');
      leave(TID.grinderSetting);
      await saved();
      expect(await services.storage.settings.get()).toMatchObject({ grinderId: 'g-niche', grinderName: 'Niche Zero', grinderSetting: '15' });
      expect(methods(services)).toEqual(['refresh']);
    });
  }

  it('with Decaid listing no grinders, "Not in Decaid\'s list" unlinks the grinder and names it by hand', async () => {
    grinderReply = noGrinders;
    const services = renderCard({ ...typed, grinderId: 'g-niche' });
    await screen.findByText(MISSING_LINE);
    await userEvent.selectOptions(picker(), "Not in Decaid's list");
    expect(screen.getByText(LIBRARY_HINT)).toBeInTheDocument();
    expect(screen.getByTestId(TID.grinderName)).toHaveValue('Niche Zero');
    await userEvent.clear(screen.getByTestId(TID.grinderName));
    await userEvent.type(screen.getByTestId(TID.grinderName), 'DF64{Enter}');
    await waitFor(async () => expect(await services.storage.settings.get()).toMatchObject({ grinderId: null, grinderName: 'DF64', grinderSetting: '14' }));
  });

  it("says Decaid can't be reached for a linked grinder, and keeps the link while the name is unchanged", async () => {
    grinderReply = unreachable;
    const services = renderCard({ ...typed, grinderId: 'g-niche' });
    expect(await screen.findByText(UNREACHABLE_LINE)).toBeInTheDocument();
    expect(screen.queryByText(LIBRARY_HINT)).toBeNull();
    expect(screen.queryByLabelText('Grinder from Decaid')).toBeNull();
    expect(screen.getByTestId(TID.grinderName)).toHaveValue('Niche Zero');
    expect(screen.getByTestId(TID.grinderSetting)).toHaveValue('14');
    await userEvent.type(screen.getByTestId(TID.grinderSetting), '{Backspace}5');
    leave(TID.grinderSetting);
    await saved();
    expect(await services.storage.settings.get()).toMatchObject({ grinderId: 'g-niche', grinderName: 'Niche Zero', grinderSetting: '15' });
    expect(methods(services)).toEqual(['refresh']);
  });

  it("drops the link when the grinder is renamed while Decaid's list is out of reach", async () => {
    grinderReply = unreachable;
    const services = renderCard({ ...typed, grinderId: 'g-niche' });
    await screen.findByText(UNREACHABLE_LINE);
    await userEvent.clear(screen.getByTestId(TID.grinderName));
    await userEvent.type(screen.getByTestId(TID.grinderName), 'DF64');
    leave(TID.grinderName);
    await saved();
    expect(await services.storage.settings.get()).toMatchObject({ grinderId: null, grinderName: 'DF64' });
    // Saved unlinked, so the card speaks of a typed grinder now.
    expect(screen.getByText(LIBRARY_HINT)).toBeInTheDocument();
    expect(screen.queryByText(UNREACHABLE_LINE)).toBeNull();
  });

  it("shows a preset grinder's setting only as its list: a disabled placeholder until Decaid's list arrives", async () => {
    const later = laterReply();
    grinderReply = later.reply;
    renderCard({ ...typed, grinderId: 'g-encore', grinderName: 'Baratza Encore ESP', grinderSetting: '12' });
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
    renderCard();
    await waitFor(() => expect(screen.getByTestId(TID.grinderSetting)).toHaveValue('14'));
    expect(screen.getByTestId(TID.grinderSetting)).toBeEnabled();
    expect(picker()).toBeDisabled();
    later.send();
    await libraryReady();
    expect(screen.getByTestId(TID.grinderSetting)).toHaveValue('14');
  });

  it('a pick brings the setting and the line under the card into view, scrolling only the group’s own column', async () => {
    renderCard(typed, <GroupPage id="grinder" layout="pane" />);
    await libraryReady();
    const column = screen.getByTestId(TID.settingsPane('grinder'));
    // jsdom has no layout. At 962x602 the pane runs from the 64 px top bar to
    // the bottom of the window, and the setting and the line under the card
    // sit about 700 px down its content: below the fold.
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
});

describe('Settings > Grinder > Add a grinder (D125)', () => {
  const addTyped: Settings = { model: DEFAULT_MODEL, grinderName: 'DF64', grinderSetting: '14', activeBagId: 'bag-1' };
  const ADDED = {
    id: 'g-new',
    model: 'DF64',
    burrs: 'SSP MP',
    archived: false,
    settingType: 'numeric',
    settingSmallStep: 0.5,
    createdAt: '2026-10-11T09:00:00.000000',
    updatedAt: '2026-10-11T09:00:00.000000',
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  /** Decaid's library as the reads find it, and the bodies posted to it. */
  let library: unknown[] = [];
  let postReply: () => Response = () => json(ADDED, 201);
  const posted: unknown[] = [];

  beforeEach(() => {
    library = [];
    postReply = () => json(ADDED, 201);
    posted.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        fetched.push(url);
        if (!url.endsWith('/api/v1/grinders')) return new Response('Route not found', { status: 404 });
        if (init?.method === 'POST') {
          posted.push(JSON.parse(String(init.body)));
          return postReply();
        }
        return grinderReply();
      }),
    );
    grinderReply = () => json(library);
  });

  const addButton = () => screen.findByTestId(TID.addGrinder);

  it("adds the grinder to Decaid's library, picks it, links it at once and says so", async () => {
    const services = renderCard(addTyped);
    expect(await screen.findByText(LIBRARY_HINT)).toBeInTheDocument();
    await userEvent.click(await addButton());
    const dialog = await screen.findByRole('dialog', { name: 'Add a grinder to Decaid' });
    // It starts from the name typed in Settings.
    expect(within(dialog).getByTestId(TID.addGrinderModel)).toHaveValue('DF64');
    await userEvent.type(within(dialog).getByTestId(TID.addGrinderBurrs), 'SSP MP');
    await userEvent.type(within(dialog).getByTestId(TID.addGrinderSmallStep), '0,5');
    await userEvent.click(within(dialog).getByTestId(TID.addGrinderSubmit));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(posted).toEqual([{ model: 'DF64', burrs: 'SSP MP', settingType: 'numeric', settingSmallStep: 0.5 }]);
    expect(screen.getByLabelText('Grinder from Decaid')).toHaveValue('g-new');
    expect(screen.getByText('Decaid lists steps of 0.5 for this grinder.')).toBeInTheDocument();
    expect(screen.getByTestId(TID.addGrinderNote)).toHaveTextContent("Added DF64 (SSP MP) to Decaid's grinders, and picked it.");
    await saved();
    expect(await services.storage.settings.get()).toMatchObject({ grinderId: 'g-new', grinderName: 'DF64', grinderSetting: '14' });
    expect(methods(services)).toEqual(['refresh']);
    // The note stays until the next change.
    await userEvent.type(screen.getByTestId(TID.grinderSetting), '{Backspace}5');
    expect(screen.queryByTestId(TID.addGrinderNote)).toBeNull();
  });

  it('picks the grinder Decaid already has, read afresh, instead of adding it twice', async () => {
    const services = renderCard(addTyped);
    await userEvent.click(await addButton());
    // Another skin added it while Settings was open.
    library = GRINDERS;
    const dialog = await screen.findByRole('dialog');
    await userEvent.clear(within(dialog).getByTestId(TID.addGrinderModel));
    await userEvent.type(within(dialog).getByTestId(TID.addGrinderModel), 'niche zero');
    await userEvent.click(within(dialog).getByTestId(TID.addGrinderSubmit));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(posted).toEqual([]);
    expect(screen.getByLabelText('Grinder from Decaid')).toHaveValue('g-niche');
    expect(screen.getByTestId(TID.addGrinderNote)).toHaveTextContent('Decaid already has Niche Zero (63 mm conical), so CafAI picked it.');
    await saved();
    expect(await services.storage.settings.get()).toMatchObject({ grinderId: 'g-niche', grinderName: 'Niche Zero' });
  });

  it("says what to fix and Decaid's refusal in the dialog, and Cancel changes nothing", async () => {
    const services = renderCard({ ...addTyped, grinderName: null });
    await userEvent.click(await addButton());
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByTestId(TID.addGrinderSubmit));
    expect(within(dialog).getByText('Name the grinder, like Niche Zero.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByTestId(TID.addGrinderModel), 'Kinu M47');
    await userEvent.selectOptions(within(dialog).getByTestId(TID.addGrinderDial), 'preset');
    await userEvent.click(within(dialog).getByTestId(TID.addGrinderSubmit));
    expect(within(dialog).getByText("List the grinder's settings, finest first, with commas between them.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByTestId(TID.addGrinderSettings), '1, 2, 3');
    postReply = () => json({ error: 'Exception: database is locked' }, 400);
    await userEvent.click(within(dialog).getByTestId(TID.addGrinderSubmit));
    expect(await within(dialog).findByText("Couldn't add the grinder: database is locked")).toBeInTheDocument();
    expect(posted).toEqual([{ model: 'Kinu M47', settingType: 'preset', settingValues: ['1', '2', '3'] }]);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByLabelText('Grinder from Decaid')).toBeNull();
    expect(screen.queryByTestId(TID.addGrinderNote)).toBeNull();
    expect(methods(services)).toEqual([]);
    expect(updates(services)).toEqual([]);
  });

  for (const [why, reply] of [
    ['Decaid cannot be reached', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['Decaid sent a list CafAI cannot read', () => Promise.resolve(json(null))],
    ['Decaid is too old to have a grinder library', () => Promise.resolve(new Response('Route not found', { status: 404 }))],
  ] as const) {
    it(`offers no Add when ${why}`, async () => {
      grinderReply = reply;
      renderCard(addTyped);
      expect(await screen.findByText(LIBRARY_HINT)).toBeInTheDocument();
      expect(screen.queryByTestId(TID.addGrinder)).toBeNull();
    });
  }

  it("links to DYE2's Grinders page only while Decaid runs DYE2", async () => {
    const services = renderCard(addTyped);
    await addButton();
    expect(screen.queryByTestId(TID.editGrindersInDye2)).toBeNull();
    act(() => services.plugins.setLoaded(['dye2.reaplugin']));
    expect(screen.getByTestId(TID.editGrindersInDye2)).toHaveAttribute('href', 'http://localhost:8080/api/v1/plugins/dye2.reaplugin/grinders');
    act(() => services.plugins.setLoaded([]));
    expect(screen.queryByTestId(TID.editGrindersInDye2)).toBeNull();
  });

  it("typing Enter in the dialog's fields saves nothing of the card's", async () => {
    const services = renderCard(addTyped);
    await userEvent.click(await addButton());
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(within(dialog).getByTestId(TID.addGrinderBurrs), { key: 'Enter' });
    await act(async () => undefined);
    expect(updates(services)).toEqual([]);
  });
});
