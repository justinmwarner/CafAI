/**
 * Settings > Log (D139): how much the traffic log holds ("214 entries since
 * 21:04"), and Open log, Share, Email, Copy and Clear. The summary is read
 * every 2 seconds, never on each entry, so traffic never re-renders Settings;
 * Share, Email and Copy read the log at the tap. The view itself
 * (LogView.tsx) belongs to the app, not this screen, so it stays open when a
 * shot starting takes the screen under it to the Shot view.
 */
import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import ClearAllIcon from '@mui/icons-material/ClearAll';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import { formatBytes, formatHourMinute } from '../../traffic/format.ts';
import { trafficLog, type TrafficStats } from '../../traffic/recorder.ts';
import { TID } from '../testIds.ts';
import { LogActions } from './LogActions.tsx';
import { openLogView } from './logShare.ts';
import { Section } from './Section.tsx';

export const LOG_NOTE =
  "What CafAI sends to and gets from Decaid and the coach, as it went. It stays on this device until the page reloads, and it holds what you and the coach wrote, so share it only with someone you trust. The API key and the bridge's pairing code are never in it.";

/** How often the summary is read while Settings is open. */
export const SUMMARY_EVERY_MS = 2000;

/** "214 entries since 21:04, 1.2 MB", or "Nothing recorded since 21:04." for an empty log. */
export function summaryText(stats: TrafficStats): string {
  if (stats.count === 0 || stats.oldestAt === null) return `Nothing recorded since ${formatHourMinute(stats.since)}.`;
  return `${stats.count} ${stats.count === 1 ? 'entry' : 'entries'} since ${formatHourMinute(stats.oldestAt)}, ${formatBytes(stats.chars)}`;
}

/** The summary, and a way to read it at once (after Clear). The same text never re-renders. */
function useSummary(): [string, () => void] {
  const read = useCallback(() => summaryText(trafficLog.stats()), []);
  const [text, setText] = useState(read);
  const refresh = useCallback(() => setText(read()), [read]);
  useEffect(() => {
    const timer = setInterval(refresh, SUMMARY_EVERY_MS);
    return () => clearInterval(timer);
  }, [refresh]);
  return [text, refresh];
}

const readLog = () => trafficLog.list();

export function LogSection() {
  const [summary, refresh] = useSummary();
  return (
    <Section title="Log">
      <Box data-testid={TID.logSection}>
        <Typography variant="body2" data-testid={TID.logSummary} sx={{ fontWeight: 600 }}>
          {summary}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
          {LOG_NOTE}
        </Typography>
        <LogActions
          entries={readLog}
          leading={
            <Button variant="tonal" startIcon={<ReceiptLongIcon />} onClick={openLogView} data-testid={TID.logOpen}>
              Open log
            </Button>
          }
          trailing={
            <Button
              startIcon={<ClearAllIcon />}
              onClick={() => {
                trafficLog.clear();
                refresh();
              }}
              data-testid={TID.logClear}
            >
              Clear
            </Button>
          }
        />
      </Box>
    </Section>
  );
}
