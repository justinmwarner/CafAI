/**
 * A routine of the cleaning guide (D153, D155), the routines' tab panel: its
 * name and how often, its own part of Decent's video, then its steps in
 * order (numbered on a wide screen): what, when, how, where to run it for
 * now, the note where the video and Decent's pages differ, a link to
 * Decent's page, and the step's moment. The sources close it.
 */
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import { TID } from '../testIds.ts';
import { CARE_SOURCES, type CareRoutine, type CareStep } from './careGuide.ts';
import { MomentButton } from './MomentButton.tsx';

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

function Step({ step, number, props }: { step: CareStep; number: number; props: RoutineCardProps }) {
  const { numbered, links, linkProps, playingKey, onPlay } = props;
  return (
    <Box
      component="li"
      data-testid={TID.careStep(step.id)}
      sx={{
        display: 'grid',
        gridTemplateColumns: numbered ? '28px minmax(0, 1fr) auto' : 'minmax(0, 1fr) auto',
        columnGap: 1.5,
        alignItems: 'start',
        py: 1.5,
        borderTop: number === 1 ? 0 : 1,
        borderColor: 'divider',
      }}
    >
      {numbered ? (
        <Box aria-hidden sx={numberSx}>
          {number}
        </Box>
      ) : null}
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
          {step.title}
        </Typography>
        {step.when ? (
          <Typography variant="label" component="p" sx={{ color: 'text.secondary', mt: '1px' }}>
            {step.when}
          </Typography>
        ) : null}
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          {step.how}
        </Typography>
        {step.where ? (
          <Typography variant="label" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {step.where}
          </Typography>
        ) : null}
        {step.note ? (
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, mt: 0.75, color: 'text.secondary' }}>
            <InfoOutlinedIcon sx={{ fontSize: 16, mt: '1px', flex: 'none' }} />
            <Typography variant="label" component="p">
              {step.note}
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
      </Box>
      {step.moment === undefined ? (
        <span />
      ) : (
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
      )}
    </Box>
  );
}

export function RoutineCard(props: RoutineCardProps) {
  const { routine, links, linkProps, playingKey, onPlay, panelId, tabId } = props;
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
      <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
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
