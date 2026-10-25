// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { createFakeServices } from '../ui/testing/fakeServices.ts';
import { createFakeServicesShowing } from '../ui/testing/displayServices.ts';
import { ServicesProvider, useClockFormat, useShowTds } from './services.tsx';
import type { Services } from './types.ts';

function inside(services: Services) {
  return ({ children }: { children: ReactNode }) => <ServicesProvider services={services}>{children}</ServicesProvider>;
}

describe('useClockFormat and useShowTds (D245, D246)', () => {
  it('read 24-hour and shown outside a ServicesProvider, and without the store', () => {
    expect(renderHook(() => [useClockFormat(), useShowTds()]).result.current).toEqual(['24h', true]);
    const wrapper = inside(createFakeServices());
    expect(renderHook(() => [useClockFormat(), useShowTds()], { wrapper }).result.current).toEqual(['24h', true]);
  });

  it('read the saved choices, and follow a change at once', async () => {
    const services = createFakeServicesShowing({ clock: '12h' });
    const { result } = renderHook(() => [useClockFormat(), useShowTds()], { wrapper: inside(services) });
    expect(result.current).toEqual(['12h', true]);
    await act(async () => {
      await services.displayPrefs.setClock('24h');
      await services.displayPrefs.setShowTds(false);
    });
    expect(result.current).toEqual(['24h', false]);
  });
});
