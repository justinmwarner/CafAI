/**
 * Typed access to the Decaid example payloads.
 *
 * The JSON files are byte copies of docs/verified/examples (provenance in
 * docs/verified/examples/_README.md): shapes and number formats come from
 * Decaid's own serializers at a45961b, cross-checked against real 0.8.6
 * captures. Callers get deep copies, so a test or the stateful mock can
 * mutate what it receives.
 */
import type {
  BuildInfo,
  DecaidErrorBody,
  DevicesState,
  HeartbeatResponse,
  MachineInfo,
  MachineSnapshot,
  PaginatedShots,
  ProfileCreateRequest,
  ProfileRecord,
  ShotRecord,
  ShotSettings,
  ShotStateEvent,
  ShotUpdateRequest,
  WaterLevels,
  WeightSnapshot,
  Workflow,
  WorkflowPatch,
} from '../../src/api/types.ts';
import { clone } from '../../src/util/clone.ts';
import buildInfo from './build-info.json';
import devicesWs from './devices-ws.json';
import error from './error.json';
import errorBlockNoScale from './error-block-no-scale.json';
import errorMachineNotConnected from './error-machine-not-connected.json';
import heartbeat from './heartbeat.json';
import kvGet from './kv-get.json';
import machineInfo from './machine-info.json';
import machineSnapshotWs from './machine-snapshot-ws.json';
import machineState from './machine-state.json';
import profileCreateRequest from './profile-create-request.json';
import profileRecord from './profile-record.json';
import profilesList from './profiles-list.json';
import scaleSnapshotWs from './scale-snapshot-ws.json';
import scaleStatusWs from './scale-status-ws.json';
import shotRecord from './shot-record.json';
import shotSettings from './shot-settings.json';
import shotStateWs from './shot-state-ws.json';
import shotUpdateRequest from './shot-update-request.json';
import shotsList from './shots-list.json';
import waterLevelsWs from './water-levels-ws.json';
import workflowGet from './workflow-get.json';
import workflowPutRequest from './workflow-put-request.json';

function typed<T>(value: unknown): () => T {
  return () => clone(value) as T;
}

export const fixtures = {
  buildInfo: typed<BuildInfo>(buildInfo),
  devicesWs: typed<DevicesState>(devicesWs),
  error: typed<DecaidErrorBody>(error),
  errorBlockNoScale: typed<DecaidErrorBody>(errorBlockNoScale),
  errorMachineNotConnected: typed<DecaidErrorBody>(errorMachineNotConnected),
  heartbeat: typed<HeartbeatResponse>(heartbeat),
  kvGet: typed<Record<string, unknown>>(kvGet),
  machineInfo: typed<MachineInfo>(machineInfo),
  machineSnapshotWs: typed<MachineSnapshot>(machineSnapshotWs),
  machineState: typed<MachineSnapshot>(machineState),
  profileCreateRequest: typed<ProfileCreateRequest>(profileCreateRequest),
  profileRecord: typed<ProfileRecord>(profileRecord),
  profilesList: typed<ProfileRecord[]>(profilesList),
  scaleSnapshotWs: typed<WeightSnapshot>(scaleSnapshotWs),
  scaleStatusWs: typed<{ status: 'connected' | 'disconnected' }>(scaleStatusWs),
  shotRecord: typed<ShotRecord>(shotRecord),
  shotSettings: typed<ShotSettings>(shotSettings),
  shotStateWs: typed<ShotStateEvent>(shotStateWs),
  shotUpdateRequest: typed<ShotUpdateRequest>(shotUpdateRequest),
  shotsList: typed<PaginatedShots>(shotsList),
  waterLevelsWs: typed<WaterLevels>(waterLevelsWs),
  workflowGet: typed<Workflow>(workflowGet),
  workflowPutRequest: typed<WorkflowPatch>(workflowPutRequest),
};

export { cremaFixtures } from './crema.ts';
