/**
 * The machine's problems, as one slim alert under the top bar, only while a
 * problem lasts. The most important first, one at a time:
 *
 * 1. A command that failed (from the top bar's row or the stats card): it
 *    answers the tap the barista just made, until closed or the next command.
 * 2. Decaid's latest device error (e.g. profileUploadFailed), until closed.
 * 3. Decaid itself out of reach, once that has lasted.
 * 4. No machine connected, with what to do about it.
 * 5. The machine reporting an error.
 * 6. Water to refill.
 *
 * In the flow under the top bar, so it pushes the screen down rather than
 * covering a control; so a reading that flickers (a socket between retries,
 * a reconnect, water sloshing around the refill line) must last before the
 * alert appears, and nothing shows before Decaid has said anything at all.
 */
import { useEffect, useState, type ReactNode } from 'react';
import Alert, { type AlertColor } from '@mui/material/Alert';
import IconButton from '@mui/material/IconButton';
import CloseRounded from '@mui/icons-material/CloseRounded';
import type { ConnectionError } from '../../api/types.ts';
import { useTelemetry } from '../../app/services.tsx';
import { TID } from '../testIds.ts';
import { isWaterLow } from './format.ts';
import { useCommandError } from './useMachineCommands.ts';

/** Sockets stay 'connecting'/'closed' between backoff retries: only a lasting outage is one. */
const UNREACHABLE_AFTER_MS = 2500;
/** A machine that drops and comes straight back (a Bluetooth reconnect) was never away. */
const NOT_CONNECTED_AFTER_MS = 1000;
/** Both ways: the level wobbles around the refill line while water moves. */
const REFILL_STEADY_MS = 3000;

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
}

function SlimAlert({ severity, text, onClose }: Problem) {
  let action: ReactNode = undefined;
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
        py: 0,
        px: 1.5,
        '& .MuiAlert-icon': { py: 0.5, mr: 1 },
        '& .MuiAlert-message': { py: 0.5, fontSize: '0.875rem', lineHeight: 1.35 },
        '& .MuiAlert-action': { py: 0, mr: 0, pl: 1, alignItems: 'center' },
      }}
    >
      {text}
    </Alert>
  );
}

export function MachineAlerts() {
  const command = useCommandError();
  const deviceError = useTelemetry((s) => s.connectionError);
  const [closedDeviceError, setClosedDeviceError] = useState<string | null>(null);
  const connected = useTelemetry((s) => s.machineConnected);
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
    problem = { severity: 'warning', text: 'Not connected. Wake the DE1 and pair it in Decaid.' };
  } else if (machineError) {
    problem = { severity: 'error', text: 'The machine reports an error. Check it first.' };
  } else if (refill) {
    problem = { severity: 'warning', text: 'Refill the water tank to continue.' };
  }
  return problem === null ? null : <SlimAlert {...problem} />;
}
