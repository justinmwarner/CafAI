// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { useTheme } from '@mui/material/styles';
import { ServicesProvider } from '../app/services.tsx';
import type { Appearance } from '../storage/types.ts';
import { AppTheme } from './AppTheme.tsx';
import { bootColors } from './appearance.ts';
import { buildPalette, namedTint } from './palette.ts';
import { createFakeServices } from './testing/fakeServices.ts';

/** What every component under AppTheme gets from the theme. */
function Probe() {
  const { palette } = useTheme();
  return <p>{`${palette.mode} ${palette.primary.main}`}</p>;
}

function renderAppTheme(appearance: Appearance) {
  const services = createFakeServices({
    storage: {
      settings: { model: 'claude-opus-5-5', grinderName: null, grinderSetting: null, grinderId: null, activeBagId: null, appearance },
    },
  });
  const { container } = render(
    <ServicesProvider services={services}>
      <AppTheme>
        <Probe />
      </AppTheme>
    </ServicesProvider>,
  );
  return { services, shown: () => container.textContent };
}

/** A device whose dark-mode preference the test sets and flips (jsdom has no matchMedia). */
function stubPrefersDark(initial: boolean) {
  const listeners = new Set<() => void>();
  const list = {
    matches: initial,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_type: string, listener: () => void) => void listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => void listeners.delete(listener),
  };
  window.matchMedia = (() => list) as unknown as typeof window.matchMedia;
  return {
    set(dark: boolean) {
      list.matches = dark;
      for (const listener of [...listeners]) listener();
    },
  };
}

/** The global CSS that CssBaseline put in the page. */
const globalCss = () => [...document.head.querySelectorAll('style')].map((style) => style.textContent).join('');

/** The boot screens' colours as the app left them in storage. */
const savedBootColors = () => JSON.parse(localStorage.getItem('cafai.appearance.boot') ?? 'null') as unknown;

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe('AppTheme', () => {
  it('builds the theme from the appearance in Settings, and follows a change at once', () => {
    const { services, shown } = renderAppTheme({ mode: 'light', tint: 'matcha' });
    expect(shown()).toBe(`light ${buildPalette('light', namedTint('matcha')).accent}`);
    // Native controls (select lists, scrollbars) follow the mode too.
    expect(globalCss()).toContain('color-scheme:light');

    act(() => services.appearance.preview({ mode: 'dark', tint: 'crema' }));
    expect(shown()).toBe(`dark ${buildPalette('dark', namedTint('crema')).accent}`);
    expect(globalCss()).toContain('color-scheme:dark');
    expect(globalCss()).not.toContain('color-scheme:light');
  });

  it('keeps the look it shows for the boot screens of the next start', () => {
    const { services } = renderAppTheme({ mode: 'light', tint: 'matcha' });
    expect(savedBootColors()).toEqual(bootColors(buildPalette('light', namedTint('matcha'))));

    act(() => services.appearance.preview({ mode: 'dark', tint: 'crema' }));
    expect(savedBootColors()).toEqual(bootColors(buildPalette('dark', namedTint('crema'))));
  });

  it("in Auto, follows the device's dark-mode preference as it changes", () => {
    const device = stubPrefersDark(true);
    const { shown } = renderAppTheme({ mode: 'auto', tint: 'blueberry' });
    expect(shown()).toBe(`dark ${buildPalette('dark', namedTint('blueberry')).accent}`);

    act(() => device.set(false));
    expect(shown()).toBe(`light ${buildPalette('light', namedTint('blueberry')).accent}`);
  });
});
