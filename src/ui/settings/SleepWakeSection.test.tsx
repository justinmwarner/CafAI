// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GatewayError, type PresenceSettings, type WakeSchedule } from '../../api/types.ts';
import type { ClockFormat } from '../../storage/types.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { createFakeServicesShowing } from '../testing/displayServices.ts';
import { TID } from '../testIds.ts';
import { SleepWakeSection, SLEEP_WAKE_HELP } from './SleepWakeSection.tsx';
import { WAKE_TIME_GONE } from './usePresence.ts';
import { WAKE_DIALOG_HALF_TID } from './WakeTimeDialog.tsx';

const WEEKDAYS_0630: WakeSchedule = { id: 'w1', time: '06:30', daysOfWeek: [1, 2, 3, 4, 5], enabled: true, keepAwakeFor: 60 };
const WEEKENDS_0800: WakeSchedule = { id: 'w2', time: '08:00', daysOfWeek: [6, 7], enabled: true };

function renderSection(presence: Partial<PresenceSettings> = {}, options: { connected?: boolean; failRead?: Error; clock?: ClockFormat } = {}) {
  const services = createFakeServicesShowing({ clock: options.clock }, { telemetry: { machineConnected: options.connected ?? true } });
  services.decaid.presence = { ...services.decaid.presence, ...presence };
  if (options.failRead) services.decaid.failNext('getPresenceSettings', options.failRead);
  renderWithServices(<SleepWakeSection />, services);
  const calls = (method: string) => services.decaid.calls.filter((call) => call.method === method).map((call) => call.args);
  return { services, calls, user: userEvent.setup() };
}

/** Once Decaid's settings are in, the help line takes the place of "Reading…". */
const loaded = () => screen.findByText(SLEEP_WAKE_HELP);
const sleepSwitch = () => screen.getByTestId(TID.sleepWhenIdle);
const minutes = () => screen.queryByRole('spinbutton', { name: 'Sleep after' });
const dialog = () => within(screen.getByTestId(TID.wakeDialog));

afterEach(() => {
  vi.useRealTimers();
});

describe('Sleep when idle', () => {
  it("shows Decaid's idle sleep: on, with its minutes", async () => {
    renderSection();
    expect(screen.getByText("Reading Decaid's sleep and wake settings…")).toBeInTheDocument();
    await loaded();
    expect(sleepSwitch()).toBeChecked();
    expect(minutes()).toHaveValue('30');
    expect(screen.getByText('Using the machine, or CafAI, starts the time again.')).toBeInTheDocument();
  });

  it("reads as off at 0 minutes, and as off while Decaid's own switch is off", async () => {
    renderSection({ sleepTimeoutMinutes: 0 });
    await loaded();
    expect(sleepSwitch()).not.toBeChecked();
    expect(minutes()).toBeNull();
    expect(screen.getByText('The machine stays on until you put it to sleep.')).toBeInTheDocument();
  });

  it("turns off as 0 minutes, leaving Decaid's own switch on, and back on with the minutes it had", async () => {
    const { services, calls, user } = renderSection({ sleepTimeoutMinutes: 45 });
    await loaded();
    await user.click(sleepSwitch());
    await waitFor(() => expect(sleepSwitch()).not.toBeChecked());
    expect(calls('updatePresenceSettings')).toEqual([[{ sleepTimeoutMinutes: 0 }]]);
    expect(services.decaid.presence).toMatchObject({ userPresenceEnabled: true, sleepTimeoutMinutes: 0 });
    await user.click(sleepSwitch());
    await waitFor(() => expect(sleepSwitch()).toBeChecked());
    expect(calls('updatePresenceSettings')[1]).toEqual([{ userPresenceEnabled: true, sleepTimeoutMinutes: 45 }]);
    expect(minutes()).toHaveValue('45');
  });

  it("turns on from Decaid's switch off with the minutes Decaid kept", async () => {
    const { calls, user } = renderSection({ userPresenceEnabled: false, sleepTimeoutMinutes: 20 });
    await loaded();
    expect(sleepSwitch()).not.toBeChecked();
    await user.click(sleepSwitch());
    await waitFor(() => expect(sleepSwitch()).toBeChecked());
    expect(calls('updatePresenceSettings')).toEqual([[{ userPresenceEnabled: true }]]);
    expect(minutes()).toHaveValue('20');
  });

  it("turns on from never with Decaid's default 30 minutes", async () => {
    const { calls, user } = renderSection({ userPresenceEnabled: false, sleepTimeoutMinutes: 0 });
    await loaded();
    await user.click(sleepSwitch());
    await waitFor(() => expect(sleepSwitch()).toBeChecked());
    expect(calls('updatePresenceSettings')).toEqual([[{ userPresenceEnabled: true, sleepTimeoutMinutes: 30 }]]);
  });

  it('steps the minutes and sends each at once', async () => {
    const { calls, user } = renderSection();
    await loaded();
    await user.click(screen.getByRole('button', { name: 'More sleep after' }));
    await waitFor(() => expect(calls('updatePresenceSettings')).toEqual([[{ sleepTimeoutMinutes: 35 }]]));
    expect(minutes()).toHaveValue('35');
  });

  it("goes back to Decaid's minutes, and says why, when a change fails", async () => {
    const { services, user } = renderSection();
    await loaded();
    services.decaid.failNext('updatePresenceSettings', new Error('Decaid is busy. Try again in a moment.'));
    await user.click(screen.getByRole('button', { name: 'Less sleep after' }));
    expect(await screen.findByText('Could not save the minutes: Decaid is busy. Try again in a moment.')).toBeInTheDocument();
    expect(minutes()).toHaveValue('30');
  });

  it('keeps Sleep when idle off when a change of the minutes sent before it answers late', async () => {
    const { services, user } = renderSection();
    await loaded();
    const send = services.decaid.updatePresenceSettings;
    let answer!: () => void;
    const late = new Promise<void>((resolve) => (answer = resolve));
    services.decaid.updatePresenceSettings = async (patch) => {
      if (patch.sleepTimeoutMinutes !== 35) return send(patch);
      await late;
      return { userPresenceEnabled: true, sleepTimeoutMinutes: 35 };
    };
    await user.click(screen.getByRole('button', { name: 'More sleep after' }));
    await user.click(sleepSwitch());
    await waitFor(() => expect(sleepSwitch()).not.toBeChecked());
    await act(async () => {
      answer();
      await late;
    });
    expect(sleepSwitch()).not.toBeChecked();
    expect(minutes()).toBeNull();
  });

  it('keeps the switch where Decaid has it when the change fails', async () => {
    const { services, user } = renderSection();
    await loaded();
    services.decaid.failNext('updatePresenceSettings', new Error('Could not reach Decaid.'));
    await user.click(sleepSwitch());
    expect(await screen.findByText('Could not change Sleep when idle: Could not reach Decaid.')).toBeInTheDocument();
    expect(sleepSwitch()).toBeChecked();
  });

  it("says until when a wake time's window keeps the machine awake", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 15, 7, 0));
    renderSection({ keepAwakeUntil: '2026-10-15T07:30:00.000', schedules: [WEEKDAYS_0630] });
    await loaded();
    expect(screen.getByText('A wake time keeps the machine awake until 07:30.')).toBeInTheDocument();
  });
});

describe("the keep-awake window follows Decaid after every change (D209)", () => {
  // Thursday 15 October 2026, 07:00: the 06:30 weekday wake keeps the machine awake until 07:30.
  const DURING = new Date(2026, 9, 15, 7, 0);
  const UNTIL_0730 = '2026-10-15T07:30:00.000';
  const windowLine = () => screen.queryByText(/^A wake time keeps the machine awake until/);

  /** Decaid works the window out afresh on every read: from now on it answers `until`. */
  function decaidWindow(services: ReturnType<typeof renderSection>['services'], until: string | null) {
    services.decaid.presence = { ...services.decaid.presence, keepAwakeUntil: until };
  }

  function renderDuring(presence: Partial<PresenceSettings> = {}) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(DURING);
    return renderSection({ keepAwakeUntil: UNTIL_0730, schedules: [WEEKDAYS_0630], ...presence });
  }

  it("goes when the wake time is deleted, Sleep when idle off at the time, and stays gone as it is turned back on (the simulator's run)", async () => {
    const { services, calls, user } = renderDuring();
    await loaded();
    expect(windowLine()).toHaveTextContent('A wake time keeps the machine awake until 07:30.');
    await user.click(sleepSwitch());
    await waitFor(() => expect(sleepSwitch()).not.toBeChecked());
    // Only while the idle sleep is on does the window hold anything off (D158).
    expect(windowLine()).toBeNull();
    const remove = services.decaid.deleteWakeSchedule;
    services.decaid.deleteWakeSchedule = async (id) => {
      await remove(id);
      decaidWindow(services, null);
    };
    await user.click(screen.getByTestId(TID.wakeEdit('w1')));
    await user.click(dialog().getByTestId(TID.wakeDialogDelete));
    await waitFor(() => expect(screen.queryByTestId(TID.wakeDialog)).toBeNull());
    await user.click(sleepSwitch());
    await waitFor(() => expect(sleepSwitch()).toBeChecked());
    expect(minutes()).toHaveValue('30');
    await waitFor(() => expect(calls('getPresenceSettings')).toHaveLength(4));
    expect(windowLine()).toBeNull();
  });

  it('moves with a change of the wake time, and goes when the wake time is turned off', async () => {
    const { services, user } = renderDuring();
    await loaded();
    const update = services.decaid.updateWakeSchedule;
    services.decaid.updateWakeSchedule = async (id, patch) => {
      const saved = await update(id, patch);
      decaidWindow(services, patch.enabled === false ? null : '2026-10-15T08:30:00.000');
      return saved;
    };
    await user.click(screen.getByTestId(TID.wakeEdit('w1')));
    await user.selectOptions(dialog().getByTestId(TID.wakeDialogKeepAwake), 'Stay awake for 2 h');
    await user.click(dialog().getByTestId(TID.wakeDialogSave));
    expect(await screen.findByText('A wake time keeps the machine awake until 08:30.')).toBeInTheDocument();
    await user.click(screen.getByTestId(TID.wakeSwitch('w1')));
    await waitFor(() => expect(windowLine()).toBeNull());
  });

  it('comes with a wake time added whose minute has just passed, as Decaid holds the machine awake at once', async () => {
    const { services, user } = renderDuring({ keepAwakeUntil: null, schedules: [] });
    await loaded();
    expect(windowLine()).toBeNull();
    const add = services.decaid.addWakeSchedule;
    services.decaid.addWakeSchedule = async (request) => {
      const added = await add(request);
      decaidWindow(services, '2026-10-15T07:55:00.000');
      return added;
    };
    await user.click(screen.getByTestId(TID.wakeAdd));
    await user.selectOptions(dialog().getByTestId(TID.wakeDialogHour), '06');
    await user.selectOptions(dialog().getByTestId(TID.wakeDialogMinute), '55');
    await user.click(dialog().getByTestId(TID.wakeDialogSave));
    expect(await screen.findByText('A wake time keeps the machine awake until 07:55.')).toBeInTheDocument();
  });

  it('follows the minutes too: a window Decaid ended meanwhile goes with the next change', async () => {
    const { services, calls, user } = renderDuring();
    await loaded();
    expect(windowLine()).not.toBeNull();
    // The machine went to sleep in the window, which ends it in Decaid.
    decaidWindow(services, null);
    await user.click(screen.getByRole('button', { name: 'More sleep after' }));
    await waitFor(() => expect(windowLine()).toBeNull());
    expect(calls('updatePresenceSettings')).toEqual([[{ sleepTimeoutMinutes: 35 }]]);
  });

  it('takes the line away when the read after a change fails, rather than keep a window Decaid may not hold', async () => {
    const { services, user } = renderDuring();
    await loaded();
    services.decaid.failNext('getPresenceSettings', new Error('Could not reach Decaid.'));
    await user.click(screen.getByRole('button', { name: 'More sleep after' }));
    await waitFor(() => expect(windowLine()).toBeNull());
    // The change itself went through, and says nothing of the read.
    expect(minutes()).toHaveValue('35');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('takes the line away when the full read after a wake time deleted elsewhere fails', async () => {
    const { services, user } = renderDuring();
    await loaded();
    expect(windowLine()).not.toBeNull();
    // Decaid answers 404 for a wake time deleted elsewhere, and the section reads everything again: that read fails.
    services.decaid.failNext('updateWakeSchedule', new GatewayError(404, '/api/v1/presence/schedules/w1', 'Schedule not found'));
    services.decaid.failNext('getPresenceSettings', new Error('Could not reach Decaid.'));
    await user.click(screen.getByTestId(TID.wakeSwitch('w1')));
    expect(await screen.findByText(/^Could not read Decaid's sleep and wake settings/)).toBeInTheDocument();
    expect(windowLine()).toBeNull();
  });

  it('is set by the newest read alone, when an older one answers last', async () => {
    const { services, user } = renderDuring();
    await loaded();
    const read = services.decaid.getPresenceSettings;
    let answerFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => (answerFirst = resolve));
    let reads = 0;
    services.decaid.getPresenceSettings = async () => {
      reads += 1;
      // The read after the first change, of a window Decaid still held then, answers only after the second's.
      if (reads === 1) {
        const old = await read();
        await firstHeld;
        return old;
      }
      return read();
    };
    await user.click(screen.getByRole('button', { name: 'More sleep after' }));
    await waitFor(() => expect(reads).toBe(1));
    decaidWindow(services, null);
    await user.click(screen.getByTestId(TID.wakeSwitch('w1')));
    await waitFor(() => expect(reads).toBe(2));
    await waitFor(() => expect(windowLine()).toBeNull());
    await act(async () => {
      answerFirst();
      await firstHeld;
    });
    expect(windowLine()).toBeNull();
  });
});

describe('reading', () => {
  it('says why it could not read, and reads again on Retry', async () => {
    const { user } = renderSection({}, { failRead: new Error('Could not reach Decaid.') });
    expect(await screen.findByText("Could not read Decaid's sleep and wake settings: Could not reach Decaid.")).toBeInTheDocument();
    expect(screen.queryByTestId(TID.sleepWhenIdle)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await loaded();
    expect(sleepSwitch()).toBeChecked();
  });
});

describe('the wake times', () => {
  it('lists them earliest first, with their days and window, and the next wake over them', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 16, 7, 0)); // a Friday
    renderSection({ schedules: [WEEKENDS_0800, WEEKDAYS_0630] });
    await loaded();
    const rows = within(screen.getByRole('list', { name: 'Wake times' })).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual(['06:30Weekdays · stays awake for 1 h', '08:00Weekends']);
    expect(screen.getByTestId(TID.wakeEdit('w1'))).toHaveAccessibleName('Change the wake time 06:30, Weekdays, stays awake for 1 h');
    expect(screen.getByTestId(TID.nextWake)).toHaveTextContent('Next wake: tomorrow at 08:00.');
  });

  it('says when there are none, and when every one is off', async () => {
    renderSection();
    await loaded();
    expect(screen.getByTestId(TID.nextWake)).toHaveTextContent('No wake times yet.');
  });

  it('says every one is off', async () => {
    renderSection({ schedules: [{ ...WEEKENDS_0800, enabled: false }] });
    await loaded();
    expect(screen.getByTestId(TID.nextWake)).toHaveTextContent('Every wake time is off.');
    expect(screen.getByTestId(TID.wakeSwitch('w2'))).not.toBeChecked();
  });

  it('says Decaid needs the machine connected to wake it', async () => {
    renderSection({}, { connected: false });
    await loaded();
    expect(screen.getByText('Decaid can wake the machine only while it is connected.')).toBeInTheDocument();
  });

  it('turns one off and on with its switch', async () => {
    const { calls, user } = renderSection({ schedules: [WEEKDAYS_0630] });
    await loaded();
    const toggle = screen.getByTestId(TID.wakeSwitch('w1'));
    expect(toggle).toHaveAccessibleName('Wake at 06:30, Weekdays');
    await user.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(calls('updateWakeSchedule')).toEqual([['w1', { enabled: false }]]);
    await user.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it("turns Decaid's own switch on, at 0 minutes, before turning a wake time on while it is off", async () => {
    const { calls, services, user } = renderSection({ userPresenceEnabled: false, sleepTimeoutMinutes: 30, schedules: [{ ...WEEKDAYS_0630, enabled: false }] });
    await loaded();
    await user.click(screen.getByTestId(TID.wakeSwitch('w1')));
    await waitFor(() => expect(screen.getByTestId(TID.wakeSwitch('w1'))).toBeChecked());
    expect(calls('updatePresenceSettings')).toEqual([[{ userPresenceEnabled: true, sleepTimeoutMinutes: 0 }]]);
    // Then the keep-awake window is read again (D209).
    expect(services.decaid.calls.map((call) => call.method).slice(-3)).toEqual(['updatePresenceSettings', 'updateWakeSchedule', 'getPresenceSettings']);
    // The machine still does not sleep by itself.
    expect(sleepSwitch()).not.toBeChecked();
  });

  it('says so, and reads them again, when a wake time was deleted elsewhere', async () => {
    const { services, calls, user } = renderSection({ schedules: [WEEKDAYS_0630] });
    await loaded();
    services.decaid.presence = { ...services.decaid.presence, schedules: [] };
    services.decaid.failNext('updateWakeSchedule', new GatewayError(404, '/api/v1/presence/schedules/w1', 'Schedule not found'));
    await user.click(screen.getByTestId(TID.wakeSwitch('w1')));
    expect(await screen.findByText(WAKE_TIME_GONE)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId(TID.wakeRow('w1'))).toBeNull());
    expect(calls('getPresenceSettings')).toHaveLength(2);
  });
});

describe('the wake time dialog', () => {
  it('adds a weekday wake time that keeps the machine awake for an hour', async () => {
    const { calls, user } = renderSection();
    await loaded();
    await user.click(screen.getByTestId(TID.wakeAdd));
    expect(screen.getByRole('dialog', { name: 'Add a wake time' })).toBeInTheDocument();
    expect(dialog().getByTestId(TID.wakeDialogHour)).toHaveValue('06');
    expect(dialog().getByTestId(TID.wakeDialogMinute)).toHaveValue('00');
    expect(dialog().getByText('Every day')).toBeInTheDocument();
    await user.selectOptions(dialog().getByTestId(TID.wakeDialogMinute), '30');
    await user.click(dialog().getByTestId(TID.wakeDialogDay('Sat')));
    await user.click(dialog().getByTestId(TID.wakeDialogDay('Sun')));
    expect(dialog().getByText('Weekdays')).toBeInTheDocument();
    expect(dialog().getByTestId(TID.wakeDialogKeepAwake)).toHaveValue('60');
    await user.click(dialog().getByTestId(TID.wakeDialogSave));
    await waitFor(() => expect(screen.queryByTestId(TID.wakeDialog)).toBeNull());
    expect(calls('addWakeSchedule')).toEqual([[{ time: '06:30', daysOfWeek: [1, 2, 3, 4, 5], enabled: true, keepAwakeFor: 60 }]]);
    expect(screen.getByTestId(TID.wakeRow('schedule_1'))).toHaveTextContent('06:30Weekdays · stays awake for 1 h');
  });

  it('adds one without a window, leaving the key out', async () => {
    const { calls, user } = renderSection();
    await loaded();
    await user.click(screen.getByTestId(TID.wakeAdd));
    await user.selectOptions(dialog().getByTestId(TID.wakeDialogKeepAwake), 'Sleep when idle, as usual');
    await user.click(dialog().getByTestId(TID.wakeDialogSave));
    await waitFor(() => expect(calls('addWakeSchedule')).toEqual([[{ time: '06:00', daysOfWeek: [], enabled: true }]]));
  });

  it("turns Decaid's own switch on, at 0 minutes, before adding a wake time while it is off", async () => {
    const { services, user } = renderSection({ userPresenceEnabled: false, sleepTimeoutMinutes: 30 });
    await loaded();
    await user.click(screen.getByTestId(TID.wakeAdd));
    await user.click(dialog().getByTestId(TID.wakeDialogSave));
    await waitFor(() => expect(screen.queryByTestId(TID.wakeDialog)).toBeNull());
    expect(services.decaid.calls.map((call) => call.method).slice(-3)).toEqual(['updatePresenceSettings', 'addWakeSchedule', 'getPresenceSettings']);
    expect(services.decaid.presence).toMatchObject({ userPresenceEnabled: true, sleepTimeoutMinutes: 0 });
  });

  it('asks for a day before it adds', async () => {
    const { user } = renderSection();
    await loaded();
    await user.click(screen.getByTestId(TID.wakeAdd));
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) await user.click(dialog().getByTestId(TID.wakeDialogDay(day)));
    expect(dialog().getByRole('alert')).toHaveTextContent('Pick at least one day.');
    expect(dialog().getByTestId(TID.wakeDialogSave)).toBeDisabled();
    await user.click(dialog().getByTestId(TID.wakeDialogDay('Mon')));
    expect(dialog().getByTestId(TID.wakeDialogSave)).toBeEnabled();
  });

  it('offers the time in 24-hour figures, every hour and every minute, whatever the device clock says', async () => {
    const { calls, user } = renderSection();
    await loaded();
    await user.click(screen.getByTestId(TID.wakeAdd));
    const time = dialog().getByRole('group', { name: 'Time' });
    const hours = within(within(time).getByRole('combobox', { name: 'Hour' })).getAllByRole('option');
    const minutes = within(within(time).getByRole('combobox', { name: 'Minute' })).getAllByRole('option');
    expect(hours.map((option) => option.textContent)).toEqual(Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0')));
    expect(minutes).toHaveLength(60);
    expect(minutes.at(-1)).toHaveTextContent('59');
    await user.selectOptions(within(time).getByRole('combobox', { name: 'Hour' }), '22');
    await user.selectOptions(within(time).getByRole('combobox', { name: 'Minute' }), '05');
    await user.click(dialog().getByTestId(TID.wakeDialogSave));
    await waitFor(() => expect(calls('addWakeSchedule')).toEqual([[{ time: '22:05', daysOfWeek: [], enabled: true, keepAwakeFor: 60 }]]));
  });

  it('stays open and says why when Decaid does not take it', async () => {
    const { services, user } = renderSection();
    await loaded();
    await user.click(screen.getByTestId(TID.wakeAdd));
    services.decaid.failNext('addWakeSchedule', new Error('Could not reach Decaid.'));
    await user.click(dialog().getByTestId(TID.wakeDialogSave));
    expect(await dialog().findByText('Could not add the wake time: Could not reach Decaid.')).toBeInTheDocument();
    expect(dialog().getByTestId(TID.wakeDialogSave)).toBeEnabled();
  });

  it('changes a wake time, sending only what changed', async () => {
    const { calls, user } = renderSection({ schedules: [WEEKDAYS_0630] });
    await loaded();
    await user.click(screen.getByTestId(TID.wakeEdit('w1')));
    expect(screen.getByRole('dialog', { name: 'Change the wake time' })).toBeInTheDocument();
    expect(dialog().getByTestId(TID.wakeDialogHour)).toHaveValue('06');
    expect(dialog().getByTestId(TID.wakeDialogMinute)).toHaveValue('30');
    expect(dialog().getByTestId(TID.wakeDialogDay('Sat'))).toHaveAttribute('aria-pressed', 'false');
    expect(dialog().getByTestId(TID.wakeDialogDay('Mon'))).toHaveAttribute('aria-pressed', 'true');
    await user.selectOptions(dialog().getByTestId(TID.wakeDialogKeepAwake), 'Sleep when idle, as usual');
    await user.click(dialog().getByTestId(TID.wakeDialogSave));
    await waitFor(() => expect(screen.queryByTestId(TID.wakeDialog)).toBeNull());
    expect(calls('updateWakeSchedule')).toEqual([['w1', { keepAwakeFor: null }]]);
    expect(screen.getByTestId(TID.wakeRow('w1'))).toHaveTextContent('06:30Weekdays');
  });

  it('sends nothing when nothing changed', async () => {
    const { calls, user } = renderSection({ schedules: [WEEKDAYS_0630] });
    await loaded();
    await user.click(screen.getByTestId(TID.wakeEdit('w1')));
    await user.click(dialog().getByTestId(TID.wakeDialogSave));
    await waitFor(() => expect(screen.queryByTestId(TID.wakeDialog)).toBeNull());
    expect(calls('updateWakeSchedule')).toEqual([]);
  });

  it('offers a window Decaid holds outside the choices as it is', async () => {
    const { user } = renderSection({ schedules: [{ ...WEEKENDS_0800, keepAwakeFor: 45 }] });
    await loaded();
    await user.click(screen.getByTestId(TID.wakeEdit('w2')));
    expect(dialog().getByTestId(TID.wakeDialogKeepAwake)).toHaveValue('45');
    expect(dialog().getByRole('option', { name: 'Stay awake for 45 min' })).toBeInTheDocument();
  });

  it('deletes a wake time', async () => {
    const { calls, user } = renderSection({ schedules: [WEEKDAYS_0630, WEEKENDS_0800] });
    await loaded();
    await user.click(screen.getByTestId(TID.wakeEdit('w2')));
    await user.click(dialog().getByTestId(TID.wakeDialogDelete));
    await waitFor(() => expect(screen.queryByTestId(TID.wakeDialog)).toBeNull());
    expect(calls('deleteWakeSchedule')).toEqual([['w2']]);
    expect(screen.queryByTestId(TID.wakeRow('w2'))).toBeNull();
    expect(screen.getByTestId(TID.wakeRow('w1'))).toBeInTheDocument();
  });

  it('says the window does nothing while Sleep when idle is off', async () => {
    const { user } = renderSection({ sleepTimeoutMinutes: 0 });
    await loaded();
    await user.click(screen.getByTestId(TID.wakeAdd));
    expect(dialog().getByText('Sleep when idle is off, so the machine stays on after the wake anyway.')).toBeInTheDocument();
  });

  it('has no am or pm on the 24-hour clock', async () => {
    const { user } = renderSection();
    await loaded();
    await user.click(screen.getByTestId(TID.wakeAdd));
    expect(dialog().queryByTestId(WAKE_DIALOG_HALF_TID.am)).toBeNull();
  });
});

describe('on the 12-hour clock (D245)', () => {
  const WEEKDAYS_2015: WakeSchedule = { id: 'w3', time: '20:15', daysOfWeek: [1, 2, 3, 4, 5], enabled: true };

  it('shows the wake times, the next wake and the window that way, and says them that way', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 15, 7, 0)); // a Thursday
    renderSection({ keepAwakeUntil: '2026-10-15T07:30:00.000', schedules: [WEEKDAYS_2015, WEEKDAYS_0630] }, { clock: '12h' });
    await loaded();
    const rows = within(screen.getByRole('list', { name: 'Wake times' })).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual(['6:30 amWeekdays · stays awake for 1 h', '8:15 pmWeekdays']);
    expect(screen.getByTestId(TID.wakeEdit('w1'))).toHaveAccessibleName('Change the wake time 6:30 am, Weekdays, stays awake for 1 h');
    expect(screen.getByTestId(TID.wakeSwitch('w3'))).toHaveAccessibleName('Wake at 8:15 pm, Weekdays');
    expect(screen.getByTestId(TID.nextWake)).toHaveTextContent('Next wake: today at 8:15 pm.');
    expect(screen.getByText('A wake time keeps the machine awake until 7:30 am.')).toBeInTheDocument();
  });

  it('follows a change of the clock at once', async () => {
    const { services } = renderSection({ schedules: [WEEKDAYS_2015] });
    await loaded();
    expect(screen.getByTestId(TID.wakeRow('w3'))).toHaveTextContent('20:15Weekdays');
    await act(async () => {
      await services.displayPrefs.setClock('12h');
    });
    expect(screen.getByTestId(TID.wakeRow('w3'))).toHaveTextContent('8:15 pmWeekdays');
  });

  it('takes a new wake time as an hour from 12 to 11, its minute and am or pm, and saves it as HH:MM', async () => {
    const { calls, user } = renderSection({}, { clock: '12h' });
    await loaded();
    await user.click(screen.getByTestId(TID.wakeAdd));
    const time = dialog().getByRole('group', { name: 'Time' });
    const hour = within(time).getByRole('combobox', { name: 'Hour' });
    expect(within(hour).getAllByRole('option').map((option) => option.textContent)).toEqual(['12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
    // A new one starts at 6 in the morning, as on the 24-hour clock.
    expect(hour).toHaveValue('6');
    expect(dialog().getByTestId(WAKE_DIALOG_HALF_TID.am)).toHaveAttribute('aria-pressed', 'true');
    expect(dialog().getByTestId(WAKE_DIALOG_HALF_TID.pm)).toHaveAttribute('aria-pressed', 'false');
    await user.selectOptions(hour, '10');
    await user.selectOptions(within(time).getByRole('combobox', { name: 'Minute' }), '05');
    await user.click(dialog().getByTestId(WAKE_DIALOG_HALF_TID.pm));
    expect(dialog().getByTestId(WAKE_DIALOG_HALF_TID.pm)).toHaveAttribute('aria-pressed', 'true');
    await user.click(dialog().getByTestId(TID.wakeDialogSave));
    await waitFor(() => expect(calls('addWakeSchedule')).toEqual([[{ time: '22:05', daysOfWeek: [], enabled: true, keepAwakeFor: 60 }]]));
  });

  it('reads midnight and noon as 12 am and 12 pm', async () => {
    const { calls, user } = renderSection({}, { clock: '12h' });
    await loaded();
    await user.click(screen.getByTestId(TID.wakeAdd));
    await user.selectOptions(dialog().getByTestId(TID.wakeDialogHour), '12');
    await user.click(dialog().getByTestId(TID.wakeDialogSave));
    await waitFor(() => expect(calls('addWakeSchedule')).toEqual([[{ time: '00:00', daysOfWeek: [], enabled: true, keepAwakeFor: 60 }]]));
  });

  it('opens a wake time in its own half, and a change of half alone sends the new time', async () => {
    const { calls, user } = renderSection({ schedules: [WEEKDAYS_2015] }, { clock: '12h' });
    await loaded();
    await user.click(screen.getByTestId(TID.wakeEdit('w3')));
    expect(dialog().getByTestId(TID.wakeDialogHour)).toHaveValue('8');
    expect(dialog().getByTestId(TID.wakeDialogMinute)).toHaveValue('15');
    expect(dialog().getByTestId(WAKE_DIALOG_HALF_TID.pm)).toHaveAttribute('aria-pressed', 'true');
    // A tap on the half already chosen keeps it.
    await user.click(dialog().getByTestId(WAKE_DIALOG_HALF_TID.pm));
    expect(dialog().getByTestId(WAKE_DIALOG_HALF_TID.pm)).toHaveAttribute('aria-pressed', 'true');
    await user.click(dialog().getByTestId(WAKE_DIALOG_HALF_TID.am));
    await user.click(dialog().getByTestId(TID.wakeDialogSave));
    await waitFor(() => expect(screen.queryByTestId(TID.wakeDialog)).toBeNull());
    expect(calls('updateWakeSchedule')).toEqual([['w3', { time: '08:15' }]]);
    expect(screen.getByTestId(TID.wakeRow('w3'))).toHaveTextContent('8:15 amWeekdays');
  });
});
