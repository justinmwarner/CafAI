/**
 * The machine's buttons. Water moves when these run, so a command is only
 * ever sent from a tap, never retried on its own, and a failure is shown in
 * plain words rather than swallowed.
 *
 * Every control keeps its place whatever the machine is doing (disabled, not
 * removed), so a tap that lands just as a shot starts cannot hit a button
 * that slid into the gap.
 */
import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import AirRounded from '@mui/icons-material/AirRounded';
import BedtimeRounded from '@mui/icons-material/BedtimeRounded';
import CoffeeRounded from '@mui/icons-material/CoffeeRounded';
import ScaleRounded from '@mui/icons-material/ScaleRounded';
import ShowerRounded from '@mui/icons-material/ShowerRounded';
import StopRounded from '@mui/icons-material/StopRounded';
import TouchAppRounded from '@mui/icons-material/TouchAppRounded';
import WaterDropRounded from '@mui/icons-material/WaterDropRounded';
import WbSunnyRounded from '@mui/icons-material/WbSunnyRounded';
import { useServices, useTelemetry } from '../../app/services.tsx';
import { TID } from '../testIds.ts';
import { machineControls, type PendingCommand, type StartCommand } from './commands.ts';
import { useHasGhc } from './useHasGhc.ts';

interface StartButtonSpec {
  command: StartCommand;
  label: string;
  icon: ReactNode;
  testId: string;
  failure: string;
}

const START_BUTTONS: readonly StartButtonSpec[] = [
  { command: 'espresso', label: 'Espresso', icon: <CoffeeRounded />, testId: TID.espressoButton, failure: "Couldn't start the shot." },
  { command: 'steam', label: 'Steam', icon: <AirRounded />, testId: TID.steamButton, failure: "Couldn't start steam." },
  { command: 'flush', label: 'Flush', icon: <ShowerRounded />, testId: TID.flushButton, failure: "Couldn't start the flush." },
  { command: 'hotWater', label: 'Hot water', icon: <WaterDropRounded />, testId: TID.hotWaterButton, failure: "Couldn't start hot water." },
];

function errorText(cause: unknown, failure: string): string {
  // GatewayError.message is already a sentence a barista can act on.
  const detail = cause instanceof Error && cause.message.trim() ? cause.message.trim() : 'Try again.';
  return `${failure} ${detail}`;
}

const START_HEIGHT = 60;
const ROW_HEIGHT = 52;

export function MachineControls() {
  const { decaid } = useServices();
  const connected = useTelemetry((s) => s.machineConnected);
  const state = useTelemetry((s) => s.machine?.state?.state ?? null);
  const scaleConnected = useTelemetry((s) => s.scaleConnected);
  const hasGhc = useHasGhc();
  const [pending, setPending] = useState<PendingCommand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  // State updates land a frame later; this stops a fast double tap sending twice.
  const inFlight = useRef<PendingCommand | null>(null);
  const tareHintId = useId();

  const model = machineControls({ connected, state, scaleConnected, hasGhc, pending });

  const send = useCallback(
    async (command: PendingCommand, failure: string) => {
      // Stop is never queued behind another command.
      if (inFlight.current !== null && command !== 'idle') return;
      const id = ++latest.current;
      inFlight.current = command;
      setPending(command);
      setError(null);
      try {
        if (command === 'tare') await decaid.tareScale();
        else await decaid.setMachineState(command);
      } catch (cause) {
        if (id === latest.current) setError(errorText(cause, failure));
      } finally {
        if (id === latest.current) {
          inFlight.current = null;
          setPending(null);
        }
      }
    },
    [decaid],
  );

  const sleepWake = model.sleepWake;
  return (
    <Box component="section" aria-label="Machine controls" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {model.startsVisible ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 1 }}>
          {START_BUTTONS.map((spec) => (
            <Button
              key={spec.command}
              data-testid={spec.testId}
              variant={spec.command === 'espresso' ? 'contained' : 'outlined'}
              color={spec.command === 'espresso' ? 'primary' : 'inherit'}
              disabled={!model.startsEnabled}
              loading={pending === spec.command}
              onClick={() => void send(spec.command, spec.failure)}
              sx={{
                minHeight: START_HEIGHT,
                flexDirection: 'column',
                gap: 0.25,
                px: 0.5,
                fontSize: '0.9375rem',
                lineHeight: 1.15,
                borderColor: spec.command === 'espresso' ? undefined : 'divider',
              }}
            >
              {spec.icon}
              <span>{spec.label}</span>
            </Button>
          ))}
        </Box>
      ) : (
        <Box
          role="note"
          sx={{
            minHeight: START_HEIGHT,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            px: 2,
            border: 1,
            borderStyle: 'dashed',
            borderColor: 'divider',
            borderRadius: 1,
            color: 'text.secondary',
          }}
        >
          <TouchAppRounded />
          <Typography variant="subtitle1" component="span">
            {model.startReason}
          </Typography>
        </Box>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 1 }}>
        <Button
          data-testid={TID.stopButton}
          variant={model.stopProminent ? 'contained' : 'outlined'}
          color="error"
          size="large"
          disabled={!model.stopEnabled}
          startIcon={<StopRounded />}
          onClick={() => void send('idle', "Couldn't stop the machine.")}
          sx={{ minHeight: model.stopProminent ? START_HEIGHT : ROW_HEIGHT, fontWeight: 700 }}
        >
          Stop
        </Button>
        <Button
          data-testid={TID.sleepWakeButton}
          variant="outlined"
          color="inherit"
          disabled={!sleepWake.enabled}
          loading={pending === sleepWake.command}
          startIcon={sleepWake.label === 'Wake' ? <WbSunnyRounded /> : <BedtimeRounded />}
          onClick={() =>
            void send(
              sleepWake.command,
              sleepWake.label === 'Wake' ? "Couldn't wake the machine." : "Couldn't put the machine to sleep.",
            )
          }
          sx={{ minHeight: ROW_HEIGHT, px: 1, borderColor: 'divider' }}
        >
          {sleepWake.label}
        </Button>
        <Button
          data-testid={TID.tareButton}
          variant="outlined"
          color="inherit"
          disabled={!model.tareEnabled}
          loading={pending === 'tare'}
          aria-describedby={model.tareReason ? tareHintId : undefined}
          startIcon={<ScaleRounded />}
          onClick={() => void send('tare', "Couldn't tare the scale.")}
          sx={{ minHeight: ROW_HEIGHT, px: 1, borderColor: 'divider' }}
        >
          Tare
        </Button>
      </Box>
      {model.tareReason && (
        <Box component="span" id={tareHintId} sx={visuallyHidden}>
          {model.tareReason}
        </Box>
      )}

      {model.startsVisible && model.startReason && (
        <Typography variant="body2" color="text.secondary" role="status" sx={{ fontSize: '0.875rem', lineHeight: 1.35 }}>
          {model.startReason}
        </Typography>
      )}
      {error && (
        <Alert
          severity="error"
          variant="outlined"
          onClose={() => setError(null)}
          sx={{
            py: 0,
            px: 1.25,
            alignItems: 'center',
            '& .MuiAlert-icon': { py: 0.75, mr: 1 },
            '& .MuiAlert-message': { py: 0.75, fontSize: '0.875rem', lineHeight: 1.35 },
          }}
        >
          {error}
        </Alert>
      )}
    </Box>
  );
}

const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
} as const;
