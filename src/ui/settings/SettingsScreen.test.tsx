// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CoachState } from '../../app/types.ts';
import type { Settings } from '../../storage/types.ts';
import { createFakeServices, type FakeServices } from '../testing/fakeServices.ts';
import { TID } from '../testIds.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { SettingsScreen } from './SettingsScreen.tsx';

const SECRET = 'sk-ant-api03-very-secret-value';

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
