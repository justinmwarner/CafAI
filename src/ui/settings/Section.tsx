/**
 * One titled card of a Settings group, named for assistive tech by its
 * title (e2e finds a card by that region name). Its heading sits one level
 * under the page's: an h2 under a phone's group page (its h1), an h3 under
 * the tablet's pane (Settings' h1 in the list, the group's h2), which
 * GroupPage.tsx says through SectionLevel. An icon before the title where it
 * helps a card be found, as a drink's card has the machine row's own.
 */
import { createContext, useContext, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';

export type HeadingLevel = 2 | 3;

/** The heading level of a card's title on this page (2 outside a group's page, as in a test of one card). */
export const SectionLevel = createContext<HeadingLevel>(2);

/** A card's own subheading, one level under its title ("On screen" in a drink's card). */
export function useSubheadingLevel(): 'h3' | 'h4' {
  return useContext(SectionLevel) === 2 ? 'h3' : 'h4';
}

export function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  const level = useContext(SectionLevel);
  return (
    <Paper variant="outlined" component="section" aria-label={title} sx={{ p: 2, bgcolor: 'background.paper', minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        {icon ? (
          <Box component="span" aria-hidden sx={{ display: 'flex', color: 'text.secondary' }}>
            {icon}
          </Box>
        ) : null}
        <Typography variant="subtitle1" component={level === 2 ? 'h2' : 'h3'} sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
      </Box>
      {children}
    </Paper>
  );
}
