/**
 * Decaid access for CafAI: where the gateway is, the REST and KV clients,
 * live telemetry, presence, profile activation and the grinder library.
 */
export * from './types.ts';
export {
  GATEWAY_OVERRIDE_KEY,
  GATEWAY_PORT,
  defaultGatewayOrigin,
  detectHost,
  readGatewayOverride,
  resolveGatewayOrigin,
  toWebSocketOrigin,
  type LocationLike,
} from './host.ts';
export { parseDecaidTimestamp } from './time.ts';
export { DEFAULT_TIMEOUT_MS, describeGatewayError, interpretGatewayError } from './http.ts';
export { createDecaidClient, type DecaidClientOptions, type GatewayClient } from './client.ts';
export { createKvClient } from './kv.ts';
export {
  deviceConnections,
  parseDevicesFrame,
  parseMachineFrame,
  parseScaleFrame,
  parseShotSettingsFrame,
  parseShotStateFrame,
  parseWaterLevelsFrame,
  type DeviceConnections,
  type ParsedScaleFrame,
} from './frames.ts';
export { createTelemetryStore, type TelemetryStoreOptions, type TimerApi, type VisibilitySource } from './telemetry.ts';
export { createHeartbeat, type HeartbeatOptions } from './heartbeat.ts';
export { activateProfile, createProfileVersion, findProfileMismatch, isShotRunning } from './workflow.ts';
export { describeFailedConnect } from './devices.ts';
export {
  getGrinder,
  grinderSteps,
  listGrinders,
  parseGrinder,
  type Grinder,
  type GrinderRequestOptions,
  type GrinderSettingType,
  type GrinderSource,
  type GrinderSteps,
  type ListGrindersOptions,
} from './grinders.ts';
