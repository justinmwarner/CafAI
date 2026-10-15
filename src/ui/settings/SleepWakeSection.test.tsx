// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GatewayError, type PresenceSettings, type WakeSchedule } from '../../api/types.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { createFakeServices } from '../testing/fakeServices.ts';
import { TID } from '../testIds.ts';
import { SleepWakeSection, SLEEP_WAKE_HELP } from './SleepWakeSection.tsx';
import { WAKE_TIME_GONE } from './usePresence.ts';

const WEEKDAYS_0630: WakeSchedule = { id: 'w1', time: '06:30', daysOfWeek: [1, 2, 3, 4, 5], enabled: true, keepAwakeFor: 60 };
const WEEKENDS_0800: WakeSchedule = { id: 'w2', time: '08:00', daysOfWeek: [6, 7], enabled: true };

function renderSection(presence: Partial<PresenceSettings> = {}, options: { connected?: boolean; failRead?: Error } = {}) {
  const services = createFakeServices({ telemetry: { machineConnected: options.connected ?? true } });
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
    expect(services.decaid.calls.map((call) => call.method).slice(-2)).toEqual(['updatePresenceSettings', 'updateWakeSchedule']);
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
    expect(dialog().getByTestId(TID.wakeDialogTime)).toHaveValue('06:00');
    expect(dialog().getByText('Every day')).toBeInTheDocument();
    fireEvent.change(dialog().getByTestId(TID.wakeDialogTime), { target: { value: '06:30' } });
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
    expect(services.decaid.calls.map((call) => call.method).slice(-2)).toEqual(['updatePresenceSettings', 'addWakeSchedule']);
    expect(services.decaid.presence).toMatchObject({ userPresenceEnabled: true, sleepTimeoutMinutes: 0 });
  });

  it('asks for a day and a time before it adds', async () => {
    const { user } = renderSection();
    await loaded();
    await user.click(screen.getByTestId(TID.wakeAdd));
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) await user.click(dialog().getByTestId(TID.wakeDialogDay(day)));
    expect(dialog().getByRole('alert')).toHaveTextContent('Pick at least one day.');
    expect(dialog().getByTestId(TID.wakeDialogSave)).toBeDisabled();
    await user.click(dialog().getByTestId(TID.wakeDialogDay('Mon')));
    expect(dialog().getByTestId(TID.wakeDialogSave)).toBeEnabled();
    fireEvent.change(dialog().getByTestId(TID.wakeDialogTime), { target: { value: '' } });
    expect(dialog().getByText('Choose a time.')).toBeInTheDocument();
    expect(dialog().getByTestId(TID.wakeDialogSave)).toBeDisabled();
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
    expect(dialog().getByTestId(TID.wakeDialogTime)).toHaveValue('06:30');
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
});
