/**
 * About > Report a problem (D248): GitHub's new issue page for CafAI, the
 * title left to the barista and the body filled in: room for what happened,
 * then CafAI's and Decaid's versions, where CafAI runs and the browser's own
 * line, and a reminder to attach the log (Settings > Data and privacy >
 * Log), naming the log's Share where this device has it and its Copy where
 * it has not (logShare.ts: never in Android's WebView, which is Decaid's).
 * The issue is public, so the reminder says the log holds the chat.
 *
 * It opens as CafAI opens every outside page (src/ui/care/videoPlace.ts,
 * D154): in a browser a new tab, so CafAI stays open; inside Decaid a plain
 * link, which Decaid's navigation guard sends to the system browser, as On
 * Visualizer (D121). A link may still not open there, so inside Decaid the
 * address shows under it, with Copy (copyText, which works over plain http).
 */
import { useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import type { HostEnvironment } from '../../api/types.ts';
import { useServices } from '../../app/services.tsx';
import { outsideLinkProps } from '../care/videoPlace.ts';
import { copyText } from '../history/exportFile.ts';
import { useDecaidVersion } from './decaidVersion.ts';
import { canShare } from './logShare.ts';
import { TID } from '../testIds.ts';

/** GitHub's new issue page for CafAI: package.json's "bugs". */
export const ISSUES_NEW_URL = 'https://github.com/justinmwarner/CafAI/issues/new';

/** The link's and the copy's test ids, for TID (src/ui/testIds.ts) once they have their place in About. */
export const REPORT_PROBLEM_TID = {
  reportProblem: TID.reportProblem,
  /** Inside Decaid only: the address, its Copy and what the copy did. */
  reportProblemAddress: TID.reportProblemAddress,
  reportProblemCopy: TID.reportProblemCopy,
  reportProblemSaid: TID.reportProblemSaid,
} as const;

export interface ReportFacts {
  appVersion: string;
  /** Decaid's version, or null while it is not known (not connected). */
  decaidVersion: string | null;
  host: Pick<HostEnvironment, 'insideDecaid' | 'platform'>;
  /** The browser's user agent: inside Decaid, its WebView's. */
  userAgent: string;
  /** Whether this device's log has Share (canShare); else the log leaves by Copy. */
  logShares: boolean;
}

/** Decaid's platforms (HostEnvironment.platform, lowercased) as their makers write them. */
const PLATFORM_NAMES: Readonly<Record<string, string>> = {
  android: 'Android',
  ios: 'iOS',
  macos: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
};

/** "inside Decaid on Android", "inside Decaid" when Decaid does not say, or "in a browser". */
export function whereText(host: Pick<HostEnvironment, 'insideDecaid' | 'platform'>): string {
  if (!host.insideDecaid) return 'in a browser';
  return host.platform ? `inside Decaid on ${PLATFORM_NAMES[host.platform] ?? host.platform}` : 'inside Decaid';
}

export function issueBody(facts: ReportFacts): string {
  const log = facts.logShares
    ? 'Attach the log: Settings > Data and privacy > Log > Share.'
    : 'Attach the log: Settings > Data and privacy > Log > Copy, then paste it here.';
  return [
    'What happened:',
    '',
    '',
    `CafAI: ${facts.appVersion}`,
    `Decaid: ${facts.decaidVersion ?? 'version unknown'}`,
    `Where: ${whereText(facts.host)}`,
    `Browser: ${facts.userAgent}`,
    '',
    `${log} It holds your chat with the coach, so take out anything you would rather not post.`,
  ].join('\n');
}

/** The new issue's address: the title empty, the body filled in. */
export function issueUrl(facts: ReportFacts): string {
  return `${ISSUES_NEW_URL}?title=&body=${encodeURIComponent(issueBody(facts))}`;
}

const addressSx = {
  flex: 1,
  minWidth: 0,
  height: 48,
  px: 1.5,
  fontFamily: 'monospace',
  fontSize: 13,
  color: 'text.primary',
  bgcolor: 'background.default',
  border: 1,
  borderColor: 'divider',
  borderRadius: 1,
  textOverflow: 'ellipsis',
} as const;

export function ReportProblem() {
  const { appVersion, host } = useServices();
  // The host's, or Decaid's answer to GET /api/v1/info: one request with About's version line.
  const decaidVersion = useDecaidVersion();
  const url = useMemo(
    () => issueUrl({ appVersion, decaidVersion, host, userAgent: navigator.userAgent, logShares: canShare() }),
    [appVersion, decaidVersion, host],
  );
  const [copied, setCopied] = useState<boolean | null>(null);
  // Copy's fallback puts its text area here, as the log's Copy does.
  const root = useRef<HTMLDivElement>(null);

  const copy = () => {
    setCopied(null);
    void copyText(url, root.current ?? undefined).then(setCopied);
  };

  return (
    <Box ref={root}>
      <Button
        variant="tonal"
        component="a"
        href={url}
        {...outsideLinkProps(host)}
        endIcon={<OpenInNewRoundedIcon />}
        data-testid={REPORT_PROBLEM_TID.reportProblem}
        sx={{ minHeight: 48 }}
      >
        Report a problem
      </Button>
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
        Opens GitHub's new issue page with CafAI's and Decaid's versions filled in. It needs a GitHub account, and the issue is public.
      </Typography>
      {host.insideDecaid ? (
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            If GitHub does not open, copy the address into a browser.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.5 }}>
            <Box
              component="input"
              readOnly
              value={url}
              aria-label="Address of the new issue"
              onFocus={(event) => event.currentTarget.select()}
              data-testid={REPORT_PROBLEM_TID.reportProblemAddress}
              sx={addressSx}
            />
            <Button
              startIcon={<ContentCopyIcon />}
              onClick={copy}
              data-testid={REPORT_PROBLEM_TID.reportProblemCopy}
              sx={{ minHeight: 48, flexShrink: 0 }}
            >
              Copy
            </Button>
          </Box>
          {copied !== null ? (
            <Typography
              variant="body2"
              role="status"
              data-testid={REPORT_PROBLEM_TID.reportProblemSaid}
              sx={{ mt: 0.5, color: copied ? 'success.main' : 'error.main' }}
            >
              {copied ? 'Copied.' : 'Copying failed. Tap the address, select all, then copy.'}
            </Typography>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
