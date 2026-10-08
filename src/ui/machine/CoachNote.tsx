/**
 * The coach's note under the live graph: a small avatar and a speech bubble
 * that say, while a shot runs, whether the coach is watching it, and once the
 * pour is over, that it is reading the shot. Never over the curves, and gone
 * once the shot's outcome is in the chat.
 *
 * The profile title and mark come from the app's shared loaded-profile
 * reading (LoadedProfileContext.tsx), so the note adds no read of Decaid's
 * workflow; outside the shell there is none, and the rows that need it are
 * skipped.
 */
import { useMemo, useSyncExternalStore } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ForumRounded from '@mui/icons-material/ForumRounded';
import { keyframes } from '@mui/material/styles';
import { useCoach, useServices } from '../../app/services.tsx';
import { TID } from '../testIds.ts';
import { useSharedLoadedProfile } from './LoadedProfileContext.tsx';
import type { LoadedProfileState } from './useLoadedProfile.ts';
import { shotTraceFor } from './shotTrace.ts';

const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';

const enter = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
`;

const blink = keyframes`
  0%, 80%, 100% { opacity: 0.3; }
  40% { opacity: 1; }
`;

const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
} as const;

export interface CoachNoteProps {
  /** The pour is over and the chat has not had the shot's outcome yet (from the shell's focus hook). */
  awaitingOutcome: boolean;
}

interface NoteFacts {
  hasApiKey: boolean;
  /** A bag with an active version: a shot the coach can read as part of a dial-in. */
  coaching: boolean;
  versionTitle: string | null;
  /** Null outside the shell: nothing known about the machine's profile. */
  loaded: LoadedProfileState | null;
}

/** What the note says while a shot runs; the first that applies wins. */
function liveNote({ hasApiKey, coaching, versionTitle, loaded }: NoteFacts): string {
  if (!hasApiKey) return "Add your API key in Settings, and I'll read your shots.";
  if (!coaching || versionTitle === null) {
    return "I'm not coaching this one. Pick a bag and a starting profile, and I'll read your shots.";
  }
  const title = loaded?.title ?? null;
  if (title !== null && title.trim() !== '' && title !== versionTitle) {
    return `This shot runs "${title.trim()}", not ${versionTitle}, so it won't be part of this dial-in.`;
  }
  if (loaded?.mark === 'loading' || loaded?.mark === 'notConfirmed') {
    return `I'm watching, but ${versionTitle} isn't confirmed on the machine yet, so this shot may not count.`;
  }
  return "I'm watching this shot. I'll read the curves once it's done.";
}

/** Three dots that pulse in turn; still under reduced motion. */
function ThinkingDots() {
  return (
    <Box component="span" sx={{ display: 'inline-flex', gap: '3px', ml: '6px', verticalAlign: 'middle' }}>
      {[0, 1, 2].map((dot) => (
        <Box
          key={dot}
          component="span"
          sx={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            bgcolor: 'text.secondary',
            animation: `${blink} 1.2s ease-in-out ${dot * 0.2}s infinite`,
            [REDUCED_MOTION]: { animation: 'none' },
          }}
        />
      ))}
    </Box>
  );
}

export function CoachNote({ awaitingOutcome }: CoachNoteProps) {
  const { telemetry } = useServices();
  const trace = useMemo(() => shotTraceFor(telemetry), [telemetry]);
  const live = useSyncExternalStore(trace.subscribe, () => trace.getState().phase === 'live');
  const hasApiKey = useCoach((s) => s.hasApiKey);
  const coaching = useCoach((s) => s.activeBag !== null && s.activeVersion !== null);
  const versionTitle = useCoach((s) => s.activeVersion?.title ?? null);
  const loaded = useSharedLoadedProfile();
  if (!live && !awaitingOutcome) return null;

  return (
    <Box
      role="status"
      data-testid={TID.coachNote}
      sx={{
        flex: 'none',
        display: 'flex',
        alignItems: 'flex-end',
        gap: 1.25,
        animation: `${enter} 200ms ease-out`,
        [REDUCED_MOTION]: { animation: 'none' },
      }}
    >
      <Box
        aria-hidden
        sx={{
          width: 34,
          height: 34,
          flex: 'none',
          borderRadius: '50%',
          bgcolor: 'cafai.accentSoft',
          color: 'primary.main',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ForumRounded sx={{ fontSize: 18 }} />
      </Box>
      <Typography
        variant="body2"
        component="p"
        sx={{
          position: 'relative',
          minWidth: 0,
          maxWidth: 520,
          px: 1.75,
          py: 1.1,
          bgcolor: 'cafai.raised',
          borderRadius: '16px 16px 16px 6px',
        }}
      >
        {awaitingOutcome ? (
          <>
            {/* The dots stand for the sentence's full stop, so a screen reader hears the sentence instead. */}
            <span aria-hidden>
              Done. Reading the shot
              <ThinkingDots />
            </span>
            <Box component="span" sx={visuallyHidden}>
              Done. Reading the shot.
            </Box>
          </>
        ) : (
          liveNote({ hasApiKey, coaching, versionTitle, loaded })
        )}
      </Typography>
    </Box>
  );
}
