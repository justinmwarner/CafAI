/**
 * MSW WebSocket handlers for the six Decaid channels CafAI opens.
 *
 * Each socket gets what Decaid replays on connect (machine and scale
 * snapshot channels bind to the live device; devices and shotState are
 * BehaviorSubjects): the latest machine frame, a scale status frame, the
 * devices state, the latest shot state (idle between shots), water levels
 * and shot settings. Machine channels stay open and silent while the machine
 * is away, like Decaid. Clients are tracked per channel here rather than with
 * MSW's cross-tab client manager, so frames never leak between tabs. A
 * machine reading the mock renames (?mockDrift=1, drift.ts) goes out under
 * its new name, replay included.
 */
import { ws, type WebSocketHandler } from 'msw';
import type { MachineSnapshot } from '../../src/api/types.ts';
import { sentMachineFrame } from './drift.ts';
import { DECAID_ORIGIN_PATTERN } from './handlers.ts';
import { MockHttpError } from './errors.ts';
import type { MockChannel, MockDecaid } from './state.ts';

export const WS_CHANNEL_PATHS: Readonly<Record<MockChannel, string>> = {
  machine: '/ws/v1/machine/snapshot',
  scale: '/ws/v1/scale/snapshot',
  devices: '/ws/v1/devices',
  shotState: '/ws/v1/machine/shotState',
  waterLevels: '/ws/v1/machine/waterLevels',
  shotSettings: '/ws/v1/machine/shotSettings',
  timeToReady: '/ws/v1/plugins/time-to-ready.reaplugin/timeToReady',
};

interface ClientLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** A frame as the channel sends it: a machine frame with any renamed reading under its new name (drift.ts). */
function sent(state: MockDecaid, channel: MockChannel, frame: unknown): unknown {
  return channel === 'machine' ? sentMachineFrame(frame as MachineSnapshot, state.renamedReading) : frame;
}

function replay(state: MockDecaid, channel: MockChannel): unknown[] {
  const machineConnected = state.isMachineConnected();
  switch (channel) {
    case 'machine':
      return machineConnected ? [state.getMachineSnapshot()] : [];
    case 'scale':
      return [{ status: state.isScaleConnected() ? 'connected' : 'disconnected' }];
    case 'devices':
      return [state.getDevicesState()];
    case 'shotState':
      return [state.getShotState()];
    case 'waterLevels':
      return machineConnected ? [state.getWaterLevels()] : [];
    case 'shotSettings':
      return machineConnected ? [state.getShotSettings()] : [];
    case 'timeToReady':
      // A plugin's emitted events are a plain stream (pluginManager.emitStream), not a
      // BehaviorSubject: a new client gets nothing until the next frame fires.
      return [];
  }
}

/** ws/v1/devices also takes commands; answer the two CafAI could send. */
function handleDevicesCommand(state: MockDecaid, client: ClientLike, data: unknown): void {
  let message: { command?: unknown; deviceId?: unknown; connectionRole?: unknown };
  try {
    message = JSON.parse(String(data)) as typeof message;
  } catch {
    client.send(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }
  if (message.command === 'scan') {
    client.send(JSON.stringify(state.getDevicesState()));
    return;
  }
  if (message.command === 'connect') {
    try {
      client.send(JSON.stringify(state.connectDevice({ deviceId: message.deviceId, connectionRole: message.connectionRole })));
    } catch (error) {
      client.send(JSON.stringify({ error: error instanceof MockHttpError ? error.message : String(error) }));
    }
    return;
  }
  client.send(JSON.stringify({ error: `Unknown command: ${String(message.command)}` }));
}

export function decaidWsHandlers(state: MockDecaid): WebSocketHandler[] {
  const clients: Record<MockChannel, Set<ClientLike>> = {
    machine: new Set(),
    scale: new Set(),
    devices: new Set(),
    shotState: new Set(),
    waterLevels: new Set(),
    shotSettings: new Set(),
    timeToReady: new Set(),
  };

  const handlers: WebSocketHandler[] = [];
  for (const channel of Object.keys(WS_CHANNEL_PATHS) as MockChannel[]) {
    state.on(channel, (frame) => {
      const text = JSON.stringify(sent(state, channel, frame));
      for (const client of [...clients[channel]]) client.send(text);
    });

    const link = ws.link(`${DECAID_ORIGIN_PATTERN}${WS_CHANNEL_PATHS[channel]}`);
    handlers.push(
      link.addEventListener('connection', ({ client }) => {
        clients[channel].add(client);
        state.noteSocket(channel, 1);
        client.addEventListener('close', () => {
          if (clients[channel].delete(client)) state.noteSocket(channel, -1);
        });
        if (channel === 'devices') {
          client.addEventListener('message', (event) => handleDevicesCommand(state, client, event.data));
        }
        for (const frame of replay(state, channel)) client.send(JSON.stringify(sent(state, channel, frame)));
      }),
    );
  }

  state.onDropSockets((only) => {
    for (const channel of Object.keys(clients) as MockChannel[]) {
      if (only && only !== channel) continue;
      for (const client of [...clients[channel]]) {
        clients[channel].delete(client);
        state.noteSocket(channel, -1);
        client.close(1000, 'mock drop');
      }
    }
  });

  return handlers;
}
