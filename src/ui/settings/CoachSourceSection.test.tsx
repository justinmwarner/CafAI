// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { createMemoryCoachSourceStore, type CoachSource } from '../../storage/coachSource.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { createFakeServices, createFakeUsage, type FakeServices } from '../testing/fakeServices.ts';
import { TID } from '../testIds.ts';
import { CoachSourceSection } from './CoachSourceSection.tsx';
import { SettingsScreen } from './SettingsScreen.tsx';

/** GET /v1/status?probe=1 from a bridge that is ready. */
const STATUS = {
  ok: true,
  app: 'cafai-bridge',
  version: '0.1.0',
  protocol: 1,
  claude: { found: true, version: '2.1.251' },
  account: { loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' },
  usage: { status: 'allowed', fiveHour: { utilization: 0.08, resetsAt: '2026-10-11T18:00:00.000Z' } },
  runs: { live: 0, max: 3 },
  problems: [],
  probe: { ok: true, ms: 2400, model: 'claude-opus-5-5' },
};
const HEALTH = { ok: true, app: 'cafai-bridge', version: '0.1.0', protocol: 1 };
const SAVED: CoachSource = { kind: 'computer', address: '192.168.1.20:8877', code: 'ABCDEFGH' };
const CONNECTED = 'Connected. Claude Code 2.1.251, signed in with Claude Max. 8% of the 5-hour limit used.';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

// The bridge answers on 127.0.0.1 and 192.168.1.20; nothing else does (no test may reach a real network).
let bridge: (url: string) => Response | Promise<Response>;
const fetched: Array<{ url: string; headers: unknown }> = [];

beforeEach(() => {
  bridge = (url) => (url.endsWith('/health') ? json(HEALTH) : json(STATUS));
  fetched.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetched.push({ url, headers: init?.headers });
      if (/^http:\/\/(127\.0\.0\.1|192\.168\.1\.20):8877\//.test(url)) return bridge(url);
      return new Response('Route not found', { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderSection(source: Partial<CoachSource> = {}, ui: ReactElement = <CoachSourceSection />) {
  const services: FakeServices = createFakeServices();
  const store = createMemoryCoachSourceStore(source);
  services.coachSource = store;
  renderWithServices(ui, services);
  return { services, store };
}

const refreshes = (services: FakeServices) => services.coach.calls.filter((call) => call.method === 'refresh').length;
const bridgeCalls = () => fetched.filter((call) => call.url.includes(':8877/'));

describe('CoachSourceSection', () => {
  it('shows nothing without the store: the coach runs on Anthropic', () => {
    renderWithServices(<CoachSourceSection />);
    expect(screen.queryByRole('region', { name: 'Where the coach runs' })).not.toBeInTheDocument();
  });

  it('offers the API key, chosen by default, and Claude on the computer', async () => {
    renderSection();
    await waitFor(() => expect(screen.getByTestId(TID.coachSourceAnthropic)).toBeChecked());
    expect(screen.getByRole('radio', { name: 'Anthropic API key' })).toHaveAccessibleDescription('Billed per use to your key.');
    expect(screen.getByRole('radio', { name: 'Claude on my computer' })).toHaveAccessibleDescription(
      'Uses your Claude Pro or Max plan through Claude Code. Run CafAI Bridge on your Mac or PC.',
    );
    expect(screen.getByTestId(TID.coachSourceComputer)).not.toBeChecked();
    expect(screen.queryByTestId(TID.computerAddress)).not.toBeInTheDocument();
  });

  it('switches at once, refreshes the coach, and keeps the address and code for the way back', async () => {
    const { services, store } = renderSection({ address: SAVED.address, code: SAVED.code });
    await userEvent.click(await screen.findByTestId(TID.coachSourceComputer));

    await waitFor(() => expect(screen.getByTestId(TID.coachSourceComputer)).toBeChecked());
    await waitFor(() => expect(refreshes(services)).toBe(1));
    expect(await store.get()).toEqual(SAVED);
    expect(screen.getByText("On that computer, run npm run bridge in CafAI's folder (see bridge/README.md).")).toBeInTheDocument();
    expect(screen.getByTestId(TID.computerAddress)).toHaveValue('192.168.1.20:8877');
    expect(screen.getByTestId(TID.computerCode)).toHaveValue('ABCD-EFGH');

    await userEvent.click(screen.getByTestId(TID.coachSourceAnthropic));
    await waitFor(() => expect(screen.getByTestId(TID.coachSourceAnthropic)).toBeChecked());
    await waitFor(() => expect(refreshes(services)).toBe(2));
    expect(await store.get()).toEqual({ ...SAVED, kind: 'anthropic' });
    expect(screen.queryByTestId(TID.computerAddress)).not.toBeInTheDocument();
  });

  it('does not wait for a busy coach: the section is free again once the choice is saved', async () => {
    const { services } = renderSection(SAVED);
    // The engine is in the middle of a turn: its refresh waits behind it.
    services.coach.refresh = () => new Promise<void>(() => undefined);
    await userEvent.click(await screen.findByTestId(TID.coachSourceAnthropic));
    await waitFor(() => expect(screen.getByTestId(TID.coachSourceAnthropic)).toBeChecked());
    await waitFor(() => expect(screen.getByTestId(TID.coachSourceComputer)).toBeEnabled());
    await userEvent.click(screen.getByTestId(TID.coachSourceComputer));
    await waitFor(() => expect(screen.getByTestId(TID.computerSave)).toBeEnabled());
  });

  it('hides the code like the API key until it is shown', async () => {
    renderSection(SAVED);
    const field = await screen.findByTestId(TID.computerCode);
    await waitFor(() => expect(field).toHaveValue('ABCD-EFGH'));
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveAttribute('autocomplete', 'off');
    await userEvent.click(screen.getByRole('button', { name: 'Show code' }));
    expect(field).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Hide code' }));
    expect(field).toHaveAttribute('type', 'password');
  });

  it('keeps the code field out of Clarity and counts a saved bridge (D-USAGE-4, D-USAGE-5)', async () => {
    const { services } = renderSection({ kind: 'computer' });
    const { usage, tracked } = createFakeUsage();
    // The form reads the services again at every render: the next keystroke sees it.
    services.usage = usage;
    const code = await screen.findByTestId(TID.computerCode);
    expect(code).toHaveAttribute('data-private', 'secret');
    await userEvent.type(screen.getByTestId(TID.computerAddress), '192.168.1.20');
    await userEvent.type(code, 'abcd efgh');
    await userEvent.click(screen.getByTestId(TID.computerSave));
    expect(await screen.findByText('Saved on this device.')).toBeInTheDocument();
    expect(tracked).toEqual(['coach_setup']);
  });

  it('saves the address and the code as the bridge needs them, and shows what was saved', async () => {
    const { services, store } = renderSection({ kind: 'computer' });
    await userEvent.type(await screen.findByTestId(TID.computerAddress), ' http://192.168.1.20/ ');
    await userEvent.type(screen.getByTestId(TID.computerCode), 'abcd efgh');
    await userEvent.click(screen.getByTestId(TID.computerSave));

    expect(await screen.findByText('Saved on this device.')).toBeInTheDocument();
    expect(await store.get()).toEqual(SAVED);
    expect(screen.getByTestId(TID.computerAddress)).toHaveValue('192.168.1.20:8877');
    expect(screen.getByTestId(TID.computerCode)).toHaveValue('ABCD-EFGH');
    await waitFor(() => expect(refreshes(services)).toBe(1));
  });

  it('says what is wrong with the address or the code, and saves nothing', async () => {
    const { services, store } = renderSection({ kind: 'computer' });
    await userEvent.type(await screen.findByTestId(TID.computerAddress), '192.168.1.20/v1/messages');
    await userEvent.type(screen.getByTestId(TID.computerCode), 'ABC');
    await userEvent.click(screen.getByTestId(TID.computerSave));

    expect(await screen.findByText('Type only the address CafAI Bridge shows, for example 192.168.1.20 or 192.168.1.20:8877.')).toBeInTheDocument();
    expect(screen.getByText('The code is 8 letters and digits, for example ABCD-EFGH.')).toBeInTheDocument();
    expect(screen.getByTestId(TID.computerAddress)).toHaveAttribute('aria-invalid', 'true');
    expect(await store.get()).toEqual({ kind: 'computer', address: '', code: '' });
    expect(refreshes(services)).toBe(0);
    expect(bridgeCalls()).toHaveLength(0);
  });

  it('Test asks the bridge for its status and a test reply on the coach model, and says it is connected', async () => {
    const { services } = renderSection(SAVED);
    const model = (await services.storage.settings.get()).model;
    await userEvent.click(await screen.findByTestId(TID.computerTest));

    expect(await screen.findByTestId(TID.computerStatus)).toHaveTextContent(CONNECTED);
    expect(bridgeCalls()).toEqual([
      { url: `http://192.168.1.20:8877/v1/status?probe=1&model=${encodeURIComponent(model)}`, headers: { 'x-api-key': 'ABCDEFGH' } },
    ]);
    expect(screen.getByTestId(TID.computerStatus)).not.toHaveTextContent('Save');
  });

  it('Test before Save says the coach does not use it yet', async () => {
    renderSection({ kind: 'computer' });
    await userEvent.type(await screen.findByTestId(TID.computerAddress), '192.168.1.20');
    await userEvent.type(screen.getByTestId(TID.computerCode), 'ABCD-EFGH');
    await userEvent.click(screen.getByTestId(TID.computerTest));
    expect(await screen.findByTestId(TID.computerStatus)).toHaveTextContent(`${CONNECTED} Tap Save to use it.`);
  });

  it("Test shows the bridge's problems as they are", async () => {
    const tooOld =
      'Claude Code on your computer is too old for claude-opus-5-5 (it needs 2.1.280 or newer). Run claude update there, or update the Claude desktop app, then try again.';
    bridge = () => json({ ...STATUS, problems: [tooOld], probe: { ok: false, error: tooOld } });
    renderSection(SAVED);
    await userEvent.click(await screen.findByTestId(TID.computerTest));
    expect(await screen.findByTestId(TID.computerStatus)).toHaveTextContent(tooOld);
    expect(screen.getByTestId(TID.computerStatus).textContent).toBe(tooOld);
  });

  it('Test says when the bridge cannot be reached, naming the address', async () => {
    bridge = () => Promise.reject(new TypeError('Failed to fetch'));
    renderSection(SAVED);
    await userEvent.click(await screen.findByTestId(TID.computerTest));
    const status = await screen.findByTestId(TID.computerStatus);
    await waitFor(() =>
      expect(status).toHaveTextContent(
        'Could not reach CafAI Bridge at 192.168.1.20:8877. Check it is running on your computer and that this device is on the same network.',
      ),
    );
  });

  it('Test never shows the code, even from a server that echoes it back', async () => {
    bridge = () => json({ type: 'error', error: { type: 'authentication_error', message: 'Code ABCD-EFGH is not ABCDEFGH.' } }, 401);
    renderSection(SAVED);
    await userEvent.click(await screen.findByTestId(TID.computerTest));
    await waitFor(() => expect(screen.getByTestId(TID.computerStatus)).toHaveTextContent('Code [key] is not [key].'));
  });

  it("Test shows a wrong code in the bridge's own words", async () => {
    const sentence = 'CafAI Bridge did not accept that code. Check the code it shows on your computer.';
    bridge = () => json({ type: 'error', error: { type: 'authentication_error', message: sentence } }, 401);
    renderSection(SAVED);
    await userEvent.click(await screen.findByTestId(TID.computerTest));
    await waitFor(() => expect(screen.getByTestId(TID.computerStatus)).toHaveTextContent(sentence));
  });

  it('Find fills in 127.0.0.1 when a bridge answers on this device', async () => {
    renderSection({ kind: 'computer' });
    await userEvent.click(await screen.findByTestId(TID.computerFind));
    expect(await screen.findByText('Found CafAI Bridge on this device. Type the code it shows, then tap Save.')).toBeInTheDocument();
    expect(screen.getByTestId(TID.computerAddress)).toHaveValue('127.0.0.1');
    expect(bridgeCalls()).toEqual([{ url: 'http://127.0.0.1:8877/health', headers: {} }]);
  });

  it('Find says to type the address when no bridge answers on this device', async () => {
    bridge = () => Promise.reject(new TypeError('Failed to fetch'));
    renderSection({ kind: 'computer', address: '10.0.0.7' });
    await userEvent.click(await screen.findByTestId(TID.computerFind));
    expect(
      await screen.findByText('Did not find CafAI Bridge on this device. Type the address it shows on your computer.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId(TID.computerAddress)).toHaveValue('10.0.0.7');
  });

  it('says so when where the coach runs cannot be saved', async () => {
    const { store } = renderSection();
    store.set = () => Promise.reject(new Error('Could not save where the coach runs on this device. Try again.'));
    await userEvent.click(await screen.findByTestId(TID.coachSourceComputer));
    expect(await screen.findByText('Could not save where the coach runs on this device. Try again.')).toBeInTheDocument();
    expect(screen.getByTestId(TID.coachSourceAnthropic)).toBeChecked();
  });
});

describe('SettingsScreen with the coach on the computer', () => {
  const keyRegion = () => screen.queryByRole('region', { name: 'Anthropic API key' });

  it("puts the choice above the API key, and swaps the key's field for the bridge's with the choice (D140)", async () => {
    renderSection({}, <SettingsScreen />);
    // The key shows once the choice is read as Anthropic.
    await screen.findByRole('region', { name: 'Anthropic API key' });
    const titles = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'));
    expect(titles.indexOf('Where the coach runs')).toBe(titles.indexOf('Anthropic API key') - 1);
    const priceNote = 'The prices do not apply while the coach runs on your computer: it uses your Claude plan.';
    expect(screen.getByTestId(TID.apiKeyInput)).toBeInTheDocument();
    expect(screen.queryByTestId(TID.computerAddress)).not.toBeInTheDocument();

    await userEvent.click(await screen.findByTestId(TID.coachSourceComputer));
    await waitFor(() => expect(keyRegion()).not.toBeInTheDocument());
    expect(screen.queryByTestId(TID.apiKeyInput)).not.toBeInTheDocument();
    expect(screen.getByTestId(TID.computerAddress)).toBeInTheDocument();
    expect(screen.getByTestId(TID.computerCode)).toBeInTheDocument();
    expect(screen.getByText(priceNote)).toBeInTheDocument();

    await userEvent.click(screen.getByTestId(TID.coachSourceAnthropic));
    expect(await screen.findByRole('region', { name: 'Anthropic API key' })).toBeInTheDocument();
    expect(screen.getByTestId(TID.apiKeyInput)).toBeInTheDocument();
    expect(screen.queryByTestId(TID.computerAddress)).not.toBeInTheDocument();
    expect(screen.queryByText(priceNote)).not.toBeInTheDocument();
  });

  it('reads the saved choice when the screen opens, and never shows the key meanwhile', async () => {
    renderSection(SAVED, <SettingsScreen />);
    // Before the store answers: neither the key nor a guess at the choice.
    expect(keyRegion()).not.toBeInTheDocument();
    expect(await screen.findByTestId(TID.computerAddress)).toBeInTheDocument();
    expect(keyRegion()).not.toBeInTheDocument();
  });

  it('shows the key saved before as saved once the choice is back on Anthropic', async () => {
    const services: FakeServices = createFakeServices({ coach: { hasApiKey: true } });
    services.coachSource = createMemoryCoachSourceStore(SAVED);
    services.storage.apiKey = 'sk-ant-api03-saved-here';
    renderWithServices(<SettingsScreen />, services);
    await userEvent.click(await screen.findByTestId(TID.coachSourceAnthropic));
    const keySection = await screen.findByRole('region', { name: 'Anthropic API key' });
    await waitFor(() => expect(keySection).toHaveTextContent('A key is saved on this device.'));
    expect(screen.getByTestId(TID.forgetKey)).toBeInTheDocument();
  });
});
