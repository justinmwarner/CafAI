/**
 * The stats card's line (D188): one, quiet, only while a step of machine
 * care is due and Settings > Machine care's switch is on: the most overdue
 * step, "Weekly clean due: 41 shots since the last". A link to its routine
 * on the Care screen, which brings the step into view. Never the alert under
 * the top bar: that is for what stops the machine working now.
 */
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import CleaningServicesRoundedIcon from '@mui/icons-material/CleaningServicesRounded';
import { routeHref } from '../router.ts';
import { TID } from '../testIds.ts';
import { ROUTINES } from './careGuide.ts';
import { requestReveal } from './careReveal.ts';
import { dueLine } from './careWords.ts';
import type { RoutineId } from './routines.ts';
import { useDueStep } from './useCare.ts';

function routineOfStep(stepId: string): RoutineId {
  return ROUTINES.find((routine) => routine.steps.some((step) => step.id === stepId))?.id ?? 'daily';
}

export function CareDueLine() {
  const due = useDueStep();
  if (!due) return null;
  const { status, now } = due;
  return (
    <Box sx={{ mt: 1, pt: 0.5, borderTop: 1, borderColor: 'divider' }}>
      <ButtonBase
        component="a"
        href={routeHref({ name: 'care', routine: routineOfStep(status.step) })}
        onClick={() => requestReveal({ step: status.step })}
        data-testid={TID.careDueLine}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: 1.25,
          width: '100%',
          minHeight: 48,
          px: 0.5,
          // A string: a bare number here would be a multiple of the theme's radius.
          borderRadius: '12px',
          color: 'text.primary',
          fontFamily: 'inherit',
          textAlign: 'left',
          '@media (hover: hover)': { '&:hover': { bgcolor: 'action.hover' } },
        }}
      >
        <CleaningServicesRoundedIcon aria-hidden sx={{ fontSize: 20, color: 'text.secondary', flex: 'none' }} />
        <Typography variant="body2" component="span" sx={{ flex: '1 1 auto', minWidth: 0 }}>
          {dueLine(status, now)}
        </Typography>
        <ChevronRightRounded aria-hidden sx={{ color: 'text.secondary', flex: 'none' }} />
      </ButtonBase>
    </Box>
  );
}
