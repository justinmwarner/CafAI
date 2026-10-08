import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { CoachState, Services } from './types.ts';
import type { TelemetryState } from '../api/types.ts';
import type { Appearance } from '../storage/types.ts';

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({ services, children }: { services: Services; children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices() needs a <ServicesProvider>.');
  return services;
}

/**
 * Subscribe to one slice of live telemetry. The component re-renders only when
 * the selected value changes (Object.is), so a WebSocket tick never re-renders
 * the whole app; select primitives or stable objects.
 */
export function useTelemetry<T>(selector: (state: TelemetryState) => T): T {
  const { telemetry } = useServices();
  return useSyncExternalStore(telemetry.subscribe, () => selector(telemetry.getState()));
}

/** Subscribe to the coach engine's state. */
export function useCoach<T>(selector: (state: CoachState) => T): T {
  const { coach } = useServices();
  return useSyncExternalStore(coach.subscribe, () => selector(coach.getState()));
}

/** The appearance to render (Settings > Appearance). */
export function useAppearance(): Appearance {
  const { appearance } = useServices();
  return useSyncExternalStore(appearance.subscribe, appearance.get);
}
