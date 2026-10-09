/**
 * The loaded-profile reading (useLoadedProfile.ts), shared: the shell reads
 * Decaid's workflow once on the engine's beat, and the stats card's Profile
 * line, the Shot view's step and the coach note all show that one
 * reading. Outside a provider (a component test) a component reads its own.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { useLoadedProfile, type LoadedProfileState } from './useLoadedProfile.ts';

const LoadedProfileContext = createContext<LoadedProfileState | null>(null);

/**
 * Tests only: hands a component a reading the test chooses, with no read of
 * Decaid's workflow behind it. The app uses LoadedProfileProvider.
 */
export const LoadedProfileContextForTests = LoadedProfileContext;

export function LoadedProfileProvider({ children }: { children: ReactNode }) {
  return <LoadedProfileContext.Provider value={useLoadedProfile()}>{children}</LoadedProfileContext.Provider>;
}

/** The shared reading, or null outside a provider. */
export function useSharedLoadedProfile(): LoadedProfileState | null {
  return useContext(LoadedProfileContext);
}
