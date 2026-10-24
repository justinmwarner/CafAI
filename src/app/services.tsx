import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { CoachState, Services } from './types.ts';
import type { TelemetryState } from '../api/types.ts';
import { DEFAULT_TEMPERATURE_UNIT, type TemperatureUnit } from '../coach/temperature.ts';
import { DEFAULT_CLOCK } from '../storage/settings.ts';
import type { Appearance, ClockFormat, ScreensaverSetting } from '../storage/types.ts';

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({ services, children }: { services: Services; children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices() needs a <ServicesProvider>.');
  return services;
}

/** The services, or null outside a ServicesProvider: for a part that also draws on its own (a card in a test or a preview). */
export function useOptionalServices(): Services | null {
  return useContext(ServicesContext);
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

/** Settings > Screensaver (D225): on or off, and which. */
export function useScreensaverSetting(): ScreensaverSetting {
  const { screensaver } = useServices();
  return useSyncExternalStore(screensaver.subscribe, screensaver.get);
}

const unchanging = () => () => undefined;
const inCelsius = () => DEFAULT_TEMPERATURE_UNIT;

/**
 * The barista's temperature unit (D172). °C outside a ServicesProvider,
 * as in a card's own test, so a temperature always reads as something.
 */
export function useTemperatureUnit(): TemperatureUnit {
  const store = useContext(ServicesContext)?.temperatureUnit;
  return useSyncExternalStore(store?.subscribe ?? unchanging, store?.get ?? inCelsius);
}

const inTwentyFourHours = () => DEFAULT_CLOCK;
const tdsShown = () => true;

/**
 * The clock times are shown and typed in (D245). 24-hour outside a
 * ServicesProvider or without the store (a card's own test, a preview), as
 * every time read before the choice came.
 */
export function useClockFormat(): ClockFormat {
  const store = useContext(ServicesContext)?.displayPrefs;
  return useSyncExternalStore(store?.subscribe ?? unchanging, store?.clock ?? inTwentyFourHours);
}

/** Whether shot cards and History show the TDS cell and the extraction (D246): on, as before, outside a ServicesProvider or without the store. */
export function useShowTds(): boolean {
  const store = useContext(ServicesContext)?.displayPrefs;
  return useSyncExternalStore(store?.subscribe ?? unchanging, store?.showTds ?? tdsShown);
}

const noneChosen = () => null;

/**
 * The unit words are rewritten into (D176): the coach's, and CafAI's own
 * change lines kept in °C. None until the barista has chosen a unit, so a
 * barista who never did reads every word as it was written, as before °F
 * (D172), even a °F the coach gave because they asked for it.
 */
export function useWordsTemperatureUnit(): TemperatureUnit | null {
  const store = useContext(ServicesContext)?.temperatureUnit;
  const chosenUnit = useCallback(() => (store?.chosen() ? store.get() : null), [store]);
  return useSyncExternalStore(store?.subscribe ?? unchanging, store ? chosenUnit : noneChosen);
}
