/**
 * Settings > About's Decaid-specific lines (4.6, 5.15, D96): the running
 * version against the one CafAI was verified with, anything Decaid sent
 * that CafAI did not expect, and the health of the backup into Decaid's
 * store. SettingsScreen.tsx keeps finding the running version (host or
 * decaid.getInfo()) and the plain "CafAI <version>" line; this component
 * is everything that follows from it.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { driftLog, formatDriftReport } from '../../api/drift.ts';
import { VERIFIED_DECAID } from '../../api/decaidVersion.ts';
import { useServices } from '../../app/services.tsx';
import type { KvMirror } from '../../storage/types.ts';
import { copyText } from '../history/exportFile.ts';
import { TID } from '../testIds.ts';

/** Spec 4.6: versions compare only on their numeric part, so "0.8.8+2850" reads as "0.8.8". */
function numericVersion(version: string): readonly [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True only when both versions parse and `running` is strictly behind `verified`. */
export function isOlderDecaid(running: string, verified: string): boolean {
  const a = numericVersion(running);
  const b = numericVersion(verified);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}

const OLDER_NOTE = 'Older than the Decaid CafAI was checked against; update Decaid if something does not work.';

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

interface BackupStatus {
  lastPushAt: string | null;
  lastError: string | null;
  known: boolean;
}

/**
 * Spec 5.15: the mirror's lastPushAt/lastError. Nothing while the mirror does
 * not know yet how the backup stands (a fresh page, until Decaid's record of
 * the last backup is read): "Not backed up yet" could be false there.
 */
function backupHealthText({ lastPushAt, lastError, known }: BackupStatus, now: number): string | null {
  if (lastError) return `Backup paused: ${backupReason(lastError)}`;
  if (lastPushAt) return `Backed up to Decaid ${agoText(lastPushAt, now)}`;
  return known ? 'Not backed up yet' : null;
}

/** The mirror's status as it changes: a push that lands while About is open shows at once. */
function useBackupStatus(mirror: KvMirror): BackupStatus {
  const subscribe = useCallback((listener: () => void) => mirror.subscribe(listener), [mirror]);
  const lastPushAt = useSyncExternalStore(subscribe, () => mirror.lastPushAt);
  const lastError = useSyncExternalStore(subscribe, () => mirror.lastError);
  const known = useSyncExternalStore(subscribe, () => mirror.backupKnown);
  return { lastPushAt, lastError, known };
}

/** The time, moved on once a minute, so "N min ago" counts up while About stays open. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const mutedSx = { color: 'text.secondary' } as const;

export function AboutDecaid({ decaidVersion }: { decaidVersion: string | null }) {
  const { appVersion, storage } = useServices();
  const entries = useSyncExternalStore(driftLog.subscribe, driftLog.list);
  const [copied, setCopied] = useState<boolean | null>(null);
  const backupStatus = useBackupStatus(storage.mirror);
  const now = useMinuteClock();
  const backup = backupHealthText(backupStatus, now);

  const copyReport = () => {
    const report = formatDriftReport(entries, { appVersion, decaidVersion, verifiedWith: VERIFIED_DECAID.release });
    void copyText(report).then(setCopied);
  };

  return (
    <Box data-testid={TID.aboutDecaid}>
      <Typography variant="body2" sx={{ color: decaidVersion ? 'text.primary' : 'text.secondary' }}>
        {decaidVersion ? `Decaid ${decaidVersion} (CafAI was verified with ${VERIFIED_DECAID.release})` : 'Decaid version unknown (not connected)'}
      </Typography>
      {decaidVersion && isOlderDecaid(decaidVersion, VERIFIED_DECAID.release) ? (
        <Typography variant="body2" sx={mutedSx}>
          {OLDER_NOTE}
        </Typography>
      ) : null}
      {entries.length > 0 ? (
        <Box sx={{ mt: 1 }}>
          <Typography variant="body2">{`Decaid sent ${entries.length} ${entries.length === 1 ? 'thing' : 'things'} CafAI did not expect`}</Typography>
          <Box component="ul" data-testid={TID.driftReport} sx={{ m: 0, pl: 3 }}>
            {entries.map((entry) => (
              <Typography key={`${entry.source}|${entry.problem}`} component="li" variant="body2">
                {`${entry.source}: ${entry.problem}`}
              </Typography>
            ))}
          </Box>
          <Button data-testid={TID.copyDriftReport} size="small" onClick={copyReport} sx={{ minHeight: 48 }}>
            Copy report
          </Button>
          {copied !== null ? (
            <Typography variant="body2" role="status" sx={{ color: copied ? 'success.main' : 'error.main' }}>
              {copied ? 'Copied.' : 'Copying failed. Tap the text, select all, then copy.'}
            </Typography>
          ) : null}
        </Box>
      ) : null}
      {backup !== null ? (
        <Typography variant="body2" data-testid={TID.backupHealth} sx={{ ...mutedSx, mt: 1 }}>
          {backup}
        </Typography>
      ) : null}
    </Box>
  );
}
