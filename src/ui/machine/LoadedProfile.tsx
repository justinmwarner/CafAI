/**
 * The Profile line of the machine panel: which profile Decaid's workflow
 * carries, and whether it is the active bag's version on the machine (D66,
 * D55).
 *
 * Two fixed lines that never wrap, so a long title or the offline note cannot
 * move the readouts around it: the title is cut with an ellipsis (the whole
 * title is in its `title` attribute) and the mark beside it keeps its place:
 * "This bag" once the machine holds the version, "loading…" while it takes
 * it, "not confirmed" (in the warning colour) after a load that failed.
 */
import { useEffect, useId } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import { useTelemetry } from '../../app/services.tsx';
import type { ProfileMark } from './loadedProfileModel.ts';
import { useLoadedProfile } from './useLoadedProfile.ts';

const DASH = '—';

const markSx = { flex: 'none', display: 'inline-flex', alignItems: 'center', columnGap: 0.5 } as const;

function Mark({ mark }: { mark: ProfileMark }) {
  if (mark === 'thisBag') {
    return (
      <Box component="span" sx={{ ...markSx, color: 'success.main' }}>
        <CheckCircleRounded aria-hidden sx={{ fontSize: '1rem' }} />
        <Typography variant="caption" component="span" noWrap sx={{ lineHeight: 1.25 }}>
          This bag
        </Typography>
      </Box>
    );
  }
  if (mark === 'loading') {
    return (
      <Typography variant="caption" component="span" color="text.secondary" noWrap sx={{ flex: 'none', lineHeight: 1.25 }}>
        loading…
      </Typography>
    );
  }
  if (mark === 'notConfirmed') {
    return (
      <Box component="span" sx={{ ...markSx, color: 'warning.main' }}>
        <ErrorOutlineRounded aria-hidden sx={{ fontSize: '1rem' }} />
        <Typography variant="caption" component="span" color="warning.main" noWrap sx={{ lineHeight: 1.25 }}>
          not confirmed
        </Typography>
      </Box>
    );
  }
  return null;
}

export interface LoadedProfileProps {
  /** Told the profile's step names after each read that changes them, so the state line needs no read of its own. */
  onStepNames?: (names: readonly string[] | null) => void;
}

export function LoadedProfile({ onStepNames }: LoadedProfileProps) {
  const { title, mark, stepNames } = useLoadedProfile();
  const connected = useTelemetry((s) => s.machineConnected);
  const labelId = useId();
  const shown = title === null ? DASH : title.trim() || 'Untitled profile';

  useEffect(() => {
    onStepNames?.(stepNames);
  }, [onStepNames, stepNames]);

  return (
    <Box role="group" aria-labelledby={labelId} sx={{ mt: 0.75, minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', columnGap: 1, minWidth: 0 }}>
        <Typography
          id={labelId}
          variant="label"
          component="div"
          color="text.secondary"
          noWrap
          sx={{ flex: 'none' }}
        >
          Profile
        </Typography>
        {/* D42: never "on the machine" while it is not connected. */}
        {!connected && title !== null && (
          <Typography variant="caption" component="div" color="text.secondary" noWrap sx={{ minWidth: 0, ml: 'auto' }}>
            Decaid loads it when the machine connects
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', columnGap: 1, minWidth: 0 }}>
        <Typography variant="subtitle1" component="div" noWrap title={title ?? undefined} sx={{ minWidth: 0 }}>
          {shown}
        </Typography>
        <Mark mark={mark} />
      </Box>
    </Box>
  );
}
