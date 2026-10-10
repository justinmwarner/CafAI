/**
 * The machine's problems, as one slim alert under the top bar, only while a
 * problem lasts. The most important first, one at a time:
 *
 * 1. A command that failed (from the top bar's row or the stats card): it
 *    answers the tap the barista just made, until closed or the next command.
 * 2. Decaid's latest device error (e.g. profileUploadFailed), until closed.
 * 3. Decaid itself out of reach, once that has lasted.
 * 4. No machine connected, with what to do about it, and Connect for the
 *    machine and for the scale when it is missing too (deviceConnect.ts).
 * 5. The machine reporting an error.
 * 6. Water to refill.
 * 7. Decaid set to leave stopping shots to the skin (gateway mode Full,
 *    useGatewayMode.ts), with the one tap that hands it back to Decaid.
 * 8. The scale missing while the machine is awake, with Connect scale.
 *
 * The scale is missing when none is connected and one was this session, or
 * Decaid lists one (remembered, or found by a scan) that is not connected:
 * a machine with no scale has nothing to connect.
 *
 * In the flow under the top bar, so it pushes the screen down rather than
 * covering a control; so a reading that flickers (a socket between retries,
 * a reconnect, water sloshing around the refill line) must last before the
 * alert appears, and nothing shows before Decaid has said anything at all.
 */
import { useEffect, useState, type ReactNode } from 'react';
import Alert, { type AlertColor } from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import CloseRounded from '@mui/icons-material/CloseRounded';
import { AT_REST_STATES } from '../../api/machineStates.ts';
import type { ConnectionError } from '../../api/types.ts';
import { useTelemetry } from '../../app/services.tsx';
import { TID } from '../testIds.ts';
import { useDeviceConnect, type DeviceConnectView } from './deviceConnect.ts';
import { isWaterLow } from './format.ts';
import { useGatewayMode, type GatewayMode } from './useGatewayMode.ts';
import { useCommandError } from './useMachineCommands.ts';

/** Sockets stay 'connecting'/'closed' between backoff retries: only a lasting outage is one. */
const UNREACHABLE_AFTER_MS = 2500;
/** A machine that drops and comes straight back (a Bluetooth reconnect) was never away. */
const NOT_CONNECTED_AFTER_MS = 1000;
/** Both ways: the level wobbles around the refill line while water moves. */
const REFILL_STEADY_MS = 3000;
/** A scale that drops and comes straight back, as scales do around a wake, was never away. */
const SCALE_AWAY_AFTER_MS = 3000;

const NOT_CONNECTED = "Not connected. Wake the DE1 and tap Connect DE1, or pair it in Decaid's settings.";
const SCALE_AWAY = "The scale is not connected. Switch it on and tap Connect scale, or pair it in Decaid's settings.";
const LOOKING = { machine: 'Looking for your DE1…', scale: 'Looking for your scale…' } as const;
const GATEWAY_FULL = 'Decaid is set to leave stopping shots to the skin, and CafAI does not stop them, so shots will not stop at the target weight.';

/**
 * `flag`, once it has held for `onAfterMs`; false again once it has been false
 * for `offAfterMs` (at once without an off delay).
 */
function useSteadyFlag(flag: boolean, onAfterMs: number, offAfterMs = 0): boolean {
  const [steady, setSteady] = useState(false);
  useEffect(() => {
    if (flag === steady) return;
    if (!flag && offAfterMs === 0) {
      setSteady(false);
      return;
    }
    const timer = setTimeout(() => setSteady(flag), flag ? onAfterMs : offAfterMs);
    return () => clearTimeout(timer);
  }, [flag, steady, onAfterMs, offAfterMs]);
  return offAfterMs === 0 ? flag && steady : steady;
}

/** True from the first render `flag` holds, for as long as the component lives. */
function useOnceTrue(flag: boolean): boolean {
  const [seen, setSeen] = useState(flag);
  if (flag && !seen) setSeen(true);
  return seen || flag;
}

function deviceErrorText(error: ConnectionError): string {
  const message = error.message?.trim() || 'Decaid reported a problem with a device.';
  return error.suggestion ? `${message} ${error.suggestion}` : message;
}

interface Problem {
  severity: AlertColor;
  text: string;
  /** Only a problem that does not last by itself can be closed. */
  onClose?: () => void;
  /** What fixes it from here: buttons at the strip's end. */
  actions?: ReactNode;
  /** Marks the problem's words for tests; the strip itself is always TID.machineAlerts. */
  textTestId?: string;
}

function SlimAlert({ severity, text, onClose, actions, textTestId }: Problem) {
  let action: ReactNode = actions;
  if (onClose) {
    action = (
      // A full touch target that takes less than the strip's height, so a closable alert is as slim as the rest.
      <IconButton color="inherit" aria-label="Close" onClick={onClose} sx={{ my: '-5px' }}>
        <CloseRounded />
      </IconButton>
    );
  }
  return (
    <Alert
      data-testid={TID.machineAlerts}
      severity={severity}
      action={action}
      sx={{
        flex: 'none',
        minHeight: 40,
        borderRadius: 0,
        borderBottom: 1,
        borderColor: 'divider',
        alignItems: 'center',
        // Buttons that would squeeze the words to a sliver (a phone) take a line of their own under them.
        flexWrap: actions ? 'wrap' : undefined,
        py: 0,
        px: 1.5,
        '& .MuiAlert-icon': { py: 0.5, mr: 1 },
        '& .MuiAlert-message': { py: 0.5, fontSize: '0.875rem', lineHeight: 1.35, flex: actions ? '1 1 16em' : undefined },
        '& .MuiAlert-action': { py: 0, mr: 0, pl: 1, alignItems: 'center' },
      }}
    >
      {textTestId ? <span data-testid={textTestId}>{text}</span> : text}
    </Alert>
  );
}

interface ConnectButtonsProps {
  connect: DeviceConnectView;
  machine: boolean;
  scale: boolean;
  /** The machine runs something: a scan for the scale waits (useScaleRevive.ts's rule). */
  holdScale: boolean;
}

/** Connect for whatever is missing; one at a time, the one looking with its spinner. */
function ConnectButtons({ connect, machine, scale, holdScale }: ConnectButtonsProps) {
  const busy = connect.pending !== null;
  return (
    <Box sx={{ display: 'flex', gap: 0.5 }}>
      {machine && (
        <Button
          data-testid={TID.connectMachine}
          color="inherit"
          disabled={busy}
          loading={connect.pending === 'machine'}
          onClick={() => connect.connect('machine')}
        >
          Connect DE1
        </Button>
      )}
      {scale && (
        <Button
          data-testid={TID.connectScale}
          color="inherit"
          disabled={busy || holdScale}
          loading={connect.pending === 'scale'}
          onClick={() => connect.connect('scale')}
        >
          Connect scale
        </Button>
      )}
    </Box>
  );
}

function GatewayFix({ gateway }: { gateway: GatewayMode }) {
  return (
    <Button data-testid={TID.gatewayFix} color="inherit" loading={gateway.fixing} onClick={gateway.fix}>
      Let Decaid stop shots
    </Button>
  );
}

export function MachineAlerts() {
  const command = useCommandError();
  const deviceError = useTelemetry((s) => s.connectionError);
  const [closedDeviceError, setClosedDeviceError] = useState<string | null>(null);
  const connected = useTelemetry((s) => s.machineConnected);
  const scaleConnected = useTelemetry((s) => s.scaleConnected);
  const scaleSeen = useOnceTrue(scaleConnected);
  const scaleListed = useTelemetry((s) => s.devices?.devices.some((device) => device.type === 'scale' && device.state !== 'connected') ?? false);
  const scaleMissing = !scaleConnected && (scaleSeen || scaleListed);
  // A sleeping machine's scale is asleep too, which is nothing to fix.
  const machineAwake = useTelemetry((s) => s.machineConnected && typeof s.machine?.state?.state === 'string' && s.machine.state.state !== 'sleeping');
  const machineBusy = useTelemetry((s) => s.machineConnected && !AT_REST_STATES.has(s.machine?.state?.state ?? 'idle'));
  const scaleAway = useSteadyFlag(scaleMissing && machineAwake, SCALE_AWAY_AFTER_MS);
  const connect = useDeviceConnect();
  const gateway = useGatewayMode();
  // Decaid has said something about its devices: before that, "not connected" is only "not known yet".
  const heard = useOnceTrue(useTelemetry((s) => s.devices !== null || s.sockets.devices === 'open'));
  const away = useSteadyFlag(!connected, NOT_CONNECTED_AFTER_MS);
  const unreachable = useSteadyFlag(useTelemetry((s) => !s.machineConnected && s.sockets.devices !== 'open'), UNREACHABLE_AFTER_MS);
  const machineError = useTelemetry((s) => s.machineConnected && s.machine?.state?.state === 'error');
  const refill = useSteadyFlag(
    useTelemetry((s) => s.machineConnected && (isWaterLow(s.waterLevels) || s.machine?.state?.state === 'needsWater')),
    REFILL_STEADY_MS,
    REFILL_STEADY_MS,
  );
  // Why a Connect failed is over once its device is back: the next time it drops starts fresh.
  const { clearFailure } = connect;
  useEffect(() => {
    if (connected) clearFailure('machine');
  }, [connected, clearFailure]);
  useEffect(() => {
    if (scaleConnected) clearFailure('scale');
  }, [scaleConnected, clearFailure]);

  let problem: Problem | null = null;
  if (command.error !== null) {
    problem = { severity: 'error', text: command.error, onClose: command.dismiss };
  } else if (deviceError !== null && deviceError.timestamp !== closedDeviceError) {
    problem = {
      severity: deviceError.severity === 'warning' ? 'warning' : 'error',
      text: deviceErrorText(deviceError),
      onClose: () => setClosedDeviceError(deviceError.timestamp),
    };
  } else if (unreachable) {
    problem = { severity: 'warning', text: "Can't reach Decaid. Trying again…" };
  } else if (away && heard) {
    problem = {
      severity: 'warning',
      text: connect.pending ? LOOKING[connect.pending] : (connect.failure?.text ?? NOT_CONNECTED),
      actions: <ConnectButtons connect={connect} machine scale={scaleMissing} holdScale={false} />,
    };
  } else if (machineError) {
    problem = { severity: 'error', text: 'The machine reports an error. Check it first.' };
  } else if (refill) {
    problem = { severity: 'warning', text: 'Refill the water tank to continue.' };
  } else if (gateway.mode === 'full') {
    problem = {
      severity: 'warning',
      text: gateway.error ?? GATEWAY_FULL,
      textTestId: TID.gatewayAlert,
      actions: <GatewayFix gateway={gateway} />,
    };
  } else if (scaleAway) {
    const failed = connect.failure?.kind === 'scale' ? connect.failure.text : null;
    problem = {
      severity: 'warning',
      text: connect.pending === 'scale' ? LOOKING.scale : (failed ?? SCALE_AWAY),
      actions: <ConnectButtons connect={connect} machine={false} scale holdScale={machineBusy} />,
    };
  }
  return problem === null ? null : <SlimAlert {...problem} />;
}
