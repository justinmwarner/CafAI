/**
 * The Profile line of the machine panel: which profile Decaid's workflow
 * carries, and whether it is the active bag's version (D66).
 *
 * Two fixed lines that never wrap, so a long title or the offline note cannot
 * move the readouts around it: the title is cut with an ellipsis (the whole
 * title is in its `title` attribute) and the "This bag" mark keeps its place.
 */
import { useId } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import { useTelemetry } from '../../app/services.tsx';
import { useLoadedProfile } from './useLoadedProfile.ts';

const DASH = '—';

export function LoadedProfile() {
  const { title, thisBag } = useLoadedProfile();
  const connected = useTelemetry((s) => s.machineConnected);
  const labelId = useId();
  const shown = title === null ? DASH : title.trim() || 'Untitled profile';

  return (
    <Box role="group" aria-labelledby={labelId} sx={{ mt: 0.75, minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', columnGap: 1, minWidth: 0 }}>
        <Typography
          id={labelId}
          variant="overline"
          component="div"
          color="text.secondary"
          noWrap
          sx={{ flex: 'none', lineHeight: 1.5 }}
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
        <Typography
          component="div"
          noWrap
          title={title ?? undefined}
          sx={{ minWidth: 0, fontSize: '1.125rem', fontWeight: 500, lineHeight: 1.25 }}
        >
          {shown}
        </Typography>
        {thisBag && (
          <Box
            component="span"
            sx={{ flex: 'none', display: 'inline-flex', alignItems: 'center', columnGap: 0.5, color: 'success.main' }}
          >
            <CheckCircleRounded aria-hidden sx={{ fontSize: '1rem' }} />
            <Typography variant="caption" component="span" noWrap sx={{ lineHeight: 1.25 }}>
              This bag
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
