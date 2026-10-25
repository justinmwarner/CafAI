/**
 * Settings > Data and privacy > Backup in Decaid: how the backup into
 * Decaid's store stands (5.15), the line that was About's, and one sentence
 * on what that copy holds. The line follows the mirror while the card is
 * open (a push that lands, one that fails), counts its minutes up, and is
 * left out while CafAI does not yet know how the backup stands (a fresh
 * page, until Decaid's record of the last backup is read), where "Not
 * backed up yet" could be false.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Typography from '@mui/material/Typography';
import { useServices } from '../../app/services.tsx';
import type { KvMirror } from '../../storage/types.ts';
import { TID } from '../testIds.ts';
import { Section } from './Section.tsx';

export const BACKUP_CARD_TITLE = 'Backup in Decaid';

/**
 * What the copy in Decaid holds, and what it never does: the API key and
 * the bridge's code are kept in Decaid only by their own switches in
 * Settings > Coach, which this copy must not seem to contradict.
 */
export const BACKUP_SENTENCE =
  "CafAI copies your bags, versions, shots and settings to Decaid, so a new device or a Decaid update gets them back. Never your API key or the bridge's code: each has its own switch in Settings > Coach for that.";

/** "12 min ago", "5 h ago", "3 days ago": Decaid's record of the last backup can be days old after a quiet spell. */
function agoText(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** mirror.ts's own lastError already reads "Could not back up to Decaid: <reason>"; strip that so the reason is said once, not "Backup paused: Could not back up to Decaid: ...". */
function backupReason(lastError: string): string {
  return lastError.replace(/^Could not back up to Decaid:\s*/, '');
}

export interface BackupStatus {
  lastPushAt: string | null;
  lastError: string | null;
  known: boolean;
}

/**
 * Spec 5.15: the mirror's lastPushAt/lastError. Nothing while the mirror does
 * not know yet how the backup stands: "Not backed up yet" could be false there.
 */
export function backupHealthText({ lastPushAt, lastError, known }: BackupStatus, now: number): string | null {
  if (lastError) return `Backup paused: ${backupReason(lastError)}`;
  if (lastPushAt) return `Backed up to Decaid ${agoText(lastPushAt, now)}`;
  return known ? 'Not backed up yet' : null;
}

/** The mirror's status as it changes: a push that lands while the card is open shows at once. */
export function useBackupStatus(mirror: KvMirror): BackupStatus {
  const subscribe = useCallback((listener: () => void) => mirror.subscribe(listener), [mirror]);
  const lastPushAt = useSyncExternalStore(subscribe, () => mirror.lastPushAt);
  const lastError = useSyncExternalStore(subscribe, () => mirror.lastError);
  const known = useSyncExternalStore(subscribe, () => mirror.backupKnown);
  return { lastPushAt, lastError, known };
}

/** The time, moved on once a minute, so "N min ago" counts up while the card stays open. */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function BackupCard() {
  const { storage } = useServices();
  const status = useBackupStatus(storage.mirror);
  const now = useMinuteClock();
  const backup = backupHealthText(status, now);
  return (
    <Section title={BACKUP_CARD_TITLE}>
      {backup !== null ? (
        <Typography variant="body2" data-testid={TID.backupHealth} sx={{ fontWeight: 600, mb: 0.5 }}>
          {backup}
        </Typography>
      ) : null}
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {BACKUP_SENTENCE}
      </Typography>
    </Section>
  );
}
