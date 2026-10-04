import { describe, expect, it } from 'vitest';
import { mockOptionsFromUrl } from './urlOptions.ts';

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
});
