/**
 * The mock's URL switches (`?mockSpeed=25&mockGrinders=0`), read once when the
 * mock starts in the browser. They are listed in mock/browser.ts; a switch
 * that is absent or unreadable leaves the default alone.
 *
 * The demo (?demo=1, mock/plan.ts) changes two defaults: no example shot or
 * example profile (the demo brings its own), and a 1.5 s profile upload, so
 * "Loading … on the machine…" is there to see after a Confirm. ?mockUploadMs
 * still sets the upload time.
 */
import { demoRequested } from '../plan.ts';
import { DRIFT_RENAMED_READING } from './drift.ts';
import type { CreateDecaidMockOptions } from './index.ts';

/** How long the machine takes a new profile in the demo, in wall-clock ms. */
export const DEMO_UPLOAD_MS = 1500;

export function mockOptionsFromUrl(search: string): CreateDecaidMockOptions {
  const params = new URLSearchParams(search);
  const options: CreateDecaidMockOptions = {};
  const demo = demoRequested(params);
  if (demo) options.uploadMs = DEMO_UPLOAD_MS;
  const speed = Number(params.get('mockSpeed'));
  if (params.has('mockSpeed') && Number.isFinite(speed) && speed > 0) options.speed = speed;
  if (params.get('mockMachine') === '0') options.machineConnected = false;
  if (params.get('mockScale') === '0') options.scaleConnected = false;
  if (params.get('mockGhc') === '1') options.ghc = true;
  if (demo || params.get('mockExamples') === '0') options.seedExamples = false;
  const uploadText = params.get('mockUploadMs')?.trim() ?? '';
  const uploadMs = Number(uploadText);
  if (uploadText !== '' && Number.isFinite(uploadMs) && uploadMs >= 0) options.uploadMs = uploadMs;
  if (params.get('mockNoMachineProfile') === '1') options.machineProfileRoute = false;
  if (params.get('mockGrinders') === '0') options.seedGrinders = false;
  const gateway = params.get('mockGateway');
  if (gateway === 'disabled' || gateway === 'full' || gateway === 'tracking') options.settings = { ...options.settings, gatewayMode: gateway };
  if (params.get('mockEnjoyment') === '100') options.enjoymentScale = 100;
  if (params.get('mockPlugins') === 'none') options.loadedPlugins = [];
  const slowWorkflowText = params.get('mockSlowWorkflow')?.trim() ?? '';
  if (slowWorkflowText === '503') options.slowWorkflowTimeout = true;
  else {
    const slowWorkflowMs = Number(slowWorkflowText);
    if (slowWorkflowText !== '' && Number.isFinite(slowWorkflowMs) && slowWorkflowMs >= 0) options.slowWorkflowMs = slowWorkflowMs;
  }
  if (params.get('mockDrift') === '1') options.renamedReading = { ...DRIFT_RENAMED_READING };
  return options;
}
