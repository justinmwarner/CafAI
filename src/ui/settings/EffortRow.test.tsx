// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MODELS } from '../../llm/models.ts';
import { createMemoryCoachSourceStore } from '../../storage/coachSource.ts';
import type { CoachEffort, Settings } from '../../storage/types.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { createFakeServices, type FakeServices } from '../testing/fakeServices.ts';
import { EFFORT_LINES, EFFORT_TID, EffortRow, ON_COMPUTER_LINE } from './EffortRow.tsx';

const choice = (effort: CoachEffort) => screen.getByTestId(EFFORT_TID.effort(effort));
const group = () => screen.getByRole('group', { name: 'How the coach replies' });
const refreshes = (services: FakeServices) => services.coach.calls.filter((call) => call.method === 'refresh').length;

function servicesWith(settings: Partial<Settings> = {}): FakeServices {
  return createFakeServices({
    storage: { settings: { model: 'claude-opus-5-5', grinderName: null, grinderSetting: null, activeBagId: null, ...settings } },
  });
}

describe('Settings > Coach > How the coach replies (D243)', () => {
  it('says Balanced until someone chooses, under its label, with what it trades', async () => {
    renderWithServices(<EffortRow />, servicesWith());
    await waitFor(() => expect(choice('medium')).toHaveAttribute('aria-pressed', 'true'));
    expect(choice('low')).toHaveAttribute('aria-pressed', 'false');
    expect(choice('high')).toHaveAttribute('aria-pressed', 'false');
    expect(choice('low')).toHaveAccessibleName('Quicker');
    expect(choice('medium')).toHaveAccessibleName('Balanced');
    expect(choice('high')).toHaveAccessibleName('Thorough');
    expect(screen.getByText('How the coach replies')).toBeInTheDocument();
    expect(group()).toHaveAccessibleDescription("Balanced: CafAI's default.");
    expect(choice('low')).toBeEnabled();
  });

  it('shows the saved choice, and the line says what each one trades', async () => {
    renderWithServices(<EffortRow />, servicesWith({ coachEffort: 'high' }));
    await waitFor(() => expect(choice('high')).toHaveAttribute('aria-pressed', 'true'));
    expect(group()).toHaveAccessibleDescription('Thorough thinks longer: better on a hard dial-in, and it costs more.');
    expect(EFFORT_LINES.low).toBe('Quicker answers sooner and costs less; fine for an easy dial-in.');
  });

  it('a tap saves at once, then the coach reads its settings again, so its next reply takes it', async () => {
    const services = servicesWith();
    renderWithServices(<EffortRow />, services);
    await waitFor(() => expect(choice('medium')).toHaveAttribute('aria-pressed', 'true'));

    await userEvent.click(choice('low'));
    expect(choice('low')).toHaveAttribute('aria-pressed', 'true');
    expect(group()).toHaveAccessibleDescription(EFFORT_LINES.low);
    await waitFor(async () => expect((await services.storage.settings.get()).coachEffort).toBe('low'));
    await waitFor(() => expect(refreshes(services)).toBe(1));

    await userEvent.click(choice('high'));
    await waitFor(async () => expect((await services.storage.settings.get()).coachEffort).toBe('high'));
    await waitFor(() => expect(refreshes(services)).toBe(2));
  });

  it('tells the card each change that saved, so its line says "Saved.", and none that failed', async () => {
    const services = servicesWith();
    const onSaved = vi.fn();
    renderWithServices(<EffortRow onSaved={onSaved} />, services);
    await waitFor(() => expect(choice('medium')).toHaveAttribute('aria-pressed', 'true'));
    await userEvent.click(choice('high'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));

    services.storage.settings.update = async () => {
      throw new Error('Storage is full.');
    };
    await userEvent.click(choice('low'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save how the coach replies: Storage is full.');
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('a tap on the chosen one saves nothing', async () => {
    const services = servicesWith({ coachEffort: 'low' });
    const update = vi.spyOn(services.storage.settings, 'update');
    renderWithServices(<EffortRow />, services);
    await waitFor(() => expect(choice('low')).toHaveAttribute('aria-pressed', 'true'));
    await userEvent.click(choice('low'));
    expect(update).not.toHaveBeenCalled();
    expect(refreshes(services)).toBe(0);
  });

  it('a failed save says so under it, and the control goes back to what the coach still uses', async () => {
    const services = servicesWith();
    const update = services.storage.settings.update;
    services.storage.settings.update = async () => {
      throw new Error('Storage is full.');
    };
    renderWithServices(<EffortRow />, services);
    await waitFor(() => expect(choice('medium')).toHaveAttribute('aria-pressed', 'true'));
    await userEvent.click(choice('high'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save how the coach replies: Storage is full.');
    expect(choice('medium')).toHaveAttribute('aria-pressed', 'true');
    expect(refreshes(services)).toBe(0);
    // A later save that works clears it.
    services.storage.settings.update = update;
    await userEvent.click(choice('high'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(choice('high')).toHaveAttribute('aria-pressed', 'true');
    await waitFor(async () => expect((await services.storage.settings.get()).coachEffort).toBe('high'));
  });

  it('is held on a model without effort, the choice kept for another model, with a line saying why', async () => {
    // Haiku 4.5 answers an effort setting with an error (FAKE_MODELS, as KNOWN_MODELS has it).
    const services = servicesWith({ model: 'claude-haiku-4-5', coachEffort: 'high' });
    const update = vi.spyOn(services.storage.settings, 'update');
    renderWithServices(<EffortRow />, services);
    await waitFor(() => expect(group()).toHaveAccessibleDescription('Haiku 4.5 has no setting for this, so it always replies the same way.'));
    expect(choice('high')).toHaveAttribute('aria-pressed', 'true');
    for (const effort of ['low', 'medium', 'high'] as const) expect(choice(effort)).toBeDisabled();
    await userEvent.setup({ pointerEventsCheck: 0 }).click(choice('low'));
    expect(update).not.toHaveBeenCalled();
  });

  it('knows every model CafAI has rules for, not only those it offers now', async () => {
    // The app's list is the offered models (MODELS): Haiku 4.5 is a former one, still without effort.
    const services = servicesWith({ model: 'claude-haiku-4-5' });
    services.models = MODELS;
    renderWithServices(<EffortRow />, services);
    await waitFor(() => expect(group()).toHaveAccessibleDescription('Haiku 4.5 has no setting for this, so it always replies the same way.'));
    expect(choice('medium')).toBeDisabled();
  });

  it('takes a former model that has effort, such as Sonnet 5', async () => {
    const services = servicesWith({ model: 'claude-sonnet-5' });
    services.models = MODELS;
    renderWithServices(<EffortRow />, services);
    await waitFor(() => expect(choice('medium')).toBeEnabled());
    expect(group()).toHaveAccessibleDescription("Balanced: CafAI's default.");
  });

  it('is held on a model typed by hand, which CafAI sends no effort at all', async () => {
    renderWithServices(<EffortRow />, servicesWith({ model: 'claude-opus-7-preview' }));
    await waitFor(() =>
      expect(group()).toHaveAccessibleDescription('claude-opus-7-preview is typed by hand, so CafAI sends it no setting for this.'),
    );
    expect(choice('medium')).toBeDisabled();
  });

  it('follows the model its card shows, as soon as it changes there', async () => {
    const services = servicesWith({ model: 'claude-haiku-4-5' });
    const { rerender } = renderWithServices(<EffortRow model="claude-haiku-4-5" />, services);
    await waitFor(() => expect(choice('medium')).toHaveAttribute('aria-pressed', 'true'));
    expect(choice('medium')).toBeDisabled();
    // Opus 5.5 picked in the card's Model field: the row is live before anything is read again.
    rerender(<EffortRow model="claude-opus-5-5" />);
    expect(choice('medium')).toBeEnabled();
    expect(group()).toHaveAccessibleDescription("Balanced: CafAI's default.");
  });

  it('says what it trades on the plan, and that Claude Code follows it, while the coach runs on the computer', async () => {
    const services = servicesWith({ coachEffort: 'high' });
    services.coachSource = createMemoryCoachSourceStore({ kind: 'computer', address: '192.168.1.20:8877', code: 'ABCDEFGH' });
    renderWithServices(<EffortRow />, services);
    await waitFor(() =>
      expect(group()).toHaveAccessibleDescription(
        `Thorough thinks longer: better on a hard dial-in, and it uses more of your plan. ${ON_COMPUTER_LINE}`,
      ),
    );
    expect(ON_COMPUTER_LINE).toBe('Claude Code on your computer follows it too.');
    await userEvent.click(choice('low'));
    expect(group()).toHaveAccessibleDescription(
      `Quicker answers sooner and uses less of your plan; fine for an easy dial-in. ${ON_COMPUTER_LINE}`,
    );
  });

  it('is held, saying so, when the settings cannot be read', async () => {
    const services = servicesWith({ coachEffort: 'high' });
    services.storage.settings.get = async () => {
      throw new Error('IndexedDB is closed.');
    };
    renderWithServices(<EffortRow />, services);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read how the coach replies: IndexedDB is closed.');
    expect(choice('high')).toBeDisabled();
    expect(choice('high')).toHaveAttribute('aria-pressed', 'false');
  });
});
