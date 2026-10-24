// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CoachState } from '../../app/types.ts';
import { applySettingsPatch, normalizeSettings } from '../../storage/settings.ts';
import type { Settings } from '../../storage/types.ts';
import { createFakeServices, createFakeUsage, type FakeServices } from '../testing/fakeServices.ts';
import { TID } from '../testIds.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { ApiKeySection } from './ApiKeySection.tsx';

const SECRET = 'sk-ant-api03-very-secret-value';
const DEFAULT_MODEL = 'claude-opus-5-5';

function renderKey(options: { coach?: Partial<CoachState>; settings?: Settings; key?: string } = {}) {
  const services: FakeServices = createFakeServices({ coach: options.coach, storage: options.settings ? { settings: options.settings } : {} });
  // CafAI's storage reads and writes every record through the settings rules (src/storage/repositories.ts).
  let stored = normalizeSettings(options.settings, DEFAULT_MODEL);
  services.storage.settings = {
    get: async () => stored,
    update: async (patch) => (stored = applySettingsPatch(stored, patch, DEFAULT_MODEL)),
  };
  if (options.key) services.storage.apiKey = options.key;
  renderWithServices(<ApiKeySection />, services);
  return services;
}

const methods = (services: FakeServices) => services.coach.calls.map((c) => c.method);

describe('Settings > Coach > Anthropic API key', () => {
  it('saves the key, refreshes the coach, and never shows the key again', async () => {
    const log = vi.spyOn(console, 'log');
    const error = vi.spyOn(console, 'error');
    const services = renderKey({ coach: { hasApiKey: false } });
    expect(screen.getByRole('region', { name: 'Anthropic API key' })).toBeInTheDocument();
    expect(screen.getByText('No key saved yet. The coach needs one to work.')).toBeInTheDocument();
    // A phone keeps its own key too: the copy says "this device", never "this tablet".
    expect(screen.getByText('The key stays on this device unless you keep a copy in Decaid (below). It is never included in exports.')).toBeInTheDocument();
    const input = screen.getByTestId(TID.apiKeyInput);
    expect(input).toHaveAttribute('type', 'password');
    expect(screen.getByTestId(TID.apiKeySave)).toBeDisabled();

    await userEvent.type(input, `  ${SECRET}  `);
    await userEvent.click(screen.getByTestId(TID.apiKeySave));

    await waitFor(() => expect(services.storage.apiKey).toBe(SECRET));
    expect(await screen.findByText('A key is saved on this device.')).toBeInTheDocument();
    expect(screen.getByText('Key saved on this device.')).toBeInTheDocument();
    expect(methods(services)).toContain('refresh');
    expect(screen.getByTestId(TID.apiKeyInput)).toHaveValue('');
    expect(document.body.innerHTML).not.toContain(SECRET);
    for (const field of document.querySelectorAll('input')) expect(field.value).not.toContain(SECRET);
    for (const call of [...log.mock.calls, ...error.mock.calls]) expect(JSON.stringify(call)).not.toContain(SECRET);
  });

  it('keeps the key field out of Clarity, shown or hidden, and counts a saved key (D213, D214)', async () => {
    const services = renderKey({ coach: { hasApiKey: false } });
    const { usage, tracked } = createFakeUsage();
    // The card reads the services again at every render: the next keystroke sees it.
    services.usage = usage;
    expect(screen.getByTestId(TID.apiKeyInput)).toHaveAttribute('data-private', 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Show key' }));
    expect(screen.getByTestId(TID.apiKeyInput)).toHaveAttribute('type', 'text');
    expect(screen.getByTestId(TID.apiKeyInput)).toHaveAttribute('data-private', 'secret');
    await userEvent.type(screen.getByTestId(TID.apiKeyInput), SECRET);
    await userEvent.click(screen.getByTestId(TID.apiKeySave));
    await waitFor(() => expect(tracked).toEqual(['coach_setup']));
  });

  it('shows and hides what is being typed', async () => {
    renderKey({ coach: { hasApiKey: false } });
    const input = screen.getByTestId(TID.apiKeyInput);
    await userEvent.click(screen.getByRole('button', { name: 'Show key' }));
    expect(input).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Hide key' }));
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'off');
  });

  it('forgets the key only after a confirmation', async () => {
    const services = renderKey({ coach: { hasApiKey: true }, key: SECRET });
    expect(screen.getByText('A key is saved on this device.')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId(TID.forgetKey));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('The coach stops working on this device until you add a key again.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    expect(services.storage.apiKey).toBe(SECRET);

    await userEvent.click(screen.getByTestId(TID.forgetKey));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Forget key' }));
    await waitFor(() => expect(services.storage.apiKey).toBeNull());
    expect(await screen.findByText('No key saved yet. The coach needs one to work.')).toBeInTheDocument();
    expect(screen.getByText('The key is gone from this device.')).toBeInTheDocument();
    expect(methods(services)).toEqual(['refresh']);
    expect(screen.queryByTestId(TID.forgetKey)).toBeNull();
  });
});

describe('Settings > Coach > the key in Decaid (5.6, D99)', () => {
  const sentence =
    "So you do not have to paste it again after a Decaid update. Any device on your network can read Decaid's store, and Decaid's backups include it.";
  const withChoice = (keepKeyInDecaid: boolean) => ({
    model: DEFAULT_MODEL,
    grinderName: null,
    grinderSetting: null,
    activeBagId: null,
    keepKeyInDecaid,
  });

  it('is off by default, with the reason underneath, once a key exists', async () => {
    renderKey();
    const toggle = await screen.findByTestId(TID.keyInDecaid);
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeEnabled();
    expect(screen.getByText(sentence)).toBeInTheDocument();
  });

  it('disables the switch, with a short reason, when there is no key yet', async () => {
    renderKey({ coach: { hasApiKey: false } });
    const toggle = await screen.findByTestId(TID.keyInDecaid);
    expect(toggle).toBeDisabled();
    expect(screen.getByText('Add a key above before turning this on.')).toBeInTheDocument();
    expect(screen.queryByText(sentence)).toBeNull();
  });

  it('on copies the key to Decaid and stores the choice', async () => {
    const services = renderKey();
    const setOn = vi.spyOn(services.storage.keyBackup, 'setOn');
    const toggle = await screen.findByTestId(TID.keyInDecaid);
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(setOn).toHaveBeenCalledWith(true);
    expect((await services.storage.settings.get()).keepKeyInDecaid).toBe(true);
  });

  it('off deletes the copy in Decaid and stores the choice', async () => {
    const services = renderKey({ settings: withChoice(true) });
    const setOn = vi.spyOn(services.storage.keyBackup, 'setOn');
    const toggle = await screen.findByTestId(TID.keyInDecaid);
    await waitFor(() => expect(toggle).toBeChecked());

    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(setOn).toHaveBeenCalledWith(false);
    expect((await services.storage.settings.get()).keepKeyInDecaid).toBe(false);
  });

  it('a toggle that cannot reach Decaid reverts and says so', async () => {
    const services = renderKey();
    vi.spyOn(services.storage.keyBackup, 'setOn').mockRejectedValue(new Error('Decaid is not answering.'));
    const toggle = await screen.findByTestId(TID.keyInDecaid);
    await userEvent.click(toggle);
    expect(await screen.findByText('Could not reach Decaid: Decaid is not answering.')).toBeInTheDocument();
    expect(toggle).not.toBeChecked();
    // Nothing went through, so nothing was chosen: still unset, which reads as off.
    expect((await services.storage.settings.get()).keepKeyInDecaid).toBeUndefined();
  });

  it('saving a new key copies it to Decaid while the choice is on', async () => {
    const services = renderKey({ coach: { hasApiKey: false }, settings: withChoice(true) });
    const saveKey = vi.spyOn(services.storage.keyBackup, 'saveKey');
    await screen.findByTestId(TID.keyInDecaid);

    await userEvent.type(screen.getByTestId(TID.apiKeyInput), SECRET);
    await userEvent.click(screen.getByTestId(TID.apiKeySave));
    await waitFor(() => expect(services.storage.apiKey).toBe(SECRET));
    expect(saveKey).toHaveBeenCalledWith(SECRET, true);
    expect(screen.getByText('Key saved on this device.')).toBeInTheDocument();
  });

  it('saving a key while the choice is off keeps it on this device only', async () => {
    const services = renderKey({ coach: { hasApiKey: false }, settings: withChoice(false) });
    const saveKey = vi.spyOn(services.storage.keyBackup, 'saveKey');
    await screen.findByTestId(TID.keyInDecaid);

    await userEvent.type(screen.getByTestId(TID.apiKeyInput), SECRET);
    await userEvent.click(screen.getByTestId(TID.apiKeySave));
    await waitFor(() => expect(services.storage.apiKey).toBe(SECRET));
    expect(saveKey).toHaveBeenCalledWith(SECRET, false);
  });

  it('a save that cannot reach Decaid still keeps the key here, and says the copy follows when Decaid is back', async () => {
    const services = renderKey({ coach: { hasApiKey: false }, settings: withChoice(true) });
    vi.spyOn(services.storage.keyBackup, 'saveKey').mockImplementation(async (key) => {
      services.storage.apiKey = key;
      return false;
    });
    await screen.findByTestId(TID.keyInDecaid);

    await userEvent.type(screen.getByTestId(TID.apiKeyInput), SECRET);
    await userEvent.click(screen.getByTestId(TID.apiKeySave));
    await waitFor(() => expect(services.storage.apiKey).toBe(SECRET));
    expect(
      await screen.findByText("Key saved on this device. Decaid can't be reached right now, so CafAI will copy it there as soon as it can."),
    ).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it('forgetting the key while the choice is on deletes the copy, and leaves the choice on for the next key', async () => {
    const services = renderKey({ settings: withChoice(true), key: SECRET });
    const forgetKey = vi.spyOn(services.storage.keyBackup, 'forgetKey');
    const toggle = await screen.findByTestId(TID.keyInDecaid);
    await waitFor(() => expect(toggle).toBeChecked());

    await userEvent.click(screen.getByTestId(TID.forgetKey));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Forget key' }));
    await waitFor(() => expect(services.storage.apiKey).toBeNull());
    expect(forgetKey).toHaveBeenCalledWith(true);
    expect(screen.getByText('The key is gone from this device.')).toBeInTheDocument();
    // Still on, so the next key saved here is copied again; and it can still be turned off.
    expect(screen.getByTestId(TID.keyInDecaid)).toBeChecked();
    expect(screen.getByTestId(TID.keyInDecaid)).toBeEnabled();
    expect(screen.getByText(sentence)).toBeInTheDocument();
  });

  it("forgetting the key when Decaid can't be reached says its copy goes later, and the switch still turns off without a key", async () => {
    const services = renderKey({ settings: withChoice(true), key: SECRET });
    vi.spyOn(services.storage.keyBackup, 'forgetKey').mockImplementation(async () => {
      services.storage.apiKey = null;
      return false;
    });
    const setOn = vi.spyOn(services.storage.keyBackup, 'setOn');
    const toggle = await screen.findByTestId(TID.keyInDecaid);
    await waitFor(() => expect(toggle).toBeChecked());

    await userEvent.click(screen.getByTestId(TID.forgetKey));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Forget key' }));
    await waitFor(() => expect(services.storage.apiKey).toBeNull());
    expect(
      await screen.findByText(
        "The key is gone from this device. Decaid can't be reached right now, so CafAI will delete its copy there as soon as it can.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/turn Keep my API key in Decaid off/)).toBeNull();

    // No key here, but a choice that is on can be turned off: Decaid's copy goes, and the switch waits for a key.
    expect(toggle).toBeChecked();
    expect(toggle).toBeEnabled();
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(setOn).toHaveBeenCalledWith(false);
    expect((await services.storage.settings.get()).keepKeyInDecaid).toBe(false);
    expect(toggle).toBeDisabled();
    expect(screen.getByText('Add a key above before turning this on.')).toBeInTheDocument();
  });

  it("keeps MUI's switch size, with the label row around it as the 48 px touch target", async () => {
    renderKey();
    const toggle = await screen.findByTestId(TID.keyInDecaid);
    expect(getComputedStyle(toggle.closest('label')!).minHeight).toBe('48px');
    expect(getComputedStyle(toggle.closest('.MuiSwitch-root')!).padding).toBe('12px');
  });
});
