// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { applySettingsPatch, normalizeSettings } from '../../storage/settings.ts';
import type { Settings } from '../../storage/types.ts';
import { createFakeServices, type FakeServices } from '../testing/fakeServices.ts';
import { TID } from '../testIds.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { MODEL_CARD_TITLE, ModelCard } from './ModelCard.tsx';
import { KEY_TAKEN_OUT, SAVED } from './SaveLine.tsx';

const DEFAULT_MODEL = 'claude-opus-5-5';
/** A made-up key, built at run time so no key-shaped literal sits in the source. */
const PASTED_KEY = ['sk', 'ant', 'api03', 'mOdElCaRdTeSt0123456789', 'AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789AA'].join('-');
const BASE: Settings = { model: DEFAULT_MODEL, grinderName: 'Niche Zero', grinderSetting: '14', activeBagId: 'bag-1' };

/** The card over a settings store that keeps what CafAI's storage would (src/storage/settings.ts). */
function renderCard(settings: Settings = BASE) {
  const services: FakeServices = createFakeServices({ storage: { settings } });
  let stored = normalizeSettings(settings, DEFAULT_MODEL);
  services.storage.settings = {
    get: async () => stored,
    update: vi.fn(async (patch: Partial<Settings>) => (stored = applySettingsPatch(stored, patch, DEFAULT_MODEL))),
  };
  renderWithServices(<ModelCard />, services);
  return services;
}

const model = () => screen.getByTestId(TID.modelSelect);
const line = () => screen.getByTestId(TID.settingsSaved('model'));
const methods = (services: FakeServices) => services.coach.calls.map((c) => c.method);
/** Another model the fakes offer than the one saved: the catalog changes, the test does not. */
const another = (services: FakeServices) => services.models.find((each) => each.id !== DEFAULT_MODEL)!;

describe('Settings > Coach > Model and replies', () => {
  it('loads the stored model, lists each with its price, and says what the chosen one suits and costs', async () => {
    const services = renderCard();
    expect(screen.getByRole('region', { name: MODEL_CARD_TITLE })).toBeInTheDocument();
    await waitFor(() => expect(model()).toHaveValue(DEFAULT_MODEL));
    expect(within(model()).getAllByRole('option').map((o) => o.textContent)).toEqual(
      services.models.map((each) => `${each.label} · $${each.inputPerMTok} / $${each.outputPerMTok} per MTok`),
    );
    const chosen = services.models.find((each) => each.id === DEFAULT_MODEL)!;
    expect(model()).toHaveAccessibleDescription(`${chosen.note} $${chosen.inputPerMTok} in / $${chosen.outputPerMTok} out per million tokens.`);
  });

  it('has no Save: a model picked is saved at once, the coach re-reads it, and the line says so', async () => {
    const services = renderCard();
    await waitFor(() => expect(model()).toBeEnabled());
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    expect(line()).toHaveTextContent('');
    const next = another(services);
    await userEvent.selectOptions(model(), next.id);
    await waitFor(() => expect(line()).toHaveTextContent(SAVED));
    expect(await services.storage.settings.get()).toMatchObject({ model: next.id, grinderName: 'Niche Zero', grinderSetting: '14' });
    // Fun facts were never chosen here, so a model's save writes no choice for them (D198).
    expect(services.storage.settings.update).toHaveBeenCalledWith({ model: next.id });
    expect(methods(services)).toEqual(['refresh']);
    expect(screen.queryByText(KEY_TAKEN_OUT)).toBeNull();
  });

  it('a save that fails says why in the error colour, keeps the pick on screen, and the next one that saves carries it', async () => {
    const services = renderCard();
    await waitFor(() => expect(model()).toBeEnabled());
    const update = services.storage.settings.update as ReturnType<typeof vi.fn>;
    update.mockRejectedValueOnce(new Error('disk full'));
    const next = another(services);
    await userEvent.selectOptions(model(), next.id);
    await waitFor(() => expect(line()).toHaveTextContent('Could not save the model and fun facts: disk full. Try again.'));
    expect(line()).toHaveStyle({ color: 'rgb(244, 123, 116)' });
    expect(model()).toHaveValue(next.id);
    expect(methods(services)).toEqual([]);

    await userEvent.selectOptions(screen.getByTestId(TID.funFacts), 'off');
    await waitFor(() => expect(line()).toHaveTextContent(SAVED));
    expect(await services.storage.settings.get()).toMatchObject({ model: next.id, funFacts: 'off' });
  });

  it('How the coach replies says "Saved." in the line under the card too, as the model does (D234)', async () => {
    const services = renderCard();
    await waitFor(() => expect(screen.getByTestId(TID.coachEffort('medium'))).toHaveAttribute('aria-pressed', 'true'));
    expect(line()).toHaveTextContent('');
    await userEvent.click(screen.getByTestId(TID.coachEffort('high')));
    await waitFor(() => expect(line()).toHaveTextContent(SAVED));
    expect(await services.storage.settings.get()).toMatchObject({ coachEffort: 'high', model: DEFAULT_MODEL });
  });

  it('leaves the line on a change of the card that did not save: How the coach replies saved alone, not carrying it', async () => {
    const services = renderCard();
    await waitFor(() => expect(model()).toBeEnabled());
    (services.storage.settings.update as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('disk full'));
    await userEvent.selectOptions(screen.getByTestId(TID.funFacts), 'off');
    await waitFor(() => expect(line()).toHaveTextContent('Could not save the model and fun facts: disk full. Try again.'));
    await userEvent.click(screen.getByTestId(TID.coachEffort('high')));
    await waitFor(async () => expect((await services.storage.settings.get()).coachEffort).toBe('high'));
    expect(line()).toHaveTextContent('Could not save the model and fun facts: disk full. Try again.');
  });

  it('keeps a model this build no longer offers, listed as such, until another is picked', async () => {
    const services = renderCard({ ...BASE, model: 'claude-sonnet-4' });
    await waitFor(() => expect(model()).toHaveValue('claude-sonnet-4'));
    expect(within(model()).getAllByRole('option')[0]).toHaveTextContent('claude-sonnet-4 (no longer offered)');
    expect(services.storage.settings.update).not.toHaveBeenCalled();
  });

  it('never saves a key as the model: the default model is used, and the card says why (D37)', async () => {
    const services = renderCard({ ...BASE, model: 'claude-fable-5-1' });
    await waitFor(() => expect(model()).toHaveValue('claude-fable-5-1'));
    // The model is a list, so only a crafted value can carry a key: plant one.
    const planted = document.createElement('option');
    planted.value = PASTED_KEY;
    planted.textContent = 'Planted';
    model().appendChild(planted);
    await userEvent.selectOptions(model(), PASTED_KEY);
    planted.remove();

    expect(await screen.findByText(KEY_TAKEN_OUT)).toBeInTheDocument();
    expect(KEY_TAKEN_OUT).toBe('That looked like an API key, so CafAI took it out. Keys go in Settings > Coach.');
    expect(model()).toHaveValue(DEFAULT_MODEL);
    expect(await services.storage.settings.get()).toMatchObject({ model: DEFAULT_MODEL, grinderName: 'Niche Zero', grinderSetting: '14' });
    for (const field of document.querySelectorAll('input, select')) expect((field as HTMLInputElement).value).not.toContain('sk-ant-');
    expect(document.body.innerHTML).not.toContain(PASTED_KEY);
  });

  it('a later save without a key clears the notice', async () => {
    const services = renderCard();
    await waitFor(() => expect(model()).toBeEnabled());
    const planted = document.createElement('option');
    planted.value = PASTED_KEY;
    model().appendChild(planted);
    await userEvent.selectOptions(model(), PASTED_KEY);
    planted.remove();
    await screen.findByText(KEY_TAKEN_OUT);
    await userEvent.selectOptions(model(), another(services).id);
    await waitFor(() => expect(screen.queryByText(KEY_TAKEN_OUT)).toBeNull());
    expect(line()).toHaveTextContent(SAVED);
  });

  it('says why when the settings cannot be read, and holds the controls', async () => {
    const services: FakeServices = createFakeServices();
    services.storage.settings = { get: async () => Promise.reject(new Error('blocked')), update: vi.fn() };
    renderWithServices(<ModelCard />, services);
    await waitFor(() => expect(line()).toHaveTextContent('Could not read the settings: blocked'));
    expect(model()).toBeDisabled();
    expect(screen.getByTestId(TID.funFacts)).toBeDisabled();
  });
});
