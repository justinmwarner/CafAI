/**
 * How a group's cards sit on its page (GroupPage.tsx): two columns from 840 px
 * of the pane's own width, one column of at most 760 px under it, and a
 * phone's page always one column. A group says which cards share a column
 * (CardColumns, CardColumn); a card that arranges itself by the room it has,
 * as the drinks' three across do, reads it (useGroupWide); and a card that
 * brings part of itself into view scrolls the group's own column
 * (useGroupScroll), never the page.
 */
import { Children, createContext, useContext, type ReactNode, type RefObject } from 'react';
import Box from '@mui/material/Box';

/** One column of cards is never wider than this, as Settings' column always was. */
export const COLUMN_MAX = 760;

export const GroupWide = createContext(false);
export const GroupScroll = createContext<RefObject<HTMLElement | null> | null>(null);

/** The group has 840 px of its own width or more: room for two columns of cards, or the drinks' three across. */
export function useGroupWide(): boolean {
  return useContext(GroupWide);
}

/** The group's scrolling element, for bringing part of a card into view by scrolling it alone (reveal.ts); null outside a group's page. */
export function useGroupScroll(): RefObject<HTMLElement | null> | null {
  return useContext(GroupScroll);
}

const columnSx = { display: 'grid', gap: 2, alignContent: 'start', minWidth: 0 } as const;

/** Cards that share a column on a wide pane, top to bottom. */
export function CardColumn({ children }: { children: ReactNode }) {
  return <Box sx={columnSx}>{children}</Box>;
}

/**
 * A group's cards: its CardColumns side by side on a wide pane, one after the
 * other in one column under it (the first column's cards first). A group of
 * one column keeps to one column, at most 760 px, whatever the width.
 */
export function CardColumns({ children }: { children: ReactNode }) {
  const wide = useGroupWide();
  const columns = Children.toArray(children).length;
  if (wide && columns > 1) {
    return <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 2, alignItems: 'start' }}>{children}</Box>;
  }
  return <Box sx={{ ...columnSx, maxWidth: COLUMN_MAX }}>{children}</Box>;
}
