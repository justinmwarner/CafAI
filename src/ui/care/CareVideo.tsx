/**
 * Decent's video on the Care screen (D154). Nothing comes from YouTube until
 * a tap: before it, CafAI's own poster (one short row on a narrow screen);
 * after it, YouTube's player at the moment tapped, made again on every tap
 * (a new key), so a moment always starts where it says. Where the player
 * cannot play in place (inside Decaid off Android) there is no poster: the
 * card says Decaid opens the video in the browser, and the moments are links.
 */
import { useEffect, useId, useRef, type RefObject } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import { TID } from '../testIds.ts';
import { CARE_VIDEO, CARE_VIDEO_MINUTES, embedUrl, formatMoment, watchUrl } from './careGuide.ts';

/** What plays: its moment, the words for it, and the tap that started it. */
export interface Playing {
  start: number;
  /** The moment that started it (a step's id, a routine's id), or 'poster'. */
  key: string;
  /** "Flush the group head"; null from the poster. */
  label: string | null;
  /** Counts the taps: a new player for each. */
  take: number;
}

export interface CareVideoProps {
  /** YouTube's player can play here (videoPlace.ts); otherwise links. */
  inPlace: boolean;
  /** The narrow screen: one short row until a tap, and the player brought into view when it opens. */
  compact: boolean;
  playing: Playing | null;
  onPlayFromStart(): void;
  linkProps: { target?: '_blank'; rel?: string };
  /** The tallest the player may be, so all of it fits in view (a phone on its side); null for no limit. */
  maxPlayerHeight?: number | null;
}

export const LOADS_FROM_YOUTUBE = 'Loads from YouTube when you tap play.';
export const OPENS_IN_BROWSER = 'Decaid opens the video in your browser: each time starts it at that step.';
const DETAILS = `${CARE_VIDEO.channel} · ${CARE_VIDEO_MINUTES} · ${CARE_VIDEO.year}`;
const PLAY_NAME = `Play Decent's video: ${CARE_VIDEO.title}`;

const cardSx = { borderRadius: '16px', p: 1.5, bgcolor: 'background.paper' } as const;
/** 16:9 at the card's width. */
const frameSx = { position: 'relative', width: '100%', aspectRatio: '16 / 9', borderRadius: '12px', overflow: 'hidden' } as const;

function playCircleSx(size: number) {
  return {
    width: size,
    height: size,
    flex: 'none',
    borderRadius: '50%',
    bgcolor: 'primary.main',
    color: 'primary.contrastText',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  } as const;
}

function Title() {
  return (
    <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
      {CARE_VIDEO.title}
    </Typography>
  );
}

function WatchLink({ linkProps }: { linkProps: CareVideoProps['linkProps'] }) {
  return (
    <Button
      component="a"
      href={watchUrl()}
      {...linkProps}
      variant="text"
      endIcon={<OpenInNewRoundedIcon />}
      data-testid={TID.careWatch}
      sx={{ minHeight: 48, mt: 0.5, ml: -1, px: 1 }}
    >
      Watch on YouTube
    </Button>
  );
}

interface PlayerProps {
  playing: Playing;
  reveal: boolean;
  /** Set by the poster as it starts the player: it is gone once the player opens, so the focus goes to the player. */
  takeFocus: RefObject<boolean>;
  maxHeight: number | null;
}

/** YouTube's player, made again on every tap; never smaller than 16:9 at its width, and centred when a short screen narrows it. */
function Player({ playing, reveal, takeFocus, maxHeight }: PlayerProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    if (takeFocus.current) {
      takeFocus.current = false;
      node.focus();
    }
    // In one column the player may be above the step that started it.
    if (reveal && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' });
  }, [playing.take, reveal, takeFocus]);
  const limit = maxHeight === null ? null : { maxWidth: Math.floor((maxHeight * 16) / 9), mx: 'auto' };
  return (
    <Box sx={{ ...frameSx, ...limit, bgcolor: 'cafai.raised' }}>
      <Box
        component="iframe"
        ref={frame}
        key={playing.take}
        data-testid={TID.carePlayer}
        src={embedUrl(playing.start)}
        title={`Decent's video: ${CARE_VIDEO.title}`}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        sx={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
      />
    </Box>
  );
}

export function CareVideo({ inPlace, compact, playing, onPlayFromStart, linkProps, maxPlayerHeight = null }: CareVideoProps) {
  const takeFocus = useRef(false);
  const loadsId = useId();
  const startFromPoster = () => {
    takeFocus.current = true;
    onPlayFromStart();
  };
  if (!inPlace) {
    return (
      <Paper variant="outlined" data-testid={TID.careVideo} sx={cardSx}>
        <Title />
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {DETAILS}
        </Typography>
        <Typography variant="body2" sx={{ mt: 1 }}>
          {OPENS_IN_BROWSER}
        </Typography>
        <WatchLink linkProps={linkProps} />
      </Paper>
    );
  }
  if (playing) {
    return (
      <Paper variant="outlined" data-testid={TID.careVideo} sx={cardSx}>
        <Player playing={playing} reveal={compact} takeFocus={takeFocus} maxHeight={maxPlayerHeight} />
        <Typography variant="body2" sx={{ mt: 1 }}>
          {playing.label === null ? (
            'Playing from the start'
          ) : (
            <>
              Playing from{' '}
              <Box component="span" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {formatMoment(playing.start)}
              </Box>
              : {playing.label}
            </>
          )}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {CARE_VIDEO.title} · {CARE_VIDEO.channel}
        </Typography>
        <WatchLink linkProps={linkProps} />
      </Paper>
    );
  }
  if (compact) {
    return (
      // No overflow clipping here: it would clip the row's focus ring, which is drawn outside it.
      <Paper variant="outlined" data-testid={TID.careVideo} sx={{ ...cardSx, p: 0 }}>
        <ButtonBase
          data-testid={TID.carePoster}
          aria-label={PLAY_NAME}
          aria-describedby={loadsId}
          onClick={startFromPoster}
          sx={{
            width: '100%',
            display: 'grid',
            gridTemplateColumns: '48px minmax(0, 1fr)',
            columnGap: 1.5,
            alignItems: 'center',
            justifyContent: 'stretch',
            textAlign: 'left',
            p: 1,
            pr: 1.5,
            // The card's corner inside its 1 px line, so a press fills the row and no more.
            borderRadius: '15px',
            fontFamily: 'inherit',
            color: 'text.primary',
          }}
        >
          <Box component="span" sx={playCircleSx(48)}>
            <PlayArrowRoundedIcon sx={{ fontSize: 28, ml: '2px' }} />
          </Box>
          <Box component="span" sx={{ minWidth: 0 }}>
            <Typography component="span" variant="body2" sx={{ display: 'block', fontWeight: 600 }}>
              Decent's video · {CARE_VIDEO_MINUTES}
            </Typography>
            <Typography id={loadsId} component="span" variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
              {LOADS_FROM_YOUTUBE}
            </Typography>
          </Box>
        </ButtonBase>
      </Paper>
    );
  }
  return (
    <Paper variant="outlined" data-testid={TID.careVideo} sx={cardSx}>
      <ButtonBase
        data-testid={TID.carePoster}
        aria-label={PLAY_NAME}
        aria-describedby={loadsId}
        onClick={startFromPoster}
        sx={{
          ...frameSx,
          display: 'flex',
          flexDirection: 'column',
          gap: 1.25,
          bgcolor: 'cafai.raised',
          color: 'text.primary',
          fontFamily: 'inherit',
        }}
      >
        <Box component="span" sx={playCircleSx(64)}>
          <PlayArrowRoundedIcon sx={{ fontSize: 36, ml: '3px' }} />
        </Box>
        <Box component="span" sx={{ fontSize: '1rem', fontWeight: 600 }}>
          Play Decent's video
        </Box>
      </ButtonBase>
      <Box sx={{ mt: 1.25 }}>
        <Title />
      </Box>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {DETAILS}
      </Typography>
      <Typography id={loadsId} variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.75 }}>
        {LOADS_FROM_YOUTUBE}
      </Typography>
      <WatchLink linkProps={linkProps} />
    </Paper>
  );
}
