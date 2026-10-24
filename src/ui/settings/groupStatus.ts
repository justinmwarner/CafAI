/**
 * The status line under each of Settings' group rows, and its dot (D236):
 * how the group stands, read from what the screens already read, and
 * whether something there needs the barista (no API key, the backup paused,
 * a care step due...). The words always say it too: the dot is never the
 * only signal.
 *
 * For now each row says the group's plain contents and has no dot; the live
 * lines (spec section 6, and section 4's table) come in here, behind the same
 * hook, so the list never changes for them.
 */
import type { SettingsGroupId } from './groupIds.ts';
import { settingsGroup } from './groups.tsx';

export interface GroupStatus {
  /** One line, cut with an ellipsis where it is too long for the row. */
  line: string;
  /** Something in the group needs the barista: the row shows a dot beside the words that say what. */
  attention: boolean;
}

/** A group's status line and dot, as its row shows them. */
export function useGroupStatus(id: SettingsGroupId): GroupStatus {
  return { line: settingsGroup(id).contents, attention: false };
}
