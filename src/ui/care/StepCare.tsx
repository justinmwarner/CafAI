/**
 * A step's last time on the Care screen (D-CARE-1, D-CARE-4, D-CARE-5): for
 * every step beyond Daily, when it was last done ("Last done 9 days ago · 41
 * shots since"), "Due" first in the warning colour once it is, and **Mark
 * done**, with **Undo** after a mark until the page reloads. The descale and
 * the intake filter also say what reminds them (the water, the filter) and
 * link to Settings > Machine care to change it. Nothing for Daily's steps,
 * and nothing where there is no care service (fakes, previews).
 */
import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import { isTrackedStep, type TrackedStepId } from '../../app/care/careRules.ts';
import { useServices } from '../../app/services.tsx';
import { routeHref } from '../router.ts';
import { TID } from '../testIds.ts';
import { requestReveal, revealInOwnColumn, takeReveal } from './careReveal.ts';
import { filterLine, stepLine, waterLine } from './careWords.ts';
import { useStepStatus } from './useCare.ts';

const COULD_NOT_SAVE = 'Could not save that. Try again.';

export interface StepCareProps {
  stepId: string;
  /** The step's title: what Mark done says it marks. */
  title: string;
}

/** The descale's water, the intake filter's filter: what reminds it, and where to change that. */
function SettingLine({ step, text, said }: { step: TrackedStepId; text: string; said: boolean }) {
  return (
    <Box sx={{ mb: 0.25 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {text}
      </Typography>
      <Button
        component="a"
        href={routeHref({ name: 'settings' })}
        onClick={() => requestReveal('settings-care')}
        variant="text"
        data-testid={TID.careSetIn(step)}
        sx={{ minHeight: 48, ml: -1, px: 1 }}
      >
        {said ? 'Change it in Settings' : 'Set it in Settings'}
      </Button>
    </Box>
  );
}

function TrackedStepCare({ step, title }: { step: TrackedStepId; title: string }) {
  const { care } = useServices();
  const view = useStepStatus(step);
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const save = (work: () => Promise<void>) => {
    setFailed(false);
    work().catch(() => setFailed(true));
  };

  // The stats card's line opened this step: bring the whole step into view.
  useEffect(() => {
    const element = box.current;
    if (element && takeReveal({ step })) revealInOwnColumn(element.closest('li') ?? element);
  }, [step]);

  // Until the records are read: the row's height, so nothing moves when it fills in.
  if (!care || !view) return <Box ref={box} aria-hidden sx={{ minHeight: 48, mt: 1 }} />;
  const { status, now, state } = view;
  const line = stepLine(status, now);
  const marking = state.marking === step;
  return (
    <Box ref={box} data-testid={TID.careStepCare(step)} sx={{ mt: 1 }}>
      {step === 'descale' ? <SettingLine step={step} text={waterLine(state.settings.water)} said={state.settings.water !== null} /> : null}
      {step === 'intake-filter' ? <SettingLine step={step} text={filterLine(state.settings.filter)} said={state.settings.filter !== null} /> : null}
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1, rowGap: 0.5 }}>
        <Typography
          variant="body2"
          aria-live="polite"
          data-testid={TID.careStepLine(step)}
          data-due={line.due ? 'true' : undefined}
          sx={{ flex: '1 1 14em', minWidth: 0, color: 'text.secondary' }}
        >
          {line.due ? (
            <Box component="span" sx={{ color: 'warning.main', fontWeight: 600 }}>
              Due ·{' '}
            </Box>
          ) : null}
          {line.doneToday ? (
            <Box component="span" sx={{ color: 'success.main', fontWeight: 600, whiteSpace: 'nowrap' }}>
              <CheckCircleRounded aria-hidden sx={{ fontSize: 16, verticalAlign: '-3px', mr: 0.5 }} />
              {line.last}
            </Box>
          ) : (
            line.last
          )}
          {line.details.map((detail) => ` · ${detail}`).join('')}
        </Typography>
        {state.undoable.has(step) ? (
          <Button variant="text" onClick={() => save(() => care.undo(step))} data-testid={TID.careUndo(step)} aria-label={`Undo: ${title}`} sx={{ minHeight: 48 }}>
            Undo
          </Button>
        ) : null}
        <Button
          variant="tonal"
          startIcon={<CheckRounded />}
          loading={marking}
          disabled={state.marking !== null && !marking}
          onClick={() => save(() => care.markDone(step))}
          aria-label={`Mark done: ${title}`}
          data-testid={TID.careMarkDone(step)}
          sx={{ minHeight: 48, px: 2, ml: 'auto' }}
        >
          Mark done
        </Button>
      </Box>
      {failed ? (
        <Typography variant="body2" role="alert" sx={{ color: 'error.main', mt: 0.5 }}>
          {COULD_NOT_SAVE}
        </Typography>
      ) : null}
    </Box>
  );
}

export function StepCare({ stepId, title }: StepCareProps) {
  const { care } = useServices();
  if (!care || !isTrackedStep(stepId)) return null;
  return <TrackedStepCare step={stepId} title={title} />;
}
