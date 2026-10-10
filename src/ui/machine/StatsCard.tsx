/**
 * The machine at a glance, as a card in the chat (the chat posts it when the
 * app opens and on Stats, and takes it away once the chat moves on): the
 * machine's and the scale's links, the state line (and how long until the
 * machine is ready, when Decaid's time-to-ready plugin can say), Group (with
 * its target), Steam, Water (Refill when low) and Scale, the profile on the
 * machine, and Tare and Sleep or Wake. Everything in it updates live.
 *
 * Laid out for its own width, not the window's (useOwnLayout.ts): four
 * readouts in a row where the card has the room, two by two on a phone, and
 * there Sleep is its icon alone. A failed Tare or Sleep shows in the alert
 * under the top bar (MachineAlerts), like every machine problem: the card
 * comes and goes with the chat, and a failure must not go with it.
 */
import { useId, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import BedtimeRounded from '@mui/icons-material/BedtimeRounded';
import WbSunnyRounded from '@mui/icons-material/WbSunnyRounded';
import { useTelemetry } from '../../app/services.tsx';
import { TID } from '../testIds.ts';
import { isHeatingUp } from './format.ts';
import { LoadedProfile } from './LoadedProfile.tsx';
import { ConnectionRow, MachineReadouts, StateLine } from './MachineStatus.tsx';
import { useMachineCommands } from './useMachineCommands.ts';
import { useOwnLayout } from './useOwnLayout.ts';

/** Below this width of its own the card puts its readouts two by two. */
const NARROW_BELOW = 520;

const cardLayout = (width: number) => (width > 0 && width < NARROW_BELOW ? 'narrow' : 'wide');

const visuallyHidden = {
  position: 'absolute',
  // Strings: in sx a bare 1 is 100%, a box as wide and tall as the pane that the frame could be scrolled to.
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
} as const;

/** "Ready in about 3 min": whole minutes, rounded up. */
function readyInText(ms: number): string {
  return ms < 60_000 ? 'Ready in under a minute' : `Ready in about ${Math.ceil(ms / 60_000)} min`;
}

/**
 * How long until the machine is ready (spec 6.3), at the end of the state
 * line's row, so nothing moves when it comes and goes. Only while the
 * machine itself says it is heating up (isHeatingUp: the state line says
 * "Heating" then) and time-to-ready has a fresh estimate; it changes once a
 * minute, though the plugin estimates with every frame.
 */
function ReadyIn() {
  const text = useTelemetry((s) => {
    const state = s.machineConnected ? s.machine?.state : null;
    return state && isHeatingUp(state.state, state.substate) && s.timeToReady !== null ? readyInText(s.timeToReady) : null;
  });
  if (text === null) return null;
  return (
    <Typography data-testid={TID.timeToReady} variant="label" component="p" color="text.secondary" noWrap sx={{ flex: 'none', ml: 'auto', pl: 1.5 }}>
      {text}
    </Typography>
  );
}

function CardButtons({ narrow }: { narrow: boolean }) {
  const { model, pending, sleepWake, tare } = useMachineCommands();
  const tareHintId = useId();
  const { label, command, enabled } = model.sleepWake;
  const icon = label === 'Wake' ? <WbSunnyRounded /> : <BedtimeRounded />;
  return (
    <Box sx={{ flex: 'none', display: 'flex', gap: 1, ml: 'auto' }}>
      <Button
        data-testid={TID.tareButton}
        variant="tonal"
        disabled={!model.tareEnabled}
        loading={pending === 'tare'}
        aria-describedby={model.tareReason ? tareHintId : undefined}
        onClick={tare}
        // A little narrower on a phone (still wider than a touch target), so the profile's title keeps its room.
        sx={narrow ? { minWidth: 0, px: 1.5 } : { px: 2 }}
      >
        Tare
      </Button>
      {model.tareReason && (
        <Box component="span" id={tareHintId} sx={visuallyHidden}>
          {model.tareReason}
        </Box>
      )}
      <Button
        data-testid={TID.sleepWakeButton}
        variant="tonal"
        // Its icon alone on a phone: the label is its name.
        aria-label={narrow ? label : undefined}
        disabled={!enabled}
        loading={pending === command}
        startIcon={narrow ? undefined : icon}
        onClick={sleepWake}
        sx={narrow ? { minWidth: 48, px: 0 } : { px: 2 }}
      >
        {narrow ? icon : label}
      </Button>
    </Box>
  );
}

export function StatsCard() {
  const card = useRef<HTMLElement>(null);
  const narrow = useOwnLayout(card, cardLayout) === 'narrow';
  const titleId = useId();
  // The Profile line reads Decaid's workflow (the shell's shared read); the state line names the running step from it.
  const [stepNames, setStepNames] = useState<readonly string[] | null>(null);
  return (
    <Paper
      ref={card}
      component="section"
      variant="outlined"
      aria-labelledby={titleId}
      data-testid={TID.statsCard}
      sx={{ p: 1.5, my: 0.5, bgcolor: 'background.paper' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', columnGap: 1.5 }}>
        <Typography id={titleId} component="h3" variant="subtitle1" sx={{ fontWeight: 700, flex: 'none' }}>
          Machine
        </Typography>
        <Box sx={{ ml: 'auto', minWidth: 0 }}>
          <ConnectionRow />
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'baseline', minWidth: 0 }}>
        <StateLine stepNames={stepNames} />
        <ReadyIn />
      </Box>
      <MachineReadouts columns={narrow ? 2 : 4} />
      <Box sx={{ display: 'flex', alignItems: 'center', columnGap: 1, mt: 1, pt: 1.25, borderTop: 1, borderColor: 'divider' }}>
        <LoadedProfile onStepNames={setStepNames} />
        <CardButtons narrow={narrow} />
      </Box>
    </Paper>
  );
}
