/**
 * A moment in Decent's video (D154): a play icon and the time, "1:48", in
 * tabular figures. Where the player plays in place, a button that starts it
 * there and stays marked (the accent wash, aria-pressed) while that moment
 * plays; elsewhere a link to YouTube at that time, which Decaid opens in the
 * system browser.
 */
import Button from '@mui/material/Button';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PlayCircleRoundedIcon from '@mui/icons-material/PlayCircleRounded';
import { formatMoment, watchUrl } from './careGuide.ts';

export interface MomentButtonProps {
  seconds: number;
  /** What the moment shows, for its name: "Flush the group head", "Daily". */
  what: string;
  /** A link to YouTube instead of a button (videoPlace.ts). */
  link: boolean;
  /** How a link opens (outsideLinkProps). */
  linkProps?: { target?: '_blank'; rel?: string };
  /** A button's: whether this moment is the one playing. */
  playing?: boolean;
  onPlay?: () => void;
  testId: string;
  /** In a step's row: up 10 px, so the time sits on the title's line. */
  nudge?: boolean;
}

export function MomentButton({ seconds, what, link, linkProps, playing = false, onPlay, testId, nudge = false }: MomentButtonProps) {
  const time = formatMoment(seconds);
  const sx = {
    flex: 'none',
    alignSelf: 'start',
    minHeight: 48,
    pl: 1,
    pr: 1.5,
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
    '& .MuiButton-startIcon': { mr: 0.75 },
    // The "opens elsewhere" icon after a link's time, smaller than the play icon.
    '& .MuiButton-endIcon > *:nth-of-type(1)': { fontSize: 16 },
    ...(nudge ? { mt: '-10px' } : null),
    ...(playing ? { bgcolor: 'cafai.accentSoft', '&:hover': { bgcolor: 'cafai.accentSoft' } } : null),
  } as const;
  if (link) {
    return (
      <Button
        component="a"
        href={watchUrl(seconds)}
        {...linkProps}
        variant="text"
        startIcon={<PlayCircleRoundedIcon />}
        endIcon={<OpenInNewRoundedIcon />}
        aria-label={`Watch from ${time} on YouTube: ${what}`}
        data-testid={testId}
        sx={sx}
      >
        {time}
      </Button>
    );
  }
  return (
    <Button
      variant="text"
      startIcon={<PlayCircleRoundedIcon />}
      aria-pressed={playing}
      aria-label={`Play from ${time}: ${what}`}
      data-testid={testId}
      onClick={onPlay}
      sx={sx}
    >
      {time}
    </Button>
  );
}
