/**
 * The settings route (#/settings, #/settings/<group>; D232, D233): Settings'
 * own list of seven groups (SettingsList.tsx) and the group chosen
 * (GroupPage.tsx), laid out as the shell around it is (screenMode.ts).
 *
 * - Tablet: the list as a first column (280 px, 300 px from a 1200 px
 *   window), the group beside it, each scrolling itself. `#/settings` alone
 *   shows the group opened last in this page's life, else Coach, and puts
 *   that group in the address (a replace, so Back is not a trap).
 * - Phone: `#/settings` is the list; `#/settings/<group>` is the group's
 *   page, with a back arrow to the list.
 *
 * A window that crosses the line keeps its route: a phone's group page
 * becomes the tablet's pane with that group chosen, and the other way.
 * Everything in the groups applies as it changes (D234): no card has a
 * Save.
 *
 * The list says how each group stands (groupStatus.ts, D236). Its Coach and
 * Grinder lines read the settings as the groups' cards read and save them:
 * the cards here are handed a repository that tells the list what each read
 * and save returned (statusReads.ts), so a model or a grinder saved beside
 * the list shows in its row at once, with no read of the list's own but one
 * as it opens.
 *
 * Over the list's rows, its search (SettingsSearch.tsx, D236). Its words are
 * kept here while Settings stays open, so the list a phone comes back to
 * from a group's page still shows what was found; what it finds takes the
 * rows' place until it is cleared.
 */
import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import { ServicesProvider, useServices } from '../../app/services.tsx';
import { replaceRoute } from '../router.ts';
import { useScreenMode } from '../shell/screenMode.ts';
import { useDecaidVersion } from './decaidVersion.ts';
import type { SettingsGroupId } from './groupIds.ts';
import { GroupPage } from './GroupPage.tsx';
import { SettingsList } from './SettingsList.tsx';
import { SettingsSearch } from './SettingsSearch.tsx';
import { SettingsWatchContext, watchSettings } from './statusReads.ts';

/** The group shown last in this page's life: what a tablet's `#/settings` opens on. */
let opened: SettingsGroupId | null = null;

/** The first group a tablet shows, before any was opened. */
export const FIRST_GROUP: SettingsGroupId = 'coach';

/** Forget the group opened last, as a page loaded afresh would (for tests). */
export function forgetOpenedGroup(): void {
  opened = null;
}

export interface SettingsScreenProps {
  /** The group in the address, or null for Settings' list. */
  group?: SettingsGroupId | null;
}

/**
 * The services the list and the groups see: the app's, but for the settings
 * repository, whose reads and saves the list is told of (statusReads.ts).
 * One watch for as long as Settings stays open.
 */
function WatchedSettings({ children }: { children: ReactNode }) {
  const services = useServices();
  const { watch, watched } = useMemo(() => {
    const watch = watchSettings(services.storage.settings);
    return { watch, watched: { ...services, storage: { ...services.storage, settings: watch.repository } } };
  }, [services]);
  return (
    <ServicesProvider services={watched}>
      <SettingsWatchContext.Provider value={watch}>{children}</SettingsWatchContext.Provider>
    </ServicesProvider>
  );
}

export function SettingsScreen({ group = null }: SettingsScreenProps) {
  const tablet = useScreenMode() === 'tablet';
  // Decaid's version, asked each time Settings opens, whichever group shows: the log's Share, Email
  // and Copy (Data and privacy) put it in their header, and build it in the tap (decaidVersion.ts).
  useDecaidVersion();
  // A tablet always shows a group beside the list; a phone shows the list until a group is opened.
  const shown = group ?? (tablet ? (opened ?? FIRST_GROUP) : null);
  const [query, setQuery] = useState('');
  const search = <SettingsSearch query={query} onQueryChange={setQuery} />;
  const searching = query.trim() !== '';

  useEffect(() => {
    if (shown !== null) opened = shown;
  }, [shown]);
  // Before paint: the address says the group the pane shows, and Back never lands on a bare #/settings.
  useLayoutEffect(() => {
    if (tablet && group === null && shown !== null) replaceRoute({ name: 'settings', group: shown });
  }, [tablet, group, shown]);

  let content: ReactNode;
  if (tablet && shown !== null) {
    content = (
      <Box sx={{ height: '100%', minHeight: 0, display: 'flex' }}>
        <Box sx={{ flex: 'none', width: { xs: 280, lg: 300 }, minHeight: 0, borderRight: 1, borderColor: 'divider' }}>
          <SettingsList chosen={shown} chevrons={false} search={search} searching={searching} />
        </Box>
        <Box sx={{ flex: '1 1 auto', minWidth: 0, minHeight: 0 }}>
          {/* Keyed by the group, so a group opens at its top. */}
          <GroupPage key={shown} id={shown} layout="pane" />
        </Box>
      </Box>
    );
  } else if (shown === null) {
    content = <SettingsList chosen={null} chevrons search={search} searching={searching} />;
  } else {
    content = <GroupPage key={shown} id={shown} layout="page" />;
  }
  return <WatchedSettings>{content}</WatchedSettings>;
}
