/**
 * Waiting until the machine holds a profile (D55).
 *
 * Decaid answers a workflow PUT before it uploads the profile to the DE1, and
 * no route reads the machine's profile back. `POST /api/v1/machine/profile`
 * is the barrier: Decaid runs it through the same first-in-first-out
 * Bluetooth write queue as the workflow's own upload and answers 200 `null`
 * only after every write was acknowledged and a 500 ms guard passed (at once
 * when the machine already holds an equal profile). So posting the profile
 * exactly as Decaid returned it from the workflow PUT resolves once the
 * machine runs it, without changing what the machine gets.
 *
 * Decaid's answers (lib/src/services/webserver/de1handler.dart):
 *   200 null                 the machine holds it
 *   500 {"error":"DeviceNotConnectedException: machine not connected"}
 *                            no machine (Decaid uploads it on connect)
 *   500 {"error":..., "st":...}   a profile parse error or a failed write
 *   503 {"error":"Machine write queue is full" | "Machine unavailable", "message":...}
 *   504 {"error":"BleTimeoutException: ..." | "EndpointUnavailableException: ..."}
 *   404 "Route not found"    an older Decaid without the route
 */
import { request, type Transport } from './http.ts';
import { GatewayError, type DecaidClient, type WireProfile } from './types.ts';
import type { ProfileJson } from '../coach/types.ts';

const PATH = '/api/v1/machine/profile';

/** An upload is a few dozen Bluetooth writes plus Decaid's 500 ms guard; 20 s leaves room for a queue. */
export const MACHINE_PROFILE_TIMEOUT_MS = 20_000;

/**
 * `loaded`: the machine holds the profile. `offline`: no machine is connected
 * (Decaid uploads the workflow's profile when it connects). `unsupported`: an
 * older Decaid without the route.
 */
export type MachineProfileStatus = 'loaded' | 'offline' | 'unsupported';

export interface MachineProfileOptions {
  /** Defaults to the global fetch, resolved per call. */
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

const BUSY = 'The machine is busy with other changes. Wait a moment, then try again.';
const BLUETOOTH = 'The machine did not answer over Bluetooth in time. Check that it is awake, then try again.';
const SUPERSEDED = 'Another change reached the machine first. Try again.';
const TOO_SLOW = 'The machine took too long to confirm the profile. Try again.';
const REFUSED = 'The machine did not take the profile. Try again.';

/** A sentence for a failed barrier; network failures keep http.ts's own. */
function sentence(error: GatewayError): string {
  if (error.code === 'timeout') return TOO_SLOW;
  if (error.code === 'network') return error.message;
  if (error.status === 503) return BUSY;
  if (error.status === 504) return BLUETOOTH;
  if (error.status === 409) return SUPERSEDED;
  return REFUSED;
}

/**
 * POST the profile to the machine and wait until Decaid says it holds it.
 * Throws a GatewayError with a sentence a barista can act on when the upload
 * failed, timed out, or Decaid could not be reached.
 */
export async function loadProfileOnMachine(
  client: Pick<DecaidClient, 'httpOrigin'>,
  profile: WireProfile | ProfileJson,
  options: MachineProfileOptions = {},
): Promise<MachineProfileStatus> {
  const transport: Transport = {
    origin: client.httpOrigin.trim().replace(/\/+$/, ''),
    fetch: options.fetch,
    timeoutMs: options.timeoutMs ?? MACHINE_PROFILE_TIMEOUT_MS,
  };
  try {
    const reply = await request<null>(transport, PATH, { method: 'POST', body: profile, allowStatus: [404, 405] });
    return reply.status === 404 || reply.status === 405 ? 'unsupported' : 'loaded';
  } catch (error) {
    if (!(error instanceof GatewayError)) throw error;
    if (error.code === 'not_connected') return 'offline';
    throw new GatewayError(error.status, error.path, sentence(error), error.code, error.body);
  }
}
