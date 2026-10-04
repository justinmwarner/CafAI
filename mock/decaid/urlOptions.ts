/**
 * The mock's URL switches (`?mockSpeed=25&mockGrinders=0`), read once when the
 * mock starts in the browser. They are listed in mock/browser.ts; a switch
 * that is absent or unreadable leaves the default alone.
 */
import type { CreateDecaidMockOptions } from './index.ts';

export function mockOptionsFromUrl(search: string): CreateDecaidMockOptions {
  const params = new URLSearchParams(search);
  const options: CreateDecaidMockOptions = {};
  const speed = Number(params.get('mockSpeed'));
  if (params.has('mockSpeed') && Number.isFinite(speed) && speed > 0) options.speed = speed;
  if (params.get('mockMachine') === '0') options.machineConnected = false;
  if (params.get('mockScale') === '0') options.scaleConnected = false;
  if (params.get('mockGhc') === '1') options.ghc = true;
  if (params.get('mockExamples') === '0') options.seedExamples = false;
  const uploadText = params.get('mockUploadMs')?.trim() ?? '';
  const uploadMs = Number(uploadText);
  if (uploadText !== '' && Number.isFinite(uploadMs) && uploadMs >= 0) options.uploadMs = uploadMs;
  if (params.get('mockNoMachineProfile') === '1') options.machineProfileRoute = false;
  if (params.get('mockGrinders') === '0') options.seedGrinders = false;
  return options;
}
