// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/gateway/client.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: the DecaidClient contract, typed errors, heartbeat, KV, shots.
/**
 * The Decaid REST client.
 *
 * Every call carries a deadline and turns failures into a GatewayError with
 * a sentence a barista can act on (see http.ts). Responses are Decaid's own
 * truth: render what the gateway answered, not an optimistic guess.
 */
import { DEFAULT_TIMEOUT_MS, requestJson, requestValue, type Transport } from './http.ts';
import { toWebSocketOrigin } from './host.ts';
import { createKvClient } from './kv.ts';
import { newId } from '../util/id.ts';
import {
  GatewayError,
  type Bean,
  type BeanBatch,
  type BuildInfo,
  type CommandableState,
  type DecaidClient,
  type DecaidSettings,
  type DeviceEntry,
  type HeartbeatResponse,
  type MachineInfo,
  type MachineSnapshot,
  type PaginatedShots,
  type PluginInfo,
  type ProfileCreateRequest,
  type ProfileRecord,
  type ShotRecord,
  type ShotRecordSummary,
  type ShotUpdateRequest,
  type Workflow,
  type WorkflowPatch,
} from './types.ts';

/** A workflow PUT waits for Decaid to write steam/water settings to the DE1. */
const WORKFLOW_TIMEOUT_MS = 15_000;
/** A quick scan answers in about a second; a full BLE scan legitimately takes much longer. */
const QUICK_SCAN_TIMEOUT_MS = 6_000;
const FULL_SCAN_TIMEOUT_MS = 25_000;

export interface DecaidClientOptions {
  /** e.g. "http://localhost:8080" (see defaultGatewayOrigin in host.ts). */
  origin: string;
  /** Defaults to the global fetch, resolved per call. */
  fetch?: typeof globalThis.fetch;
  /** Deadline for ordinary calls (default 8 s). */
  timeoutMs?: number;
}

/** The DecaidClient contract; kept as its own name since other modules import it that way. */
export type GatewayClient = DecaidClient;

function query(params: Record<string, string | number | boolean | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

const id = (value: string) => encodeURIComponent(value);

export function createDecaidClient(options: DecaidClientOptions): GatewayClient {
  const origin = options.origin.trim().replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const transport: Transport = { origin, fetch: options.fetch, timeoutMs };
  const slow = (ms: number) => Math.max(timeoutMs, ms);

  const client: GatewayClient = {
    httpOrigin: origin,
    wsOrigin: toWebSocketOrigin(origin),

    getInfo: () => requestValue<BuildInfo>(transport, '/api/v1/info'),
    getSettings: () => requestValue<DecaidSettings>(transport, '/api/v1/settings'),
    async updateSettings(patch) {
      // Decaid answers 200 null (settings_handler.dart at aab5f93): read them back.
      await requestJson(transport, '/api/v1/settings', { method: 'POST', body: patch });
      return client.getSettings();
    },
    async listPlugins() {
      return (await requestJson<PluginInfo[]>(transport, '/api/v1/plugins')) ?? [];
    },
    getPluginEndpoint: <T>(pluginId: string, endpoint: string) =>
      requestJson<T>(transport, `/api/v1/plugins/${id(pluginId)}/${id(endpoint)}`),

    getMachineInfo: () => requestValue<MachineInfo>(transport, '/api/v1/machine/info'),
    /**
     * Throws a `not_connected` GatewayError when no machine is paired, which
     * is a normal condition: callers show "not connected" and carry on.
     */
    getMachineState: () => requestValue<MachineSnapshot>(transport, '/api/v1/machine/state'),
    async getCapabilities() {
      const body = await requestJson<{ capabilities?: unknown }>(transport, '/api/v1/machine/capabilities');
      const list = body?.capabilities;
      return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
    },
    /**
     * Command the machine. This actuates real hardware (water moves), so it
     * is only ever called from an explicit tap, and never retried.
     */
    async setMachineState(state: CommandableState) {
      await requestJson(transport, `/api/v1/machine/state/${id(state)}`, { method: 'PUT' });
    },
    async heartbeat() {
      const body = await requestJson<HeartbeatResponse>(transport, '/api/v1/machine/heartbeat', { method: 'POST' });
      return { timeout: typeof body?.timeout === 'number' ? body.timeout : -1 };
    },

    async getDevices() {
      return (await requestJson<DeviceEntry[]>(transport, '/api/v1/devices')) ?? [];
    },
    async tareScale() {
      await requestJson(transport, '/api/v1/scale/tare', { method: 'PUT' });
    },

    getWorkflow: () => requestValue<Workflow>(transport, '/api/v1/workflow'),
    updateWorkflow: (patch: WorkflowPatch) =>
      requestValue<Workflow>(transport, '/api/v1/workflow', { method: 'PUT', body: patch, timeoutMs: slow(WORKFLOW_TIMEOUT_MS) }),

    async listProfiles(listOptions = {}) {
      const path = `/api/v1/profiles${query({
        includeHidden: listOptions.includeHidden ? 'true' : undefined,
        parentId: listOptions.parentId,
      })}`;
      return (await requestJson<ProfileRecord[]>(transport, path)) ?? [];
    },
    getProfile: (profileId: string) => requestValue<ProfileRecord>(transport, `/api/v1/profiles/${id(profileId)}`),
    createProfile(request: ProfileCreateRequest) {
      // Decaid 0.8.6 refused a profile without these, one field per attempt
      // ("Invalid argument(s): Profile must have \"tank_temperature\""), and
      // Crema's authored profiles carried none of them. CafAI always sends
      // all ten keys, so this is only a safety net at the wire. Zero is "off"
      // for each, as in Decent's own profiles. An explicit null version or
      // target_volume is content (it is hashed into the id), so only a
      // missing key is filled; the two required numbers can never be null.
      const profile = { ...request.profile } as Record<string, unknown>;
      if (profile.version === undefined) profile.version = '2';
      if (profile.target_volume === undefined) profile.target_volume = 0;
      profile.target_volume_count_start ??= 0;
      profile.tank_temperature ??= 0;
      const body: Record<string, unknown> = { profile };
      if (request.parentId !== undefined) body.parentId = request.parentId;
      if (request.metadata !== undefined) body.metadata = request.metadata;
      return requestValue<ProfileRecord>(transport, '/api/v1/profiles', { method: 'POST', body });
    },
    updateProfile: (profileId, body) => requestValue<ProfileRecord>(transport, `/api/v1/profiles/${id(profileId)}`, { method: 'PUT', body }),

    listShots: (listOptions = {}) =>
      requestValue<PaginatedShots>(transport, `/api/v1/shots${query({ limit: listOptions.limit, offset: listOptions.offset })}`),
    getLatestShot: () => requestJson<ShotRecordSummary>(transport, '/api/v1/shots/latest'),
    getShot: (shotId: string) => requestValue<ShotRecord>(transport, `/api/v1/shots/${id(shotId)}`),
    updateShot: (shotId: string, patch: ShotUpdateRequest) =>
      requestValue<ShotRecord>(transport, `/api/v1/shots/${id(shotId)}`, { method: 'PUT', body: patch }),
    async probeEnjoymentScale() {
      // A made-up id: current builds validate enjoyment (0-10) before looking
      // the shot up, 0.8.6 field builds look it up first (decaid-mcp's probe).
      try {
        await requestJson(transport, `/api/v1/shots/${id(newId('cafai-probe'))}`, {
          method: 'PUT',
          body: { annotations: { enjoyment: 11 } },
        });
        return null;
      } catch (error) {
        if (!(error instanceof GatewayError)) return null;
        if (error.status === 404) return 100;
        const said = [error.body?.error, error.body?.message, error.body?.details, error.message].join(' ');
        return error.status === 400 && /enjoyment/i.test(said) ? 10 : null;
      }
    },
    async listBeans() {
      return (await requestJson<Bean[]>(transport, '/api/v1/beans')) ?? [];
    },
    async listBatches(beanId) {
      return (await requestJson<BeanBatch[]>(transport, `/api/v1/beans/${id(beanId)}/batches`)) ?? [];
    },
    createBean: (request) => requestValue<Bean>(transport, '/api/v1/beans', { method: 'POST', body: request }),
    createBatch: (beanId, request) =>
      requestValue<BeanBatch>(transport, `/api/v1/beans/${id(beanId)}/batches`, { method: 'POST', body: request }),

    kv: createKvClient(origin, options.fetch, timeoutMs),

    async scanDevices(scanOptions = {}) {
      const quick = scanOptions.quick === true;
      const path = quick ? '/api/v1/devices/scan?quick=true' : '/api/v1/devices/scan';
      return (await requestJson<DeviceEntry[]>(transport, path, { timeoutMs: slow(quick ? QUICK_SCAN_TIMEOUT_MS : FULL_SCAN_TIMEOUT_MS) })) ?? [];
    },
    connectDevice(deviceId, connectionRole) {
      const body: Record<string, unknown> = { deviceId };
      if (connectionRole) body.connectionRole = connectionRole;
      return requestJson(transport, '/api/v1/devices/connect', { method: 'PUT', body });
    },
    /**
     * The quick scan runs first because it answers in about a second, but it
     * is not reliable: on a real DE1 it comes back empty while a full scan
     * finds the machine every time. So an empty quick result falls through
     * rather than being reported as "nothing there".
     */
    async connectKind(kind) {
      const usable = (devices: DeviceEntry[] | null): DeviceEntry | undefined =>
        (devices ?? []).find((device) => device.type === kind && device.available !== false && device.state !== 'connected');
      const quick = await client.scanDevices({ quick: true }).catch(() => null);
      let target = usable(quick);
      if (!target) {
        const full = await client.scanDevices().catch(() => null);
        target = usable(full);
      }
      if (target?.id) await client.connectDevice(target.id);
      return client.getDevices();
    },
  };
  return client;
}
