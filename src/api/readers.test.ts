import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtures } from '../../mock/fixtures/index.ts';
import { driftLog } from './drift.ts';
import {
  readBatch,
  readBatches,
  readBean,
  readBeans,
  readBuildInfo,
  readDevices,
  readMachineInfo,
  readMachineState,
  readPlugins,
  readProfileRecord,
  readProfileRecords,
  readSettings,
  readShot,
  readShotPage,
  readShotSummary,
  readWorkflow,
} from './readers.ts';
import { GatewayError } from './types.ts';

const drift = () => driftLog.list().map(({ source, problem }) => ({ source, problem }));
const problems = () => driftLog.list().map((entry) => entry.problem);

/** What a reader threw, for a closer look. */
function refusal(read: () => unknown): unknown {
  try {
    read();
  } catch (error) {
    return error;
  }
  throw new Error('the reader did not refuse the reply');
}

const UNRECOGNISED = { status: 200, code: 'unexpected_reply', message: "Decaid sent a reply CafAI doesn't recognise." };

const bean = (id: string) => ({ id, roaster: 'Square Mile', name: 'Guji Hambela', archived: false, createdAt: '2026-10-01T08:00:00.000', updatedAt: '2026-10-01T08:00:00.000' });
const batch = (id: string) => ({ id, beanId: 'bean-1', roastDate: '2026-09-30T00:00:00.000', frozen: false, archived: false, createdAt: '2026-10-01T08:00:00.000' });

beforeEach(() => {
  driftLog.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('readers: what Decaid sends as it should', () => {
  it('every verified example reads as it came, with nothing reported', () => {
    const info = fixtures.buildInfo();
    expect(readBuildInfo(info, 'GET /api/v1/info')).toBe(info);
    const machine = fixtures.machineInfo();
    expect(readMachineInfo(machine, 'GET /api/v1/machine/info')).toBe(machine);
    const workflow = fixtures.workflowGet();
    expect(readWorkflow(workflow, 'GET /api/v1/workflow')).toBe(workflow);
    const record = fixtures.profileRecord();
    expect(readProfileRecord(record, 'POST /api/v1/profiles')).toBe(record);
    expect(readProfileRecords(fixtures.profilesList(), 'GET /api/v1/profiles')).toEqual(fixtures.profilesList());
    const shot = fixtures.shotRecord();
    expect(readShot(shot, 'GET /api/v1/shots/{id}')).toBe(shot);
    const { measurements: _measurements, ...summary } = fixtures.shotRecord();
    expect(readShotSummary(summary, 'GET /api/v1/shots/latest')).toBe(summary);
    expect(readShotPage(fixtures.shotsList(), 'GET /api/v1/shots')).toEqual(fixtures.shotsList());
    expect(readMachineState(fixtures.machineState(), 'GET /api/v1/machine/state')).toEqual(fixtures.machineState());
    const settings = { gatewayMode: 'tracking', blockOnNoScale: false, logLevel: 'INFO', preferredMachineId: 'F4:12:FA:5C:3D:8E', preferredScaleId: null };
    expect(readSettings(settings, 'GET /api/v1/settings')).toBe(settings);
    expect(readBeans([bean('bean-1')], 'GET /api/v1/beans')).toEqual([bean('bean-1')]);
    expect(readBatches([batch('batch-1')], 'GET /api/v1/beans/{id}/batches')).toEqual([batch('batch-1')]);
    expect(readDevices(fixtures.devicesWs().devices, 'GET /api/v1/devices')).toEqual(fixtures.devicesWs().devices);
    expect(drift()).toEqual([]);
  });

  it('a valid reply passes through untouched: keys CafAI does not know are kept, and so are enum values', () => {
    const workflow = { ...fixtures.workflowGet(), machine: { provenanceStatus: 'captured' }, somethingNew: [1, 2] };
    expect(readWorkflow(workflow, 'GET /api/v1/workflow')).toBe(workflow);
    const settings = { gatewayMode: 'somethingNew', chargingMode: 'balanced', preferredMachineId: null, preferredScaleId: null };
    expect(readSettings(settings, 'GET /api/v1/settings')).toBe(settings);
    const record = { ...fixtures.profileRecord(), visibility: 'archived' };
    expect(readProfileRecord(record, 'GET /api/v1/profiles/{id}')).toBe(record);
    expect(drift()).toEqual([]);
  });

  it('only what CafAI reads is checked: a field it never reads may change without a report', () => {
    const { commitShort: _short, buildNumber: _number, ...info } = fixtures.buildInfo();
    expect(readBuildInfo({ ...info, appStore: 'no', branch: 7 }, 'GET /api/v1/info')).toMatchObject({ version: info.version, fullVersion: info.fullVersion });
    const { metadataHash: _hash, isDefault: _default, ...record } = fixtures.profileRecord();
    expect(readProfileRecord({ ...record, createdAt: null }, 'POST /api/v1/profiles').id).toBe(record.id);
    const { stopAtTemperature: _stop, ...steam } = fixtures.workflowGet().steamSettings;
    expect(readWorkflow({ ...fixtures.workflowGet(), id: 7, steamSettings: steam }, 'GET /api/v1/workflow').steamSettings).toEqual(steam);
    expect(drift()).toEqual([]);
  });
});

describe('readers: a field CafAI cannot do without', () => {
  it("a workflow without its profile fails the call and says what was missing", () => {
    const { profile: _profile, ...workflow } = fixtures.workflowGet();
    const error = refusal(() => readWorkflow(workflow, 'GET /api/v1/workflow'));
    expect(error).toBeInstanceOf(GatewayError);
    expect(error).toMatchObject(UNRECOGNISED);
    expect(drift()).toEqual([{ source: 'GET /api/v1/workflow', problem: 'profile: missing' }]);
  });

  it("a workflow profile needs its title and steps", () => {
    const workflow = { ...fixtures.workflowGet(), profile: { title: 5, notes: '' } };
    expect(refusal(() => readWorkflow(workflow, 'PUT /api/v1/workflow'))).toMatchObject(UNRECOGNISED);
    expect(drift()).toEqual([
      { source: 'PUT /api/v1/workflow', problem: 'profile.title: expected string, got number' },
      { source: 'PUT /api/v1/workflow', problem: 'profile.steps: missing' },
    ]);
  });

  it('a reply of the wrong kind fails the call', () => {
    expect(refusal(() => readWorkflow([], 'GET /api/v1/workflow'))).toMatchObject(UNRECOGNISED);
    expect(refusal(() => readBeans({ beans: [] }, 'GET /api/v1/beans'))).toMatchObject(UNRECOGNISED);
    expect(refusal(() => readBuildInfo('0.9.0', 'GET /api/v1/info'))).toMatchObject(UNRECOGNISED);
    expect(problems()).toEqual(['reply: expected object, got array', 'reply: expected array, got object', 'reply: expected object, got string']);
  });

  it('a record needs its id: a profile record (with its profile), a shot, a bean, a batch (with its bean)', () => {
    const { id: _id, ...record } = fixtures.profileRecord();
    expect(refusal(() => readProfileRecord(record, 'POST /api/v1/profiles'))).toMatchObject(UNRECOGNISED);
    expect(refusal(() => readProfileRecord({ ...fixtures.profileRecord(), profile: null }, 'POST /api/v1/profiles'))).toMatchObject(
      UNRECOGNISED,
    );
    expect(refusal(() => readShot({ ...fixtures.shotRecord(), id: '' }, 'GET /api/v1/shots/{id}'))).toMatchObject(UNRECOGNISED);
    expect(refusal(() => readBean({ roaster: 'Square Mile', name: 'Guji' }, 'POST /api/v1/beans'))).toMatchObject(UNRECOGNISED);
    expect(refusal(() => readBatch({ id: 'batch-1', roastDate: null }, 'POST /api/v1/beans/{id}/batches'))).toMatchObject(UNRECOGNISED);
    expect(drift()).toEqual([
      { source: 'POST /api/v1/profiles', problem: 'id: missing' },
      { source: 'POST /api/v1/profiles', problem: 'profile: expected object, got null' },
      { source: 'GET /api/v1/shots/{id}', problem: 'id: empty' },
      { source: 'POST /api/v1/beans', problem: 'id: missing' },
      { source: 'POST /api/v1/beans/{id}/batches', problem: 'beanId: missing' },
    ]);
  });
});

describe('readers: anything else is unknown, never a default, and is reported', () => {
  it('MachineInfo without GHC reads as GHC: false', () => {
    const { GHC: _ghc, ...info } = fixtures.machineInfo();
    expect(readMachineInfo(info, 'GET /api/v1/machine/info')).toEqual({ ...info, GHC: false });
    expect(drift()).toEqual([{ source: 'GET /api/v1/machine/info', problem: 'GHC: missing' }]);
  });

  it('build info Decaid sent oddly reads as empty, so About says the version is unknown', () => {
    const sent = fixtures.buildInfo();
    const info = { ...sent, fullVersion: 802, version: null };
    expect(readBuildInfo(info, 'GET /api/v1/info')).toMatchObject({ fullVersion: '', version: '', commit: sent.commit });
    expect(problems()).toEqual(['version: expected string, got null', 'fullVersion: expected string, got number']);
  });

  it("a workflow's drink settings: a field CafAI cannot read is null, never Decaid's default", () => {
    const sent = fixtures.workflowGet();
    const { flow: _flow, ...steam } = sent.steamSettings;
    const { hotWaterData: _hotWater, ...rest } = sent;
    const workflow = {
      ...rest,
      steamSettings: { ...steam, targetTemperature: '0', flowRate: 0.8 },
      rinseData: { ...sent.rinseData, duration: null },
      context: { ...sent.context, targetYield: '36', extras: [] },
    };
    const read = readWorkflow(workflow, 'GET /api/v1/workflow');
    // A renamed flow is not 0.8, and steam sent off as "0" is not 150 °C: both are unknown.
    expect(read.steamSettings).toMatchObject({ targetTemperature: null, duration: steam.duration, flow: null });
    expect(read.hotWaterData).toEqual({ targetTemperature: null, duration: null, volume: null, flow: null });
    expect(read.rinseData).toEqual({ ...sent.rinseData, duration: null });
    expect(read.context).not.toHaveProperty('targetYield');
    expect(read.context).not.toHaveProperty('extras');
    expect(read.context?.targetDoseWeight).toBe(18);
    expect(read.profile).toBe(sent.profile);
    // The reply itself is never changed.
    expect(workflow.context.targetYield).toBe('36');
    expect(problems()).toEqual([
      'context.targetYield: expected number, got string',
      'context.extras: expected object, got array',
      'steamSettings.targetTemperature: expected number, got string',
      'steamSettings.flow: missing',
      'hotWaterData: missing',
      'rinseData.duration: expected number, got null',
    ]);
  });

  it('steam that is off in Decaid (0) is read as 0, which Settings shows as Off', () => {
    const sent = fixtures.workflowGet();
    const workflow = { ...sent, steamSettings: { ...sent.steamSettings, targetTemperature: 0 } };
    expect(readWorkflow(workflow, 'GET /api/v1/workflow').steamSettings.targetTemperature).toBe(0);
    expect(drift()).toEqual([]);
  });

  it('an unknown value is never shared between replies', () => {
    const { steamSettings: _steam, ...workflow } = fixtures.workflowGet();
    const first = readWorkflow(workflow, 'GET /api/v1/workflow');
    first.steamSettings.flow = 2.5;
    expect(readWorkflow(workflow, 'GET /api/v1/workflow').steamSettings.flow).toBeNull();
    const { workflow: _workflow, measurements: _measurements, ...shot } = fixtures.shotRecord();
    readShot(shot, 'GET /api/v1/shots/{id}').measurements.push(fixtures.shotRecord().measurements[0]!);
    expect(readShot(shot, 'GET /api/v1/shots/{id}').measurements).toEqual([]);
  });

  it('settings: a gateway mode or a preferred device it cannot read is left out, so nothing is said or done on a guess (5.1)', () => {
    expect(readSettings({ gatewayMode: 1, preferredMachineId: 7, preferredScaleId: null, blockOnNoScale: 'yes' }, 'GET /api/v1/settings')).toEqual({
      preferredScaleId: null,
      blockOnNoScale: 'yes',
    });
    expect(readSettings({ gatewayMode: 'tracking', preferredScaleDeviceId: 'CF:3A' }, 'GET /api/v1/settings')).not.toHaveProperty('preferredScaleId');
    expect(problems()).toEqual([
      'gatewayMode: expected string, got number',
      'preferredMachineId: expected string, got number',
      'preferredMachineId: missing',
      'preferredScaleId: missing',
    ]);
  });

  it('a profile record: a parent it cannot read is unknown (left out), never "none"', () => {
    const { parentId: _parent, ...record } = fixtures.profileRecord();
    expect(readProfileRecord(record, 'POST /api/v1/profiles')).not.toHaveProperty('parentId');
    expect(readProfileRecord({ ...record, parentId: 5 }, 'POST /api/v1/profiles')).not.toHaveProperty('parentId');
    expect(problems()).toEqual(['parentId: missing', 'parentId: expected string, got number']);
  });

  it("a shot record without its workflow reads as an empty one (the engine credits it as before, 5.10)", () => {
    const { workflow: _workflow, measurements: _measurements, ...shot } = fixtures.shotRecord();
    const read = readShot({ ...shot, annotations: { ...shot.annotations, espressoNotes: { text: 'x' } } }, 'GET /api/v1/shots/{id}');
    expect(read.workflow).toEqual({});
    expect(read.measurements).toEqual([]);
    expect(read.annotations).not.toHaveProperty('espressoNotes');
    expect(read.annotations?.enjoyment).toBe(7.5);
    expect(problems()).toEqual(['workflow: missing', 'annotations.espressoNotes: expected string, got object', 'measurements: missing']);
  });
});

describe('readers: lists', () => {
  it('a list with one bad bean keeps the others and reports once', () => {
    const beans = readBeans([bean('bean-1'), { roaster: 'Square Mile', name: 'No id', archived: 'no' }, bean('bean-3')], 'GET /api/v1/beans');
    expect(beans.map((item) => item.id)).toEqual(['bean-1', 'bean-3']);
    expect(drift()).toEqual([{ source: 'GET /api/v1/beans', problem: '[].id: missing' }]);
  });

  it('the same problem in many items, or many replies, is one entry', () => {
    for (let i = 0; i < 3; i += 1) readBatches([{ id: 'a' }, { id: 'b' }, batch('c')], 'GET /api/v1/beans/{id}/batches');
    expect(drift()).toEqual([{ source: 'GET /api/v1/beans/{id}/batches', problem: '[].beanId: missing' }]);
    expect(driftLog.list()[0]!.count).toBe(6);
  });

  it('an item with a field it can do without is kept, that field left out', () => {
    const plugins = readPlugins(
      [{ id: 'time-to-ready.reaplugin', loaded: true }, { id: 'visualizer.reaplugin', loaded: 'yes' }, { name: 'No id', loaded: true }, 'junk'],
      'GET /api/v1/plugins',
    );
    expect(plugins).toEqual([{ id: 'time-to-ready.reaplugin', loaded: true }, { id: 'visualizer.reaplugin' }]);
    expect(problems()).toEqual(['[].loaded: expected boolean, got string', '[].id: missing', '[]: expected object, got string']);
  });

  it('a page of shots keeps its good items', () => {
    const page = fixtures.shotsList();
    const read = readShotPage({ ...page, items: [{ ...page.items[0], id: null }, page.items[1]] }, 'GET /api/v1/shots');
    expect(read.items).toEqual([page.items[1]]);
    expect(read.total).toBe(page.total);
    expect(problems()).toEqual(['items[].id: expected string, got null']);
  });
});

describe('readMachineState', () => {
  it('reads GET /api/v1/machine/state like a snapshot frame: a missing reading is null, never 0', () => {
    const { pressure: _pressure, ...state } = fixtures.machineState();
    expect(readMachineState(state, 'GET /api/v1/machine/state')).toEqual({ ...state, pressure: null });
    expect(drift()).toEqual([{ source: 'GET /api/v1/machine/state', problem: 'pressure: missing' }]);
  });

  it('fails the call when there is no state to read', () => {
    const { state: _state, ...frame } = fixtures.machineState();
    expect(refusal(() => readMachineState(frame, 'GET /api/v1/machine/state'))).toMatchObject(UNRECOGNISED);
    expect(drift()).toEqual([{ source: 'GET /api/v1/machine/state', problem: 'state: missing' }]);
  });

  it('keeps a state without a timestamp it can read, at the time it arrived', () => {
    const { timestamp: _timestamp, ...frame } = fixtures.machineState();
    expect(readMachineState(frame, 'GET /api/v1/machine/state').state).toEqual(frame.state);
    expect(drift()).toEqual([{ source: 'GET /api/v1/machine/state', problem: 'timestamp: missing' }]);
  });
});

describe('readDevices', () => {
  it('leaves out a device without its id, type or state, and keeps the rest', () => {
    const [scale, machine] = fixtures.devicesWs().devices;
    const devices = readDevices([{ ...scale, id: '' }, { ...machine, type: undefined }, machine], 'GET /api/v1/devices');
    expect(devices).toEqual([machine]);
    expect(problems()).toEqual(['[].id: empty', '[].type: missing']);
  });

  it('a name or availability it cannot read is unknown: no name, and not "remembered only"', () => {
    const [, machine] = fixtures.devicesWs().devices;
    const [device] = readDevices([{ ...machine, name: null, available: 'yes' }], 'GET /api/v1/devices/scan');
    expect(device).toEqual({ id: machine!.id, state: machine!.state, type: machine!.type, name: '' });
    expect(problems()).toEqual(['[].name: expected string, got null', '[].available: expected boolean, got string']);
  });

  it('a reply that is not a list, null included, fails the call: never "Decaid has none"', () => {
    expect(refusal(() => readDevices(null, 'GET /api/v1/devices'))).toMatchObject(UNRECOGNISED);
    expect(refusal(() => readPlugins(null, 'GET /api/v1/plugins'))).toMatchObject(UNRECOGNISED);
    expect(drift()).toEqual([
      { source: 'GET /api/v1/devices', problem: 'reply: expected array, got null' },
      { source: 'GET /api/v1/plugins', problem: 'reply: expected array, got null' },
    ]);
  });
});
