// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/gateway/client.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: the DecaidClient contract, typed errors, heartbeat, KV, shots.
/**
 * The Decaid REST client.
 *
 * Every call carries a deadline and turns failures into a GatewayError with
 * a sentence a barista can act on (see http.ts). Responses are Decaid's own
 * truth: render what the gateway answered, not an optimistic guess. Every
 * reply CafAI uses passes a reader (readers.ts) on the way in, so a reply
 * Decaid changed is reported and never trusted blindly (D95).
 */
import { reportDrift } from './drift.ts';
import { DEFAULT_TIMEOUT_MS, request, requestJson, requestValue, type Transport } from './http.ts';
import { toWebSocketOrigin } from './host.ts';
import { createKvClient } from './kv.ts';
import {
  readBatch,
  readBatches,
  readBean,
  readBeans,
  readBuildInfo,
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
  unexpectedReply,
} from './readers.ts';
import { newId } from '../util/id.ts';
import {
  GatewayError,
  type CommandableState,
  type DecaidClient,
  type DeviceEntry,
  type HeartbeatResponse,
  type ProfileCreateRequest,
  type ShotUpdateRequest,
  type WorkflowPatch,
} from './types.ts';

/**
 * A workflow PUT waits in Decaid's queue, up to 30 s before Decaid answers
 * 503 and skips it, and then for the steam and water settings to reach the
 * DE1. A 503 never applies the change (v0.8.8, workflow_handler.dart); a PUT
 * this deadline cuts off may still land, so activateProfile reads the
 * workflow back after either (5.13).
 */
const WORKFLOW_TIMEOUT_MS = 35_000;
/** A quick scan answers [] at once and scans behind its answer; a full one answers when Decaid's 15 s Bluetooth scan is over. */
const QUICK_SCAN_TIMEOUT_MS = 6_000;
const FULL_SCAN_TIMEOUT_MS = 25_000;
/** Decaid gives a connect 30 s (60 s on Linux) before it answers 504 (connection_manager.dart at aab5f93). */
const CONNECT_TIMEOUT_MS = 35_000;

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

/** The rating scale probe, as drift reports name it. */
const PROBE_SOURCE = 'PUT /api/v1/shots/{id}';
/** Answers to the probe that say Decaid is busy, not which scale it uses: ask again later. */
const PROBE_LATER = new Set([408, 425, 429, 503]);

/** The entries of a device list as Decaid sent it, leaving out anything that is not one. */
const deviceList = (value: unknown): DeviceEntry[] =>
  Array.isArray(value) ? value.filter((entry): entry is DeviceEntry => typeof entry === 'object' && entry !== null) : [];

export function createDecaidClient(options: DecaidClientOptions): GatewayClient {
  const origin = options.origin.trim().replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const transport: Transport = { origin, fetch: options.fetch, timeoutMs };
  const slow = (ms: number) => Math.max(timeoutMs, ms);

  const client: GatewayClient = {
    httpOrigin: origin,
    wsOrigin: toWebSocketOrigin(origin),

    getInfo: () => requestValue(transport, '/api/v1/info', { read: readBuildInfo }),
    getSettings: () => requestValue(transport, '/api/v1/settings', { read: readSettings }),
    async updateSettings(patch) {
      // Decaid answers 200 null (settings_handler.dart at aab5f93): read them back.
      await requestJson(transport, '/api/v1/settings', { method: 'POST', body: patch });
      return client.getSettings();
    },
    async listPlugins() {
      return (await requestJson(transport, '/api/v1/plugins', { read: readPlugins })) ?? [];
    },
    /** A plugin's own reply: the caller knows its shape and reads it. */
    getPluginEndpoint: <T>(pluginId: string, endpoint: string) =>
      requestJson<T>(transport, `/api/v1/plugins/${id(pluginId)}/${id(endpoint)}`),

    getMachineInfo: () => requestValue(transport, '/api/v1/machine/info', { read: readMachineInfo }),
    /**
     * Throws a `not_connected` GatewayError when no machine is paired, which
     * is a normal condition: callers show "not connected" and carry on.
     */
    getMachineState: () => requestValue(transport, '/api/v1/machine/state', { read: readMachineState }),
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

    getWorkflow: () => requestValue(transport, '/api/v1/workflow', { read: readWorkflow }),
    updateWorkflow: (patch: WorkflowPatch) =>
      requestValue(transport, '/api/v1/workflow', { method: 'PUT', body: patch, timeoutMs: slow(WORKFLOW_TIMEOUT_MS), read: readWorkflow }),

    async listProfiles(listOptions = {}) {
      const path = `/api/v1/profiles${query({
        includeHidden: listOptions.includeHidden ? 'true' : undefined,
        parentId: listOptions.parentId,
      })}`;
      return (await requestJson(transport, path, { read: readProfileRecords })) ?? [];
    },
    getProfile: (profileId: string) =>
      requestValue(transport, `/api/v1/profiles/${id(profileId)}`, { read: readProfileRecord, source: 'GET /api/v1/profiles/{id}' }),
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
      return requestValue(transport, '/api/v1/profiles', { method: 'POST', body, read: readProfileRecord });
    },
    updateProfile: (profileId, body) =>
      requestValue(transport, `/api/v1/profiles/${id(profileId)}`, {
        method: 'PUT',
        body,
        read: readProfileRecord,
        source: 'PUT /api/v1/profiles/{id}',
      }),

    listShots: (listOptions = {}) =>
      requestValue(transport, `/api/v1/shots${query({ limit: listOptions.limit, offset: listOptions.offset })}`, { read: readShotPage }),
    getLatestShot: () => requestJson(transport, '/api/v1/shots/latest', { read: readShotSummary }),
    getShot: (shotId: string) => requestValue(transport, `/api/v1/shots/${id(shotId)}`, { read: readShot, source: 'GET /api/v1/shots/{id}' }),
    updateShot: (shotId: string, patch: ShotUpdateRequest) =>
      requestValue(transport, `/api/v1/shots/${id(shotId)}`, { method: 'PUT', body: patch, read: readShot, source: 'PUT /api/v1/shots/{id}' }),
    /**
     * Null when Decaid did not answer or was busy: ask again later. An answer
     * that tells neither scale is reported and thrown as `unexpected_reply`
     * (D95), so the stars never go out on a guess.
     */
    async probeEnjoymentScale() {
      // A made-up id: current builds validate enjoyment (0-10) before looking
      // the shot up, 0.8.6 field builds look it up first (decaid-mcp's probe).
      const path = `/api/v1/shots/${id(newId('cafai-probe'))}`;
      let status: number;
      try {
        status = (await request(transport, path, { method: 'PUT', body: { annotations: { enjoyment: 11 } } })).status;
      } catch (error) {
        if (!(error instanceof GatewayError) || error.code === 'network' || error.code === 'timeout') return null;
        if (error.status === 404) return 100;
        const said = [error.body?.error, error.body?.message, error.body?.details, error.message].join(' ');
        if (error.status === 400 && /enjoyment/i.test(said)) return 10;
        if (PROBE_LATER.has(error.status)) return null;
        status = error.status;
      }
      reportDrift(PROBE_SOURCE, `enjoyment probe: unexpected ${status}`);
      throw unexpectedReply(PROBE_SOURCE, path);
    },
    async listBeans() {
      return (await requestJson(transport, '/api/v1/beans', { read: readBeans })) ?? [];
    },
    async listBatches(beanId) {
      const source = 'GET /api/v1/beans/{id}/batches';
      return (await requestJson(transport, `/api/v1/beans/${id(beanId)}/batches`, { read: readBatches, source })) ?? [];
    },
    createBean: (request) => requestValue(transport, '/api/v1/beans', { method: 'POST', body: request, read: readBean }),
    createBatch: (beanId, request) =>
      requestValue(transport, `/api/v1/beans/${id(beanId)}/batches`, {
        method: 'POST',
        body: request,
        read: readBatch,
        source: 'POST /api/v1/beans/{id}/batches',
      }),

    kv: createKvClient(origin, options.fetch, timeoutMs),

    /**
     * Discovery only. Decaid's scan connects every slot it can fill (the
     * machine, then the scale) unless the query says connect=false, and a
     * quick scan answers [] at once and finds its devices behind its answer
     * (devices_handler.dart at aab5f93).
     */
    async scanDevices(scanOptions = {}) {
      const quick = scanOptions.quick === true;
      const path = `/api/v1/devices/scan${query({ connect: 'false', quick: quick ? 'true' : undefined })}`;
      return (await requestJson<DeviceEntry[]>(transport, path, { timeoutMs: slow(quick ? QUICK_SCAN_TIMEOUT_MS : FULL_SCAN_TIMEOUT_MS) })) ?? [];
    },
    connectDevice(deviceId, connectionRole) {
      const body: Record<string, unknown> = { deviceId };
      if (connectionRole) body.connectionRole = connectionRole;
      return requestJson(transport, '/api/v1/devices/connect', { method: 'PUT', body, timeoutMs: slow(CONNECT_TIMEOUT_MS) });
    },
    /**
     * A full scan that connects nothing, then a connect by id for the one
     * device: the one Decaid's settings prefer when the scan found it, else
     * the first it found that is there to connect. Never a quick scan, whose
     * answer is always empty. A device of the kind connected by the end of
     * the scan (Decaid reconnects on its own too) is left as it is. A connect
     * Decaid refuses is not thrown: the device list after says how it went.
     */
    async connectKind(kind) {
      const [scanned, settings] = await Promise.all([client.scanDevices().catch(() => null), client.getSettings().catch(() => null)]);
      // A scan that failed or ran out of time still left Decaid knowing what it saw.
      const found = deviceList(Array.isArray(scanned) ? scanned : await client.getDevices());
      const ofKind = found.filter((device) => device.type === kind);
      if (!ofKind.some((device) => device.state === 'connected')) {
        const ready = ofKind.filter((device) => device.available !== false && device.state !== 'connecting' && device.id);
        const preferred = settings?.[kind === 'machine' ? 'preferredMachineId' : 'preferredScaleId'];
        const target = ready.find((device) => device.id === preferred) ?? ready[0];
        if (target) await client.connectDevice(target.id).catch(() => undefined);
      }
      return client.getDevices();
    },
  };
  return client;
}
