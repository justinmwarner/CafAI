/**
 * Settings' seven groups (D233) as the list and a group's page name them:
 * each group's name, the one line under its page's title, its icon, and its
 * plain contents, the status line its row shows while there is nothing live
 * to say (groupStatus.ts). The ids, their order and their addresses are
 * groupIds.ts's, which the router reads; what each group's page holds is
 * GroupPage.tsx's.
 */
import type { ReactElement } from 'react';
import AirRounded from '@mui/icons-material/AirRounded';
import ChatBubbleRounded from '@mui/icons-material/ChatBubbleRounded';
import ContrastRounded from '@mui/icons-material/ContrastRounded';
import InfoRounded from '@mui/icons-material/InfoRounded';
import PowerSettingsNewRounded from '@mui/icons-material/PowerSettingsNewRounded';
import ShieldRounded from '@mui/icons-material/ShieldRounded';
import TuneRounded from '@mui/icons-material/TuneRounded';
import { SETTINGS_GROUP_IDS, type SettingsGroupId } from './groupIds.ts';

export interface SettingsGroup {
  id: SettingsGroupId;
  /** The row's and the page's name: "Data and privacy". */
  name: string;
  /** The one line under the page's title: what the group holds. */
  lede: string;
  icon: ReactElement;
  /** The status line while there is nothing live to say: the group's contents ("Where it runs, model, usage"). */
  contents: string;
}

const GROUPS: Readonly<Record<SettingsGroupId, Omit<SettingsGroup, 'id'>>> = {
  coach: {
    name: 'Coach',
    lede: 'Where the coach runs, its model, fun facts, and what it has cost.',
    icon: <ChatBubbleRounded />,
    contents: 'Where it runs, model, usage',
  },
  grinder: {
    name: 'Grinder',
    lede: 'Your grinder and its setting, so the coach can say how far to turn it.',
    icon: <TuneRounded />,
    contents: 'Your grinder and its setting',
  },
  drinks: {
    name: 'Drinks',
    lede: 'Steam, hot water and flush: what the machine runs, and what each screen shows.',
    icon: <AirRounded />,
    contents: 'Steam, hot water and flush',
  },
  machine: {
    name: 'Machine',
    lede: 'When the machine sleeps and wakes, and how to keep it clean.',
    icon: <PowerSettingsNewRounded />,
    contents: 'Sleep, wake and care',
  },
  display: {
    name: 'Display',
    lede: 'How CafAI looks, the units it shows, and the screensaver.',
    icon: <ContrastRounded />,
    contents: 'Look, units, screensaver',
  },
  data: {
    name: 'Data and privacy',
    lede: 'The copy in Decaid, your data, sharing your usage, and the log.',
    icon: <ShieldRounded />,
    contents: 'Backup, export, sharing, log',
  },
  about: {
    name: 'About',
    lede: "CafAI's and Decaid's versions, what's new, and where to report a problem.",
    icon: <InfoRounded />,
    contents: "Versions and what's new",
  },
};

/** The seven, in the list's order (groupIds.ts). */
export const SETTINGS_GROUPS: readonly SettingsGroup[] = SETTINGS_GROUP_IDS.map((id) => ({ id, ...GROUPS[id] }));

const BY_ID: ReadonlyMap<SettingsGroupId, SettingsGroup> = new Map(SETTINGS_GROUPS.map((group) => [group.id, group]));

export function settingsGroup(id: SettingsGroupId): SettingsGroup {
  return BY_ID.get(id)!;
}
