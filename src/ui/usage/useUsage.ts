import { createContext, createElement, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { useOptionalServices } from '../../app/services.tsx';
import type { UsageService, UsageState } from '../../usage/service.ts';

/** A test's or a preview's own usage service, in place of the services' (undefined: use the services'). */
const UsageOverride = createContext<UsageService | null | undefined>(undefined);

export function UsageContextForTests({ value, children }: { value: UsageService | null; children: ReactNode }) {
  return createElement(UsageOverride.Provider, { value }, children);
}

const unchanging = () => () => undefined;
const nothing = () => null;

/** Usage sharing and its state (D212), or nulls where the build shares nothing or outside a ServicesProvider. */
export function useUsage(): { usage: UsageService | null; state: UsageState | null } {
  const override = useContext(UsageOverride);
  const services = useOptionalServices();
  const usage = override !== undefined ? override : (services?.usage ?? null);
  const state = useSyncExternalStore(usage ? usage.subscribe : unchanging, usage ? usage.getState : nothing);
  return { usage, state };
}
