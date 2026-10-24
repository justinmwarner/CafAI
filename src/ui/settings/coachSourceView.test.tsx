// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { describe, expect, it } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { createMemoryCoachSourceStore, type CoachSource } from '../../storage/coachSource.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { CoachScreen } from '../chat/CoachScreen.tsx';
import { CoachNote } from '../machine/CoachNote.tsx';
import { TID } from '../testIds.ts';
import { createFakeServices, type FakeServices } from '../testing/fakeServices.ts';
import { BRIDGE_NEEDS_CODE, coachErrorFor, useApiKeyView, useCoachRunsOnComputer } from './coachSourceView.ts';

const COMPUTER: CoachSource = { kind: 'computer', address: '192.168.1.20:8877', code: 'ABCDEFGH' };

function Probe({ engineHasKey }: { engineHasKey: boolean }) {
  const onComputer = useCoachRunsOnComputer();
  const view = useApiKeyView(engineHasKey);
  return <output>{JSON.stringify({ onComputer, view })}</output>;
}

function servicesWith(source: Partial<CoachSource> | null, options: { key?: string; hasApiKey?: boolean } = {}) {
  const services: FakeServices = createFakeServices({ coach: { hasApiKey: options.hasApiKey ?? true } });
  if (source) services.coachSource = createMemoryCoachSourceStore(source);
  if (options.key) services.storage.apiKey = options.key;
  return services;
}

const shown = () => JSON.parse(screen.getByRole('status').textContent ?? 'null') as unknown;

describe('useCoachRunsOnComputer and useApiKeyView', () => {
  it('say Anthropic, with the engine telling whether a key is saved, without the store', () => {
    renderWithServices(<Probe engineHasKey />, servicesWith(null));
    expect(shown()).toEqual({ onComputer: false, view: { onComputer: false, keySaved: true } });
  });

  it('read the key store itself while the coach runs on the computer, and follow a change of source', async () => {
    const services = servicesWith(COMPUTER);
    renderWithServices(<Probe engineHasKey />, services);
    // The engine's true is the bridge's code here: no key is saved.
    await waitFor(() => expect(shown()).toEqual({ onComputer: true, view: { onComputer: true, keySaved: false } }));

    services.storage.apiKey = 'sk-ant-api03-saved';
    await act(() => services.coachSource!.set({ ...COMPUTER, kind: 'anthropic' }));
    await waitFor(() => expect(shown()).toEqual({ onComputer: false, view: { onComputer: false, keySaved: true } }));
    await act(() => services.coachSource!.set(COMPUTER));
    await waitFor(() => expect(shown()).toEqual({ onComputer: true, view: { onComputer: true, keySaved: true } }));
  });
});

describe('the coach without what its source needs', () => {
  it("asks for CafAI Bridge's code, not an API key, on the computer", async () => {
    renderWithServices(<CoachScreen />, servicesWith({ ...COMPUTER, code: '' }, { hasApiKey: false }));
    expect(await screen.findByRole('heading', { name: 'Add the code CafAI Bridge shows on your computer to start coaching' })).toBeInTheDocument();
    expect(
      screen.getByText('The coach runs on your computer with your Claude plan, so it needs no API key. The code is kept on this device, and in Decaid unless you turn that off in Settings.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/You pay Anthropic directly/)).not.toBeInTheDocument();
  });

  it('asks for the API key on Anthropic, as before', () => {
    renderWithServices(<CoachScreen />, servicesWith({ ...COMPUTER, kind: 'anthropic' }, { hasApiKey: false }));
    expect(screen.getByRole('heading', { name: 'Add your Anthropic API key to start coaching' })).toBeInTheDocument();
  });

  it("words the engine's no-key banner for the bridge on the computer, and leaves other errors alone", async () => {
    const engineSaid = 'Add your Anthropic API key in Settings to start coaching.';
    const services = servicesWith({ ...COMPUTER, code: '' }, { hasApiKey: false });
    services.coach.setState({ error: engineSaid });
    renderWithServices(<CoachScreen />, services);
    await waitFor(() => expect(screen.getByTestId(TID.errorBanner)).toHaveTextContent(BRIDGE_NEEDS_CODE));
    expect(coachErrorFor(engineSaid, false)).toBe(engineSaid);
    expect(coachErrorFor('The coach got stuck. Try again.', true)).toBe('The coach got stuck. Try again.');
  });

  it("says so in the coach's note during a shot", async () => {
    const services = servicesWith({ ...COMPUTER, code: '' }, { hasApiKey: false });
    renderWithServices(<CoachNote awaitingOutcome={false} />, services);
    act(() => services.telemetry.emitShot({ type: 'started', shotId: 'shot-1' }));
    await waitFor(() => expect(screen.getByTestId(TID.coachNote)).toHaveTextContent("Add CafAI Bridge's code in Settings, and I'll read your shots."));
  });
});
