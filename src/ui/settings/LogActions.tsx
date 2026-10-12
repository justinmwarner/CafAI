/**
 * Share, Email and Copy for the traffic log (D139), in Settings > Log and in
 * the log view. Each takes every entry it is given (the whole log, or the
 * log as it stood when the view was paused), whatever the view's filter
 * shows, so whoever reads it sees the whole exchange. Nothing is built until
 * a tap, and then in the tap itself, as the browser needs for sharing and
 * for copying over plain http: Email's link too, set on the link as it is
 * followed.
 */
import { useRef, useState, type MouseEvent, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import ShareIcon from '@mui/icons-material/Share';
import { useServices } from '../../app/services.tsx';
import { emailBody, formatTrafficLog, logFileName, logTitle, mailtoHref } from '../../traffic/format.ts';
import type { TrafficEntry } from '../../traffic/recorder.ts';
import { copyText } from '../history/exportFile.ts';
import { TID } from '../testIds.ts';
import { canShare, shareText, useLogContext } from './logShare.ts';

export const COPIED = 'Copied the whole log.';
export const COPY_FAILED = "Copying failed: this browser didn't allow it.";
export const SHARE_FAILED = 'Sharing failed. Copy the log instead.';
/** Inside Decaid there is no share sheet and no mailto: (logShare.ts). */
export const INSIDE_DECAID_NOTE = "Decaid's own window can't open email or another app: copy the log, then paste it where you want it.";

type Said = { ok: boolean; text: string };

export function LogActions({
  entries,
  leading,
  trailing,
}: {
  /** The entries to send, read at the tap. */
  entries: () => readonly TrafficEntry[];
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  const { host } = useServices();
  const context = useLogContext();
  const [said, setSaid] = useState<Said | null>(null);
  // Where Copy's fallback puts its text area: here, inside the log view's dialog when it is in one.
  const root = useRef<HTMLDivElement>(null);
  const sharable = canShare();
  const emailable = !host.insideDecaid;

  const share = () => {
    const at = context();
    setSaid(null);
    void shareText(formatTrafficLog(entries(), at), logTitle(at.now), logFileName(at.now)).then((outcome) => {
      if (outcome === 'failed') setSaid({ ok: false, text: SHARE_FAILED });
    });
  };
  // The link is followed after the tap's handlers: the log as it is now goes in it.
  const email = (event: MouseEvent<HTMLElement>) => {
    const at = context();
    event.currentTarget.setAttribute('href', mailtoHref(logTitle(at.now), emailBody(entries(), at)));
  };
  const copy = () => {
    setSaid(null);
    void copyText(formatTrafficLog(entries(), context()), root.current ?? undefined).then((ok) => setSaid({ ok, text: ok ? COPIED : COPY_FAILED }));
  };

  return (
    <Box ref={root}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
        {leading}
        {sharable ? (
          <Button startIcon={<ShareIcon />} onClick={share} data-testid={TID.logShare}>
            Share
          </Button>
        ) : null}
        {emailable ? (
          <Button href="mailto:" onClick={email} startIcon={<EmailOutlinedIcon />} data-testid={TID.logEmail}>
            Email
          </Button>
        ) : null}
        <Button startIcon={<ContentCopyIcon />} onClick={copy} data-testid={TID.logCopy}>
          Copy
        </Button>
        {trailing}
      </Box>
      {!sharable && !emailable ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
          {INSIDE_DECAID_NOTE}
        </Typography>
      ) : null}
      {said ? (
        <Typography variant="body2" role="status" data-testid={TID.logSaid} sx={{ color: said.ok ? 'success.main' : 'error.main', mt: 0.5 }}>
          {said.text}
        </Typography>
      ) : null}
    </Box>
  );
}
