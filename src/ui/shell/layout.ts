/**
 * Which layout the screen gets. A pure function of the viewport, re-read on
 * resize and rotation: every Decent tablet (962x602 and up) and an iPad are
 * tablets; a phone, in either orientation, is a phone. A phone on its side
 * keeps its height for the content: the tabs become a rail.
 */
import { useSyncExternalStore } from 'react';

export type LayoutMode = 'tablet' | 'phone';
export type PhoneNav = 'bar' | 'rail';

export function layoutMode(width: number, height: number): LayoutMode {
  return width >= 800 && height >= 500 ? 'tablet' : 'phone';
}

export function phoneNav(_width: number, height: number): PhoneNav {
  return height < 500 ? 'rail' : 'bar';
}

/** The tablet's machine column: wider on bigger screens, so the readouts and buttons breathe. */
export function machineColumnWidth(width: number): number {
  if (width < 1200) return 340;
  if (width < 1600) return 400;
  return 480;
}

export interface Layout {
  mode: LayoutMode;
  nav: PhoneNav;
  width: number;
  height: number;
}

/** The layout for a window of this size. */
export function layoutFor(width: number, height: number): Layout {
  return { mode: layoutMode(width, height), nav: phoneNav(width, height), width, height };
}

let cached: Layout | null = null;

function read(): Layout {
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (cached && cached.width === width && cached.height === height) return cached;
  cached = layoutFor(width, height);
  return cached;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  window.addEventListener('orientationchange', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
    window.removeEventListener('orientationchange', onChange);
  };
}

const SERVER: Layout = { mode: 'tablet', nav: 'bar', width: 962, height: 602 };

/** The layout for the window right now; re-renders only when it changes size. */
export function useLayout(): Layout {
  return useSyncExternalStore(subscribe, read, () => SERVER);
}
