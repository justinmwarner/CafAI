/**
 * A routine of the cleaning guide (D153, D155), the routines' tab panel: its
 * name and how often, its own part of Decent's video, then its steps in
 * order (numbered on a wide screen): what, when, how, where to run it for
 * now, the note where the video and Decent's pages differ, a link to
 * Decent's page, and the step's moment; a step beyond Daily ends with its
 * last time and Mark done (StepCare.tsx, D183). The sources close it.
 */
import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import { useTemperatureUnit } from '../../app/services.tsx';
import { TID } from '../testIds.ts';
import { CARE_SOURCES, keepUnits, type CareRoutine, type CareStep } from './careGuide.ts';
import { routineInUnit } from './careUnits.ts';
import { MomentButton } from './MomentButton.tsx';
import { StepCare } from './StepCare.tsx';

export interface RoutineCardProps {
  routine: CareRoutine;
  /** Numbers before the steps (a wide screen). */
  numbered: boolean;
  /** Moments as links to YouTube (videoPlace.ts). */
  links: boolean;
  linkProps: { target?: '_blank'; rel?: string };
  /** The moment playing, by its key. */
  playingKey: string | null;
  onPlay(start: number, key: string, label: string): void;
  panelId: string;
  tabId: string;
}

const numberSx = {
  width: 28,
  height: 28,
  mt: '1px',
  borderRadius: '50%',
  bgcolor: 'cafai.raised',
  color: 'text.secondary',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  typography: 'label',
  fontWeight: 650,
} as const;

/**
 * A step's grid. The moment sits beside the title: on a wide screen it keeps
 * a column of its own down the step, so the words line up step after step;
 * on a narrow one the words under the title take the whole width. A step
 * without a moment has no column for one, not even its gap.
 */
function stepGrid(numbered: boolean, moment: boolean) {
  if (numbered) {
    return moment
      ? { gridTemplateColumns: '28px minmax(0, 1fr) auto', gridTemplateAreas: '"num head moment" "num body moment"' }
      : { gridTemplateColumns: '28px minmax(0, 1fr)', gridTemplateAreas: '"num head" "num body"' };
  }
  return moment
    ? { gridTemplateColumns: 'minmax(0, 1fr) auto', gridTemplateAreas: '"head moment" "body body"' }
    : { gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateAreas: '"head" "body"' };
}

function Step({ step, number, props }: { step: CareStep; number: number; props: RoutineCardProps }) {
  const { numbered, links, linkProps, playingKey, onPlay } = props;
  return (
    <Box
      component="li"
      data-testid={TID.careStep(step.id)}
      sx={{
        display: 'grid',
        ...stepGrid(numbered, step.moment !== undefined),
        columnGap: 1.5,
        alignItems: 'start',
        py: 1.5,
        borderTop: number === 1 ? 0 : 1,
        borderColor: 'divider',
      }}
    >
      {numbered ? (
        <Box aria-hidden sx={{ ...numberSx, gridArea: 'num' }}>
          {number}
        </Box>
      ) : null}
      <Box sx={{ gridArea: 'head', minWidth: 0 }}>
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
          {step.title}
        </Typography>
        {step.when ? (
          <Typography variant="label" component="p" sx={{ color: 'text.secondary', mt: '1px' }}>
            {keepUnits(step.when)}
          </Typography>
        ) : null}
      </Box>
      <Box sx={{ gridArea: 'body', minWidth: 0 }}>
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          {keepUnits(step.how)}
        </Typography>
        {step.where ? (
          <Typography variant="label" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {keepUnits(step.where)}
          </Typography>
        ) : null}
        {step.note ? (
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, mt: 0.75, color: 'text.secondary' }}>
            <InfoOutlinedIcon sx={{ fontSize: 16, mt: '1px', flex: 'none' }} />
            <Typography variant="label" component="p">
              {keepUnits(step.note)}
            </Typography>
          </Box>
        ) : null}
        {step.link ? (
          <Button
            component="a"
            href={step.link.url}
            {...linkProps}
            variant="text"
            endIcon={<OpenInNewRoundedIcon />}
            data-testid={TID.careLink(step.id)}
            sx={{ minHeight: 48, mt: 0.25, ml: -1, px: 1 }}
          >
            {step.link.label}
          </Button>
        ) : null}
        <StepCare stepId={step.id} title={step.title} />
      </Box>
      {step.moment === undefined ? null : (
        // A flex box, so the button's nudge is a margin like any other.
        <Box sx={{ gridArea: 'moment', display: 'flex' }}>
          <MomentButton
            seconds={step.moment}
            what={step.title}
            link={links}
            linkProps={linkProps}
            playing={playingKey === step.id}
            onPlay={() => onPlay(step.moment!, step.id, step.title)}
            testId={TID.careMoment(step.id)}
            nudge
          />
        </Box>
      )}
    </Box>
  );
}

export function RoutineCard(props: RoutineCardProps) {
  const { links, linkProps, playingKey, onPlay, panelId, tabId } = props;
  // Its temperatures in the barista's unit (D176).
  const unit = useTemperatureUnit();
  const routine = useMemo(() => routineInUnit(props.routine, unit), [props.routine, unit]);
  return (
    <Paper
      variant="outlined"
      role="tabpanel"
      id={panelId}
      aria-labelledby={tabId}
      data-testid={TID.careRoutine}
      sx={{ borderRadius: '16px', px: 2, bgcolor: 'background.paper' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pt: 1.25, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>
            {routine.label}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {routine.cadence}
          </Typography>
        </Box>
        {routine.moment === undefined ? null : (
          <MomentButton
            seconds={routine.moment}
            what={routine.label}
            link={links}
            linkProps={linkProps}
            playing={playingKey === routine.id}
            onPlay={() => onPlay(routine.moment!, routine.id, routine.label)}
            testId={TID.careMoment(routine.id)}
          />
        )}
      </Box>
      {/* The role again: WebKit (Decaid on an iPad or a Mac) drops a list's role with its markers, and the numbers are hidden from screen readers. */}
      <Box component="ol" role="list" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {routine.steps.map((step, index) => (
          <Step key={step.id} step={step} number={index + 1} props={props} />
        ))}
      </Box>
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary', pt: 1.25, pb: 1.75, borderTop: 1, borderColor: 'divider' }}>
        {CARE_SOURCES}
      </Typography>
    </Paper>
  );
}
