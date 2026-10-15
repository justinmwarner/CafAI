import { describe, expect, it } from 'vitest';
import { MockHttpError } from './errors.ts';
import { createMockDecaid, type MockDecaidOptions } from './state.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OUT_OF_RANGE_TIME = { error: 'time must be hour 0-23 and minute 0-59' };
const OUT_OF_RANGE_DAY = { error: 'daysOfWeek must contain weekdays 1 to 7' };
const OUT_OF_RANGE_KEEP_AWAKE = { error: 'keepAwakeFor must be 1-720 minutes, or 0/null to clear' };

function expectHttpError(run: () => unknown, status: number, body?: Record<string, unknown>) {
  let caught: unknown = null;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught, 'expected a MockHttpError').toBeInstanceOf(MockHttpError);
  expect((caught as MockHttpError).status).toBe(status);
  if (body) expect((caught as MockHttpError).body).toEqual(body);
}

/** What `value as T` throws, as the schedule handlers answer it. */
const castError = (from: string, to: string) => ({ error: `type '${from}' is not a subtype of type '${to}' in type cast` });

/** A mock whose data clock is a local time the test sets: Thursday 15 October 2026, 07:00, to begin with. */
function clockedMock(options: MockDecaidOptions = {}) {
  let now = new Date(2026, 9, 15, 7, 0).getTime();
  const mock = createMockDecaid({ seedExamples: false, seedGrinders: false, seedBeans: false, ...options, now: () => now });
  return {
    mock,
    at(hour: number, minute: number, day = 15) {
      now = new Date(2026, 9, day, hour, minute).getTime();
    },
    sleep() {
      mock.setMachineSnapshot({ ...mock.getMachineSnapshot(), state: { state: 'sleeping', substate: 'idle' } });
    },
    wake() {
      mock.setMachineSnapshot({ ...mock.getMachineSnapshot(), state: { state: 'idle', substate: 'idle' } });
    },
  };
}

describe('GET /api/v1/presence/settings', () => {
  it("starts with Decaid's defaults, in its key order, as a real Decaid 0.8.8 answers them", () => {
    expect(JSON.stringify(createMockDecaid().getPresenceSettings())).toBe(
      '{"userPresenceEnabled":true,"sleepTimeoutMinutes":30,"keepAwakeUntil":null,"schedules":[]}',
    );
  });

  it('starts from a seed: the minutes clamped, each schedule read back as Decaid stores it', () => {
    const mock = createMockDecaid({
      presence: {
        userPresenceEnabled: false,
        sleepTimeoutMinutes: 999,
        schedules: [{ id: 'wake-1', time: '6:30', daysOfWeek: [5, 1, 1], enabled: true, keepAwakeFor: 0 }],
      },
    });
    const schedule = { id: 'wake-1', time: '06:30', daysOfWeek: [1, 5], enabled: true };
    expect(mock.getPresenceSettings()).toEqual({ userPresenceEnabled: false, sleepTimeoutMinutes: 240, keepAwakeUntil: null, schedules: [schedule] });
    expect(mock.listWakeSchedules()).toEqual([schedule]);
    expect(() => createMockDecaid({ presence: { schedules: [{ id: 'x', time: '0630', daysOfWeek: [], enabled: true }] } })).toThrow(/HH:MM/);
  });

  it('returns copies, so a caller cannot change what is stored', () => {
    const { mock } = clockedMock();
    const added = mock.addWakeSchedule({ time: '06:30', daysOfWeek: [1] });
    mock.getPresenceSettings().schedules[0]!.daysOfWeek.push(2);
    mock.listWakeSchedules()[0]!.enabled = false;
    mock.getWakeSchedule(added.id).time = '00:00';
    expect(mock.listWakeSchedules()).toEqual([added]);
  });
});

describe('POST /api/v1/presence/settings', () => {
  it('changes only the keys given, clamps the minutes into 0-240, and answers the two as saved', () => {
    const { mock } = clockedMock();
    expect(mock.updatePresenceSettings({ userPresenceEnabled: false })).toEqual({ userPresenceEnabled: false, sleepTimeoutMinutes: 30 });
    expect(mock.updatePresenceSettings({ sleepTimeoutMinutes: 37 })).toEqual({ userPresenceEnabled: false, sleepTimeoutMinutes: 37 });
    expect(mock.updatePresenceSettings({ sleepTimeoutMinutes: 999 }).sleepTimeoutMinutes).toBe(240);
    expect(mock.updatePresenceSettings({ sleepTimeoutMinutes: -10 }).sleepTimeoutMinutes).toBe(0);
    const saved = mock.updatePresenceSettings({ userPresenceEnabled: true, sleepTimeoutMinutes: 0, keepAwake: false });
    expect(Object.keys(saved)).toEqual(['userPresenceEnabled', 'sleepTimeoutMinutes']);
    expect(saved).toEqual({ userPresenceEnabled: true, sleepTimeoutMinutes: 0 });
    expect(mock.updatePresenceSettings({})).toEqual(saved);
    expect(mock.getPresenceSettings()).toMatchObject(saved);
  });

  it('is a 400 for a body that is not an object or a field of the wrong type, checked before anything changes', () => {
    const { mock } = clockedMock();
    for (const body of [[1, 2, 3], 'hello', null, 7]) {
      expectHttpError(() => mock.updatePresenceSettings(body), 400, { error: 'Request body must be a JSON object' });
    }
    expectHttpError(() => mock.updatePresenceSettings({ userPresenceEnabled: 'true' }), 400, { error: 'userPresenceEnabled must be a boolean' });
    for (const minutes of ['30', 30.5, null]) {
      expectHttpError(() => mock.updatePresenceSettings({ sleepTimeoutMinutes: minutes }), 400, { error: 'sleepTimeoutMinutes must be an integer' });
    }
    // The good field is not saved when the other is refused, and userPresenceEnabled is checked first.
    expectHttpError(() => mock.updatePresenceSettings({ userPresenceEnabled: false, sleepTimeoutMinutes: '30' }), 400);
    expectHttpError(() => mock.updatePresenceSettings({ userPresenceEnabled: 1, sleepTimeoutMinutes: 'x' }), 400, {
      error: 'userPresenceEnabled must be a boolean',
    });
    expect(mock.getPresenceSettings()).toMatchObject({ userPresenceEnabled: true, sleepTimeoutMinutes: 30 });
  });
});

describe('POST /api/v1/presence/schedules', () => {
  it('adds a schedule with a new UUID, last, as WakeSchedule.toJson answers it', () => {
    const { mock } = clockedMock();
    const added = mock.addWakeSchedule({ time: '06:30', daysOfWeek: [5, 1, 3, 1], enabled: true, keepAwakeFor: 45 });
    expect(added).toEqual({ id: expect.stringMatching(UUID), time: '06:30', daysOfWeek: [1, 3, 5], enabled: true, keepAwakeFor: 45 });
    expect(Object.keys(added)).toEqual(['id', 'time', 'daysOfWeek', 'enabled', 'keepAwakeFor']);
    const second = mock.addWakeSchedule({ time: '18:00', enabled: false });
    expect(second.id).not.toBe(added.id);
    expect(mock.listWakeSchedules()).toEqual([added, second]);
    expect(mock.getPresenceSettings().schedules).toEqual([added, second]);
  });

  it('takes hour and minute over time; no days is every day, enabled defaults to true, keepAwakeFor 0 or null is none', () => {
    const { mock } = clockedMock();
    expect(mock.addWakeSchedule({ hour: 7, minute: 5, time: '23:59' })).toEqual({ id: expect.stringMatching(UUID), time: '07:05', daysOfWeek: [], enabled: true });
    expect(mock.addWakeSchedule({ hour: 7, time: '06:45' }).time).toBe('07:45');
    expect(mock.addWakeSchedule({ time: '6:5' }).time).toBe('06:05');
    expect(mock.addWakeSchedule({ time: '06:30', keepAwakeFor: 0 })).not.toHaveProperty('keepAwakeFor');
    expect(mock.addWakeSchedule({ time: '06:30', keepAwakeFor: null, enabled: null })).toMatchObject({ enabled: true });
    expect(mock.addWakeSchedule({ time: '06:30', keepAwakeFor: 720, daysOfWeek: [] })).toMatchObject({ keepAwakeFor: 720, daysOfWeek: [] });
  });

  it("is a 400 for a value out of range, in Decaid's order, and adds nothing", () => {
    const { mock } = clockedMock();
    for (const body of [{ time: '25:00' }, { time: '07:60' }, { hour: -1, minute: 0 }, { hour: 24, minute: 0 }, { time: '07:30', minute: -1 }]) {
      expectHttpError(() => mock.addWakeSchedule(body), 400, OUT_OF_RANGE_TIME);
    }
    expectHttpError(() => mock.addWakeSchedule({ time: '07:30', daysOfWeek: [0, 8] }), 400, OUT_OF_RANGE_DAY);
    expectHttpError(() => mock.addWakeSchedule({ time: '07:30', keepAwakeFor: 721 }), 400, OUT_OF_RANGE_KEEP_AWAKE);
    expectHttpError(() => mock.addWakeSchedule({ time: '07:30', keepAwakeFor: -1 }), 400, OUT_OF_RANGE_KEEP_AWAKE);
    // keepAwakeFor is checked first, then the time, then the days.
    expectHttpError(() => mock.addWakeSchedule({ time: '25:00', keepAwakeFor: 999 }), 400, OUT_OF_RANGE_KEEP_AWAKE);
    expectHttpError(() => mock.addWakeSchedule({ time: '25:00', daysOfWeek: [9] }), 400, OUT_OF_RANGE_TIME);
    expect(mock.listWakeSchedules()).toEqual([]);
  });

  it("is a 500 with Dart's error for a body its casts refuse (the handler's catch-all), and adds nothing", () => {
    const { mock } = clockedMock();
    const refused: Array<[unknown, Record<string, unknown>]> = [
      [[{ time: '07:30' }], castError('List<dynamic>', 'Map<String, dynamic>')],
      [null, castError('Null', 'Map<String, dynamic>')],
      [{}, castError('Null', 'String')],
      [{ hour: 7 }, castError('Null', 'String')],
      [{ time: 630 }, castError('int', 'String')],
      [{ time: '0730' }, { error: 'RangeError (index): Index out of range: index should be less than 1: 1' }],
      [{ time: '07:30', keepAwakeFor: '45' }, castError('String', 'int?')],
      [{ time: '07:30', keepAwakeFor: 45.5 }, castError('double', 'int?')],
      [{ time: '07:30', enabled: 'yes' }, castError('String', 'bool?')],
      [{ time: '07:30', daysOfWeek: null }, castError('Null', 'List<dynamic>')],
      [{ time: '07:30', daysOfWeek: ['1'] }, castError('String', 'int')],
      [{ hour: '7', minute: 30 }, castError('String', 'int?')],
    ];
    for (const [body, error] of refused) expectHttpError(() => mock.addWakeSchedule(body), 500, error);
    let caught: unknown = null;
    try {
      mock.addWakeSchedule({ time: 'ab:cd' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ status: 500, body: { error: expect.stringMatching(/^FormatException: Invalid number/) } });
    expect(mock.listWakeSchedules()).toEqual([]);
  });
});

describe('PUT /api/v1/presence/schedules/{id}', () => {
  it('changes only the keys given: time, then hour and minute over it; keepAwakeFor null or 0 clears it', () => {
    const { mock } = clockedMock();
    const { id } = mock.addWakeSchedule({ time: '06:30', daysOfWeek: [1, 2], enabled: true, keepAwakeFor: 45 });
    expect(mock.updateWakeSchedule(id, { enabled: false })).toEqual({ id, time: '06:30', daysOfWeek: [1, 2], enabled: false, keepAwakeFor: 45 });
    expect(mock.updateWakeSchedule(id, { keepAwakeFor: null })).toEqual({ id, time: '06:30', daysOfWeek: [1, 2], enabled: false });
    expect(mock.updateWakeSchedule(id, { keepAwakeFor: 90 }).keepAwakeFor).toBe(90);
    expect(mock.updateWakeSchedule(id, { keepAwakeFor: 0 })).not.toHaveProperty('keepAwakeFor');
    expect(mock.updateWakeSchedule(id, { time: '21:15', minute: 5 }).time).toBe('21:05');
    expect(mock.updateWakeSchedule(id, { hour: 8 }).time).toBe('08:05');
    expect(mock.updateWakeSchedule(id, { daysOfWeek: [7, 6, 6] }).daysOfWeek).toEqual([6, 7]);
    const last = mock.updateWakeSchedule(id, { daysOfWeek: [], id: 'other', unknown: 1 });
    expect(last).toEqual({ id, time: '08:05', daysOfWeek: [], enabled: false });
    expect(mock.listWakeSchedules()).toEqual([last]);
  });

  it('is a 404 {error, id} for an unknown id, with or without other schedules', () => {
    const { mock } = clockedMock();
    expectHttpError(() => mock.updateWakeSchedule('nope', { enabled: false }), 404, { error: 'Schedule not found', id: 'nope' });
    expectHttpError(() => mock.getWakeSchedule('nope'), 404, { error: 'Schedule not found', id: 'nope' });
    mock.addWakeSchedule({ time: '06:30' });
    expectHttpError(() => mock.updateWakeSchedule('nope', { enabled: false }), 404, { error: 'Schedule not found', id: 'nope' });
  });

  it("is a 400 for a value out of range and a 500 for a type Decaid's casts refuse, and changes nothing", () => {
    const { mock } = clockedMock();
    const before = mock.addWakeSchedule({ time: '06:30', daysOfWeek: [1], keepAwakeFor: 45 });
    for (const body of [{ time: '24:00' }, { hour: 7, minute: 60 }, { minute: -1 }]) expectHttpError(() => mock.updateWakeSchedule(before.id, body), 400, OUT_OF_RANGE_TIME);
    expectHttpError(() => mock.updateWakeSchedule(before.id, { daysOfWeek: [9] }), 400, OUT_OF_RANGE_DAY);
    for (const minutes of [721, -5]) expectHttpError(() => mock.updateWakeSchedule(before.id, { keepAwakeFor: minutes }), 400, OUT_OF_RANGE_KEEP_AWAKE);
    const refused: Array<[unknown, Record<string, unknown>]> = [
      [[], castError('List<dynamic>', 'Map<String, dynamic>')],
      [{ hour: null }, castError('Null', 'int')],
      [{ enabled: null }, castError('Null', 'bool')],
      [{ enabled: 'no' }, castError('String', 'bool')],
      [{ time: null }, castError('Null', 'String')],
      [{ keepAwakeFor: '30' }, castError('String', 'int?')],
      [{ daysOfWeek: 'weekdays' }, castError('String', 'List<dynamic>')],
    ];
    for (const [body, error] of refused) expectHttpError(() => mock.updateWakeSchedule(before.id, body), 500, error);
    expect(mock.listWakeSchedules()).toEqual([before]);
  });
});

describe('DELETE /api/v1/presence/schedules/{id}', () => {
  it('deletes that schedule and answers {deleted: id}; a 404 once it is gone', () => {
    const { mock } = clockedMock();
    const first = mock.addWakeSchedule({ time: '06:30' });
    const second = mock.addWakeSchedule({ time: '18:00' });
    expect(mock.deleteWakeSchedule(first.id)).toEqual({ deleted: first.id });
    expect(mock.listWakeSchedules()).toEqual([second]);
    expectHttpError(() => mock.deleteWakeSchedule(first.id), 404, { error: 'Schedule not found', id: first.id });
  });
});

describe('keepAwakeUntil', () => {
  it('is when the keep-awake run going on now ends, while a machine is connected: local time, milliseconds, no zone', () => {
    const { mock } = clockedMock();
    mock.addWakeSchedule({ time: '06:30', keepAwakeFor: 45 });
    expect(mock.getPresenceSettings().keepAwakeUntil).toBe('2026-10-15T07:15:00.000');
    mock.setMachineConnected(false);
    expect(mock.getPresenceSettings().keepAwakeUntil).toBeNull();
    mock.setMachineConnected(true);
    expect(mock.getPresenceSettings().keepAwakeUntil).toBe('2026-10-15T07:15:00.000');
  });

  it('counts an enabled schedule with a keep-awake window on a day it runs, from its start until just before its end', () => {
    const { mock, at } = clockedMock();
    const { id } = mock.addWakeSchedule({ time: '06:30', daysOfWeek: [4], keepAwakeFor: 45 });
    const until = () => mock.getPresenceSettings().keepAwakeUntil;
    at(6, 29);
    expect(until()).toBeNull();
    at(6, 30);
    expect(until()).toBe('2026-10-15T07:15:00.000');
    at(7, 14);
    expect(until()).toBe('2026-10-15T07:15:00.000');
    at(7, 15);
    expect(until()).toBeNull();
    at(7, 0);
    mock.updateWakeSchedule(id, { daysOfWeek: [5] });
    expect(until(), 'Fridays only, on a Thursday').toBeNull();
    mock.updateWakeSchedule(id, { daysOfWeek: [], enabled: false });
    expect(until(), 'disabled').toBeNull();
    mock.updateWakeSchedule(id, { enabled: true, keepAwakeFor: null });
    expect(until(), 'no keep-awake window').toBeNull();
  });

  it("keeps a run that started yesterday after midnight, by yesterday's day", () => {
    const { mock, at } = clockedMock();
    const { id } = mock.addWakeSchedule({ time: '23:30', daysOfWeek: [3], keepAwakeFor: 120 });
    at(0, 30);
    expect(mock.getPresenceSettings().keepAwakeUntil, 'a Wednesday run, on Thursday').toBe('2026-10-15T01:30:00.000');
    mock.updateWakeSchedule(id, { daysOfWeek: [4] });
    expect(mock.getPresenceSettings().keepAwakeUntil, 'a Thursday run has not begun').toBeNull();
  });

  it('is the end of the run that ends last when several go on', () => {
    const { mock } = clockedMock();
    mock.addWakeSchedule({ time: '06:45', keepAwakeFor: 30 });
    mock.addWakeSchedule({ time: '06:00', keepAwakeFor: 120 });
    mock.addWakeSchedule({ time: '06:50', keepAwakeFor: 30 });
    expect(mock.getPresenceSettings().keepAwakeUntil).toBe('2026-10-15T08:00:00.000');
  });

  it('ends for a run the machine goes to sleep in, that run only', () => {
    const { mock, at, sleep, wake } = clockedMock();
    const { id } = mock.addWakeSchedule({ time: '06:30', keepAwakeFor: 45 });
    const until = () => mock.getPresenceSettings().keepAwakeUntil;
    sleep();
    expect(until()).toBeNull();
    wake();
    expect(until(), 'awake again, the run stays ended').toBeNull();
    mock.updateWakeSchedule(id, { keepAwakeFor: 60 });
    expect(until(), 'a longer window for the same run').toBeNull();
    at(7, 0, 16);
    expect(until(), "the next day's run").toBe('2026-10-16T07:30:00.000');
  });

  it('is not ended by a sleep before the run, or one while the machine is away', () => {
    const { mock, at, sleep, wake } = clockedMock();
    mock.addWakeSchedule({ time: '06:30', keepAwakeFor: 45 });
    at(6, 0);
    sleep();
    wake();
    at(7, 0);
    expect(mock.getPresenceSettings().keepAwakeUntil).toBe('2026-10-15T07:15:00.000');
    mock.setMachineConnected(false);
    sleep();
    mock.setMachineConnected(true);
    expect(mock.getPresenceSettings().keepAwakeUntil).toBe('2026-10-15T07:15:00.000');
  });
});

describe('the heartbeat follows the idle sleep', () => {
  it('answers the minutes in seconds, or -1 when the idle sleep is off, set to 0 or there is no machine', () => {
    const { mock } = clockedMock();
    expect(mock.heartbeat()).toEqual({ timeout: 1800 });
    mock.updatePresenceSettings({ sleepTimeoutMinutes: 45 });
    expect(mock.heartbeat()).toEqual({ timeout: 2700 });
    mock.updatePresenceSettings({ sleepTimeoutMinutes: 0 });
    expect(mock.heartbeat()).toEqual({ timeout: -1 });
    mock.updatePresenceSettings({ userPresenceEnabled: false, sleepTimeoutMinutes: 30 });
    expect(mock.heartbeat()).toEqual({ timeout: -1 });
    mock.updatePresenceSettings({ userPresenceEnabled: true });
    mock.setMachineConnected(false);
    expect(mock.heartbeat()).toEqual({ timeout: -1 });
  });
});
