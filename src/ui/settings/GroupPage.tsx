/**
 * One of Settings' groups (D232, D233): on a tablet the pane beside the list,
 * the group's name as its h2 over the line saying what it holds; on a phone
 * a page of its own, under a 57 px header as Machine care's (a back arrow to
 * Settings' list, named "Back to Settings", and the group's name as the h1),
 * the line at the top of its cards. Then the group's cards (groups/*.tsx),
 * each a Section. Its own scroll, never the page's.
 *
 * The cards sit in two columns from 840 px of the pane's own width, as Care
 * lays itself out (useOwnLayout.ts: the Chromium 91 WebView has no container
 * queries), and in one column of at most 760 px under it; a phone's page is
 * always one column (groupLayout.tsx).
 */
import { useRef, type ComponentType } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { useOwnLayout } from '../machine/useOwnLayout.ts';
import { routeHref } from '../router.ts';
import { TID } from '../testIds.ts';
import type { SettingsGroupId } from './groupIds.ts';
import { COLUMN_MAX, GroupScroll, GroupWide } from './groupLayout.tsx';
import { settingsGroup } from './groups.tsx';
import { AboutGroup } from './groups/AboutGroup.tsx';
import { CoachGroup } from './groups/CoachGroup.tsx';
import { DataGroup } from './groups/DataGroup.tsx';
import { DisplayGroup } from './groups/DisplayGroup.tsx';
import { DrinksGroup } from './groups/DrinksGroup.tsx';
import { GrinderGroup } from './groups/GrinderGroup.tsx';
import { MachineGroup } from './groups/MachineGroup.tsx';
import { SectionLevel } from './Section.tsx';

/** Two columns of cards from this own width: the pane at 1140x712 and up, never the 962x602 tablet's 682 px. */
export const TWO_COLUMNS_FROM = 840;
const chooseWide = (width: number) => width >= TWO_COLUMNS_FROM;

/** The header's height: Machine care's and History's. */
const HEADER_HEIGHT = 57;

const PAGES: Readonly<Record<SettingsGroupId, ComponentType>> = {
  coach: CoachGroup,
  grinder: GrinderGroup,
  drinks: DrinksGroup,
  machine: MachineGroup,
  display: DisplayGroup,
  data: DataGroup,
  about: AboutGroup,
};

export interface GroupPageProps {
  id: SettingsGroupId;
  /** The tablet's pane beside the list, or a phone's page with its own header. */
  layout: 'pane' | 'page';
}

export function GroupPage({ id, layout }: GroupPageProps) {
  const group = settingsGroup(id);
  const Page = PAGES[id];
  const scroller = useRef<HTMLDivElement>(null);
  const measured = useOwnLayout(scroller, chooseWide);
  // A phone's page is one column whatever its width (a phone on its side has the rail beside it).
  const wide = layout === 'pane' && measured;

  const content = (
    <GroupWide.Provider value={wide}>
      <GroupScroll.Provider value={scroller}>
        <Page />
      </GroupScroll.Provider>
    </GroupWide.Provider>
  );
  const lede = (
    <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
      {group.lede}
    </Typography>
  );

  if (layout === 'page') {
    return (
      <Box data-testid={TID.settingsPane(id)} sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Box
          sx={{
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 0.25,
            minHeight: HEADER_HEIGHT,
            pl: 0.5,
            pr: 2,
            py: 0.5,
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <IconButton
            component="a"
            href={routeHref({ name: 'settings' })}
            data-testid={TID.settingsBack}
            aria-label="Back to Settings"
            sx={{ color: 'text.primary', borderRadius: '12px' }}
          >
            <ArrowBackRoundedIcon />
          </IconButton>
          <Typography variant="h6" component="h1">
            {group.name}
          </Typography>
        </Box>
        <Box ref={scroller} sx={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
          <Box sx={{ p: 2, maxWidth: COLUMN_MAX }}>
            {lede}
            <SectionLevel.Provider value={2}>{content}</SectionLevel.Provider>
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box ref={scroller} data-testid={TID.settingsPane(id)} sx={{ height: '100%', minHeight: 0, overflowY: 'auto' }}>
      <Box sx={{ px: { xs: 2.5, lg: 3.5 }, pt: 2.5, pb: 3 }}>
        <Typography variant="h6" component="h2" sx={{ mt: 0.5, mb: 0.5 }}>
          {group.name}
        </Typography>
        {lede}
        <SectionLevel.Provider value={3}>{content}</SectionLevel.Provider>
      </Box>
    </Box>
  );
}
