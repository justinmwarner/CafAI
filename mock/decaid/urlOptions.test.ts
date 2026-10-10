import { describe, expect, it } from 'vitest';
import { DEMO_UPLOAD_MS, mockOptionsFromUrl } from './urlOptions.ts';

describe('mockOptionsFromUrl', () => {
  it('sets nothing without switches, so the defaults hold', () => {
    expect(mockOptionsFromUrl('')).toEqual({});
    expect(mockOptionsFromUrl('?other=1&mockGrinders=1&mockNoMachineProfile=0')).toEqual({});
  });

  it('reads the existing switches as before', () => {
    expect(mockOptionsFromUrl('?mockSpeed=25&mockMachine=0&mockScale=0&mockGhc=1&mockExamples=0')).toEqual({
      speed: 25,
      machineConnected: false,
      scaleConnected: false,
      ghc: true,
      seedExamples: false,
    });
    expect(mockOptionsFromUrl('?mockSpeed=0')).toEqual({});
    expect(mockOptionsFromUrl('?mockSpeed=fast')).toEqual({});
  });

  it('?mockUploadMs=N sets how long the machine takes to take a profile, 0 included', () => {
    expect(mockOptionsFromUrl('?mockUploadMs=3000')).toEqual({ uploadMs: 3000 });
    expect(mockOptionsFromUrl('?mockUploadMs=0')).toEqual({ uploadMs: 0 });
    for (const bad of ['-1', 'slow', '', 'Infinity']) expect(mockOptionsFromUrl(`?mockUploadMs=${bad}`), bad).toEqual({});
  });

  it('?mockNoMachineProfile=1 removes POST /machine/profile, like an older Decaid', () => {
    expect(mockOptionsFromUrl('?mockNoMachineProfile=1')).toEqual({ machineProfileRoute: false });
  });

  it('?mockGrinders=0 leaves the grinder library empty', () => {
    expect(mockOptionsFromUrl('?mockGrinders=0')).toEqual({ seedGrinders: false });
  });

  it('combines switches', () => {
    expect(mockOptionsFromUrl('?mockSpeed=25&mockGrinders=0&mockUploadMs=3000')).toEqual({ speed: 25, seedGrinders: false, uploadMs: 3000 });
  });

  it('?demo=1 starts without the example shot and profile, and with a 1.5 s upload so "Loading…" shows', () => {
    expect(DEMO_UPLOAD_MS).toBe(1500);
    expect(mockOptionsFromUrl('?demo=1')).toEqual({ seedExamples: false, uploadMs: 1500 });
    expect(mockOptionsFromUrl('?demo=1&mockSpeed=25')).toEqual({ speed: 25, seedExamples: false, uploadMs: 1500 });
  });

  it('?mockUploadMs still wins in the demo, and examples stay out whatever ?mockExamples says', () => {
    expect(mockOptionsFromUrl('?demo=1&mockUploadMs=3000')).toEqual({ seedExamples: false, uploadMs: 3000 });
    expect(mockOptionsFromUrl('?demo=1&mockUploadMs=0')).toEqual({ seedExamples: false, uploadMs: 0 });
    expect(mockOptionsFromUrl('?demo=1&mockUploadMs=slow')).toEqual({ seedExamples: false, uploadMs: 1500 });
    expect(mockOptionsFromUrl('?demo=1&mockExamples=1')).toEqual({ seedExamples: false, uploadMs: 1500 });
  });

  it('has no demo defaults without exactly demo=1, or with ?mockDecaid=0', () => {
    for (const search of ['?demo=0', '?demo=true', '?demo=', '?demo=1&mockDecaid=0']) {
      expect(mockOptionsFromUrl(search), search).toEqual({});
    }
  });

  it('?mockGateway=<mode> starts settings.gatewayMode there (D1)', () => {
    expect(mockOptionsFromUrl('?mockGateway=full')).toEqual({ settings: { gatewayMode: 'full' } });
    expect(mockOptionsFromUrl('?mockGateway=tracking')).toEqual({ settings: { gatewayMode: 'tracking' } });
    expect(mockOptionsFromUrl('?mockGateway=disabled')).toEqual({ settings: { gatewayMode: 'disabled' } });
    for (const bad of ['bogus', '', '1']) expect(mockOptionsFromUrl(`?mockGateway=${bad}`), bad).toEqual({});
  });

  it('?mockEnjoyment=100 switches to the 0.8.6 enjoyment scale (D2)', () => {
    expect(mockOptionsFromUrl('?mockEnjoyment=100')).toEqual({ enjoymentScale: 100 });
    for (const other of ['10', 'bogus', '']) expect(mockOptionsFromUrl(`?mockEnjoyment=${other}`), other).toEqual({});
  });

  it('?mockPlugins=none lists every plugin unloaded (D3)', () => {
    expect(mockOptionsFromUrl('?mockPlugins=none')).toEqual({ loadedPlugins: [] });
    expect(mockOptionsFromUrl('?mockPlugins=all')).toEqual({});
  });

  it('?mockSlowWorkflow=<ms> delays the workflow PUT; =503 answers Decaid\'s hang (D9)', () => {
    expect(mockOptionsFromUrl('?mockSlowWorkflow=5000')).toEqual({ slowWorkflowMs: 5000 });
    expect(mockOptionsFromUrl('?mockSlowWorkflow=0')).toEqual({ slowWorkflowMs: 0 });
    expect(mockOptionsFromUrl('?mockSlowWorkflow=503')).toEqual({ slowWorkflowTimeout: true });
    for (const bad of ['-1', 'slow', '']) expect(mockOptionsFromUrl(`?mockSlowWorkflow=${bad}`), bad).toEqual({});
  });

  it('combines the new switches with the existing ones', () => {
    expect(mockOptionsFromUrl('?mockGateway=full&mockEnjoyment=100&mockPlugins=none&mockSlowWorkflow=503')).toEqual({
      settings: { gatewayMode: 'full' },
      enjoymentScale: 100,
      loadedPlugins: [],
      slowWorkflowTimeout: true,
    });
  });
});
