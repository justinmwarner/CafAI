/**
 * Settings > About's Decaid-specific lines (4.6, D96): the running version
 * against the one CafAI was verified with, and anything Decaid sent that
 * CafAI did not expect. AboutCard.tsx keeps finding the running version
 * (host or decaid.getInfo()) and the plain "CafAI <version>" line; this
 * component is everything that follows from it. The backup's line, which
 * was last here, is Data and privacy's now (BackupCard.tsx).
 */
import { useState, useSyncExternalStore } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { driftLog, formatDriftReport } from '../../api/drift.ts';
import { VERIFIED_DECAID } from '../../api/decaidVersion.ts';
import { useServices } from '../../app/services.tsx';
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

const mutedSx = { color: 'text.secondary' } as const;

export function AboutDecaid({ decaidVersion }: { decaidVersion: string | null }) {
  const { appVersion } = useServices();
  const entries = useSyncExternalStore(driftLog.subscribe, driftLog.list);
  const [copied, setCopied] = useState<boolean | null>(null);

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
    </Box>
  );
}
