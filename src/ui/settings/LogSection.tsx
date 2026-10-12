/**
 * Settings > Log (D139): how much the traffic log holds ("214 entries since
 * 21:04"), and Open log, Share, Email, Copy and Clear. The view itself
 * (LogView.tsx) belongs to the app, not this screen, so it stays open when a
 * shot starting takes the screen under it to the Shot view.
 */
import { useSyncExternalStore } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import ClearAllIcon from '@mui/icons-material/ClearAll';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import { formatBytes, formatHourMinute } from '../../traffic/format.ts';
import { trafficLog, type TrafficEntry } from '../../traffic/recorder.ts';
import { TID } from '../testIds.ts';
import { LogActions } from './LogActions.tsx';
import { openLogView } from './logShare.ts';
import { Section } from './Section.tsx';

export const LOG_NOTE =
  "What CafAI sends to and gets from Decaid and the coach, as it went. It stays on this device until the page reloads, and it holds what you and the coach wrote, so share it only with someone you trust. The API key and the bridge's pairing code are never in it.";

/** "214 entries since 21:04, 1.2 MB", or "Nothing recorded since 21:04." for an empty log. */
export function summaryText(entries: readonly TrafficEntry[], since: number): string {
  const first = entries[0];
  if (!first) return `Nothing recorded since ${formatHourMinute(since)}.`;
  let chars = 0;
  for (const entry of entries) chars += entry.headers.length + entry.body.length + entry.raw.length;
  return `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} since ${formatHourMinute(first.at)}, ${formatBytes(chars)}`;
}

export function LogSection() {
  // At most twice a second while traffic flows (src/traffic/recorder.ts).
  const entries = useSyncExternalStore(trafficLog.subscribe, trafficLog.list);
  return (
    <Section title="Log">
      <Box data-testid={TID.logSection}>
        <Typography variant="body2" data-testid={TID.logSummary} sx={{ fontWeight: 600 }}>
          {summaryText(entries, trafficLog.since())}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
          {LOG_NOTE}
        </Typography>
        <LogActions
          entries={entries}
          leading={
            <Button variant="tonal" startIcon={<ReceiptLongIcon />} onClick={openLogView} data-testid={TID.logOpen}>
              Open log
            </Button>
          }
          trailing={
            <Button startIcon={<ClearAllIcon />} onClick={() => trafficLog.clear()} data-testid={TID.logClear}>
              Clear
            </Button>
          }
        />
      </Box>
    </Section>
  );
}
