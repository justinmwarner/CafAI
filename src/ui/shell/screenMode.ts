/**
 * The layout the shell has laid out (AppShell.tsx: the window's own, its
 * height held while the barista types), shared with the screens that change
 * with it, as Settings' two panes and a phone's pages do (D232). A screen
 * that read the window itself would take a keyboard shortening a tablet for
 * a phone and swap its panes for pages under the barista mid-sentence, while
 * the shell around it stayed a tablet. Outside the shell (unit tests,
 * previews) it is the window's own layout.
 */
import { createContext, useContext } from 'react';
import { useLayout, type LayoutMode } from './layout.ts';

/** The shell's layout mode, provided by AppShell; null outside it. A primitive, so a re-render of the shell re-renders no screen. */
export const ScreenModeContext = createContext<LayoutMode | null>(null);

/** Tablet or phone, as the shell around the screen has it. */
export function useScreenMode(): LayoutMode {
  const shell = useContext(ScreenModeContext);
  const window = useLayout().mode;
  return shell ?? window;
}
