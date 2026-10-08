import { describe, expect, it } from 'vitest';
import { layoutMode, machineColumnWidth, phoneNav } from './layout.ts';

describe('layoutMode', () => {
  it('is a tablet at 800 x 500 and up, a phone below', () => {
    for (const [w, h] of [[962, 602], [1007, 602], [1140, 712], [1280, 800], [1920, 1200], [1024, 768], [820, 1180]] as const) {
      expect(layoutMode(w, h)).toBe('tablet');
    }
    for (const [w, h] of [[390, 844], [844, 390], [744, 1133], [799, 600], [1000, 499]] as const) {
      expect(layoutMode(w, h)).toBe('phone');
    }
  });
});

describe('phoneNav', () => {
  it('is a bottom bar, or a side rail when the phone lies on its side', () => {
    expect(phoneNav(390, 844)).toBe('bar');
    expect(phoneNav(844, 390)).toBe('rail');
    expect(phoneNav(700, 499)).toBe('rail');
    expect(phoneNav(700, 500)).toBe('bar');
  });
});

describe('machineColumnWidth', () => {
  it('grows with the screen', () => {
    expect(machineColumnWidth(962)).toBe(340);
    expect(machineColumnWidth(1199)).toBe(340);
    expect(machineColumnWidth(1280)).toBe(400);
    expect(machineColumnWidth(1599)).toBe(400);
    expect(machineColumnWidth(1920)).toBe(480);
  });
});
