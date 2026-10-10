/**
 * A pretend DE1 for the shell preview (dev only, never shipped).
 *
 * It answers the panel's commands through the fake Decaid client and plays
 * plausible telemetry into the fake store: a shot is ~2 s of preheat, 8 s of
 * flow-limited preinfusion and a declining 9 bar pour that stops at 36 g.
 */
import { GatewayError, type CommandableState, type MachineFrame, type WeightSnapshot } from '../../api/types.ts';
import { IDLE_TELEMETRY, type FakeServices } from '../testing/fakeServices.ts';

const PERIOD_S = 0.2;
const PREHEAT_S = 2;
const PREINFUSION_S = 8;
const TARGET_YIELD_G = 36;
const MAX_SHOT_S = 45;

export type Scenario = 'live' | 'idle' | 'last' | 'pulling' | 'steam' | 'sleeping' | 'disconnected' | 'ghc' | 'noscale' | 'error';

interface ShotPoint {
  substate: string;
  pressure: number;
  flow: number;
  targetPressure: number;
  targetFlow: number;
  weightFlow: number;
}

/** The machine side of a shot, t seconds after it started (preheat included). */
function shotPoint(t: number): ShotPoint {
  if (t < PREHEAT_S) {
    return { substate: 'preparingForShot', pressure: 0, flow: 0, targetPressure: 0, targetFlow: 0, weightFlow: 0 };
  }
  if (t < PREHEAT_S + PREINFUSION_S) {
    const u = t - PREHEAT_S;
    const pressure = 3.6 * (1 - Math.exp(-u / 2.2)) + 0.05 * Math.sin(u * 3);
    const flow = Math.max(0.4, 4.1 - 0.35 * u);
    const dripping = u > 5 ? Math.min(1.2, (u - 5) * 0.45) : 0;
    return { substate: 'preinfusion', pressure, flow, targetPressure: 0, targetFlow: 4, weightFlow: dripping };
  }
  const u = t - PREHEAT_S - PREINFUSION_S;
  const targetPressure = 9 - 3 * Math.min(1, u / 24);
  const pressure = Math.min(targetPressure, 3.6 + u * 3.2) - 0.15 + 0.12 * Math.sin(u * 2.1);
  const flow = 1.5 + 0.045 * u + 0.08 * Math.sin(u * 1.7);
  return { substate: 'pouring', pressure, flow, targetPressure, targetFlow: 0, weightFlow: Math.max(0, flow * 0.92 - 0.1) };
}

const stamp = () => new Date().toISOString().replace('Z', '000');

export interface PreviewMachine {
  /** Plays the scenario's telemetry; call once the shell has mounted (the graph listens from then on). */
  start(): void;
  dispose(): void;
}

export interface PreviewOptions {
  /** For 'pulling': seconds into the shot to show. */
  at?: number;
  /** For 'pulling': hold the shot at `at` instead of playing on. */
  freeze?: boolean;
}

export function createPreviewMachine(services: FakeServices, scenario: Scenario, options: PreviewOptions = {}): PreviewMachine {
  const { telemetry, decaid } = services;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let ticker: ReturnType<typeof setInterval> | null = null;
  let weight = 0;
  let shotTime = 0;
  let shotId = 0;
  let failNextTare = false;

  const base = (): MachineFrame => ({ ...IDLE_TELEMETRY.machine!, timestamp: stamp() });

  function setMachine(state: string, substate: string, values: Partial<MachineFrame> = {}) {
    telemetry.setState({ machine: { ...base(), state: { state, substate }, ...values } });
  }

  function scaleFrame(weightFlow: number): WeightSnapshot {
    return { timestamp: stamp(), weight, weightFlow, battery: 76, timerValue: null };
  }

  function stopTicker() {
    if (ticker !== null) clearInterval(ticker);
    ticker = null;
  }

  function later(ms: number, run: () => void) {
    const id = setTimeout(() => {
      timers.delete(id);
      run();
    }, ms);
    timers.add(id);
  }

  /** One shot frame; returns false once the shot is over. */
  function shotStep(): boolean {
    const point = shotPoint(shotTime);
    weight += point.weightFlow * PERIOD_S;
    const machine: MachineFrame = {
      ...base(),
      state: { state: 'espresso', substate: point.substate },
      pressure: Math.max(0, point.pressure),
      flow: Math.max(0, point.flow),
      targetPressure: point.targetPressure,
      targetFlow: point.targetFlow,
      groupTemperature: 92.5 - 0.6 * Math.sin(shotTime / 6),
      mixTemperature: 92.2,
      profileFrame: point.substate === 'pouring' ? 2 : point.substate === 'preinfusion' ? 1 : 0,
    };
    const scale = telemetry.getState().scaleConnected ? scaleFrame(point.weightFlow) : null;
    telemetry.setState({ machine, scale });
    telemetry.emitSample({ tS: shotTime, machine, scale });
    shotTime += PERIOD_S;
    return weight < TARGET_YIELD_G && shotTime < MAX_SHOT_S;
  }

  function finishShot() {
    stopTicker();
    telemetry.emitShot({ type: 'finished', shotId: `preview-${shotId}`, stopReason: 'targetWeight' });
    setMachine('idle', 'idle');
  }

  function startShot(options: { at?: number; freeze?: boolean } = {}) {
    stopTicker();
    shotId += 1;
    weight = 0;
    shotTime = 0;
    telemetry.emitShot({ type: 'started', shotId: `preview-${shotId}` });
    if (options.at !== undefined) {
      while (shotTime < options.at && shotStep());
      if (shotTime < options.at) return finishShot();
      if (options.freeze) return;
    }
    ticker = setInterval(() => {
      if (!shotStep()) finishShot();
    }, PERIOD_S * 1000);
  }

  function runFor(state: 'steam' | 'flush' | 'hotWater', seconds: number) {
    stopTicker();
    setMachine(state, 'pouring', state === 'steam' ? { steamTemperature: 152 } : {});
    later(seconds * 1000, () => setMachine('idle', 'idle'));
  }

  function command(state: CommandableState) {
    const current = telemetry.getState().machine?.state.state;
    if (state === 'espresso') startShot();
    else if (state === 'steam' || state === 'flush' || state === 'hotWater') runFor(state, 6);
    else if (state === 'sleeping') {
      stopTicker();
      setMachine('sleeping', 'idle', { groupTemperature: 61.2, steamTemperature: 48 });
    } else if (state === 'idle') {
      if (current === 'espresso') finishShot();
      else {
        for (const id of timers) clearTimeout(id);
        timers.clear();
        setMachine('idle', 'idle');
      }
    }
  }

  decaid.setMachineState = async (state) => {
    decaid.calls.push({ method: 'setMachineState', args: [state] });
    // A real round trip takes a moment; let the button show it.
    await new Promise((resolve) => setTimeout(resolve, 150));
    command(state);
  };
  decaid.tareScale = async () => {
    decaid.calls.push({ method: 'tareScale', args: [] });
    if (failNextTare) {
      failNextTare = false;
      throw new GatewayError(400, '/api/v1/scale/tare', "The scale can't be tared during a shot.", 'block_tare_during_shot');
    }
    weight = 0;
    telemetry.setState({ scale: scaleFrame(0) });
  };

  // Static state first, so the first render already shows the scenario.
  switch (scenario) {
    case 'sleeping':
      setMachine('sleeping', 'idle', { groupTemperature: 61.2, steamTemperature: 48 });
      break;
    case 'disconnected':
      telemetry.setState({
        machineConnected: false,
        scaleConnected: false,
        machine: null,
        scale: null,
        waterLevels: null,
        sockets: { ...IDLE_TELEMETRY.sockets, devices: 'open' },
      });
      break;
    case 'noscale':
      telemetry.setState({ scaleConnected: false, scale: null });
      break;
    case 'error':
      telemetry.setState({
        waterLevels: { currentLevel: 4, refillLevel: 5 },
        connectionError: {
          kind: 'profileUploadFailed',
          severity: 'error',
          timestamp: stamp(),
          deviceId: null,
          deviceName: 'DE1',
          message: 'The profile could not be sent to the machine.',
          suggestion: 'Wake the machine and try again.',
          details: null,
        },
      });
      failNextTare = true;
      break;
    case 'ghc':
      decaid.getMachineInfo = async () => ({ version: '1358', model: 'DE1XL', serialNumber: '1', GHC: true });
      break;
    default:
      break;
  }

  return {
    start() {
      switch (scenario) {
        case 'live': {
          // Idle for a moment, then a shot every half minute so the graph is always doing something.
          const loop = () => {
            startShot();
            later(30_000, loop);
          };
          later(2500, loop);
          break;
        }
        case 'pulling':
          startShot({ at: options.at ?? 22, freeze: options.freeze });
          break;
        case 'steam':
          startShot({ at: MAX_SHOT_S });
          setMachine('steam', 'pouring', { steamTemperature: 152 });
          break;
        case 'last':
        case 'error':
        case 'ghc':
        case 'noscale':
          startShot({ at: MAX_SHOT_S });
          break;
        default:
          break;
      }
    },
    dispose() {
      stopTicker();
      for (const id of timers) clearTimeout(id);
      timers.clear();
    },
  };
}
