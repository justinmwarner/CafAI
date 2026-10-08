/**
 * What the machine is doing, at a glance.
 *
 * Every readout is its own small component that selects one formatted string
 * from telemetry, so a WebSocket tick re-renders at most the number that
 * changed and nothing around it (Crema rebuilt the whole screen per tick, and
 * taps landed in the gaps).
 */
import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTelemetry } from '../../app/services.tsx';
import { TID } from '../testIds.ts';
import {
  describeMachineState,
  formatTemperature,
  formatWaterLevel,
  formatWeight,
  isWaterLow,
  splitUnit,
} from './format.ts';
import { LoadedProfile } from './LoadedProfile.tsx';
import { stepNameAt } from './loadedProfileModel.ts';

const DASH = '—';

/** True once `flag` has held for `delayMs`; a reconnect attempt that flips it briefly shows nothing. */
function useSettledFlag(flag: boolean, delayMs: number): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!flag) {
      setSettled(false);
      return;
    }
    const timer = setTimeout(() => setSettled(true), delayMs);
    return () => clearTimeout(timer);
  }, [flag, delayMs]);
  return flag && settled;
}

function Dot({ on }: { on: boolean }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        flex: 'none',
        bgcolor: on ? 'success.main' : 'transparent',
        border: 2,
        borderColor: on ? 'success.main' : 'text.disabled',
      }}
    />
  );
}

function ConnectionRow() {
  const machine = useTelemetry((s) => s.machineConnected);
  const scale = useTelemetry((s) => s.scaleConnected);
  // Sockets stay 'connecting'/'closed' between backoff retries, so only a lasting outage is shown.
  const unreachable = useSettledFlag(
    useTelemetry((s) => !s.machineConnected && s.sockets.devices !== 'open'),
    2500,
  );
  const item = { display: 'inline-flex', alignItems: 'center', gap: 0.75, minWidth: 0 } as const;
  return (
    <Box
      data-testid={TID.connectionStatus}
      sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 2, rowGap: 0.5 }}
    >
      <Box sx={item}>
        <Dot on={machine} />
        <Typography variant="body2" noWrap>
          {machine ? 'Machine connected' : 'No machine'}
        </Typography>
      </Box>
      <Box sx={item}>
        <Dot on={scale} />
        <Typography variant="body2" noWrap>
          {scale ? 'Scale connected' : 'No scale'}
        </Typography>
      </Box>
      {unreachable && (
        <Typography variant="body2" color="warning.main" noWrap>
          Can't reach Decaid
        </Typography>
      )}
    </Box>
  );
}

/** "Pulling a shot: pause" during Blooming's bloom: the step says why the pump is off. */
function StateLine({ stepNames }: { stepNames: readonly string[] | null }) {
  const text = useTelemetry((s) =>
    describeMachineState(
      s.machine?.state?.state ?? null,
      s.machine?.state?.substate ?? null,
      s.machineConnected,
      stepNameAt(stepNames, s.machine?.profileFrame),
    ),
  );
  return (
    <Typography data-testid={TID.machineState} variant="h5" component="p" aria-live="polite" sx={{ mt: 0.25 }}>
      {text}
    </Typography>
  );
}

interface ReadoutProps {
  testId: string;
  label: string;
  value: string;
  detail?: string | null;
  warn?: boolean;
}

function Readout({ testId, label, value, detail, warn }: ReadoutProps) {
  const { value: number, unit } = splitUnit(value);
  return (
    <Box data-testid={testId} sx={{ minWidth: 0 }}>
      <Typography variant="label" component="div" color="text.secondary" noWrap>
        {label}
      </Typography>
      <Typography variant="readout" component="div" noWrap color={warn ? 'warning.main' : 'text.primary'}>
        {number}
        {unit ? (
          <Box component="span" sx={{ fontSize: '0.68em', fontWeight: 550, color: 'text.secondary' }}>
            {' '}
            {unit}
          </Box>
        ) : null}
      </Typography>
      <Typography variant="caption" component="div" color={warn ? 'warning.main' : 'text.secondary'} noWrap>
        {detail ?? ' '}
      </Typography>
    </Box>
  );
}

function GroupTemperature() {
  const value = useTelemetry((s) => (s.machineConnected && s.machine ? formatTemperature(s.machine.groupTemperature) : DASH));
  const target = useTelemetry((s) =>
    s.machineConnected && s.machine && Number.isFinite(s.machine.targetGroupTemperature)
      ? s.machine.targetGroupTemperature.toFixed(1)
      : null,
  );
  return <Readout testId={TID.groupTemp} label="Group" value={value} detail={target ? `target ${target}` : null} />;
}

function SteamTemperature() {
  const value = useTelemetry((s) =>
    s.machineConnected && s.machine ? formatTemperature(s.machine.steamTemperature, 0) : DASH,
  );
  return <Readout testId={TID.steamTemp} label="Steam" value={value} />;
}

function WaterLevel() {
  const value = useTelemetry((s) => (s.machineConnected ? formatWaterLevel(s.waterLevels) : DASH));
  const low = useTelemetry((s) => s.machineConnected && (isWaterLow(s.waterLevels) || s.machine?.state?.state === 'needsWater'));
  return <Readout testId={TID.waterLevel} label="Water" value={value} detail={low ? 'Refill' : null} warn={low} />;
}

function ScaleWeight() {
  const connected = useTelemetry((s) => s.scaleConnected);
  const value = useTelemetry((s) => (s.scaleConnected && s.scale ? formatWeight(s.scale.weight) : DASH));
  return <Readout testId={TID.scaleWeight} label="Scale" value={value} detail={connected ? null : 'No scale'} />;
}

/** Decaid's latest device error (e.g. profileUploadFailed), until dismissed. */
function ConnectionErrorNotice() {
  const error = useTelemetry((s) => s.connectionError);
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!error || error.timestamp === dismissed) return null;
  return (
    <Alert
      severity={error.severity === 'warning' ? 'warning' : 'error'}
      variant="outlined"
      onClose={() => setDismissed(error.timestamp)}
      sx={{
        mt: 1,
        py: 0,
        px: 1.25,
        alignItems: 'center',
        '& .MuiAlert-icon': { py: 0.75, mr: 1 },
        '& .MuiAlert-message': { py: 0.75, fontSize: '0.875rem', lineHeight: 1.35 },
      }}
    >
      {error.message?.trim() || 'Decaid reported a problem with a device.'}
      {error.suggestion ? ` ${error.suggestion}` : ''}
    </Alert>
  );
}

export function MachineStatus() {
  // The Profile line reads Decaid's workflow; the state line names the running step from the same read.
  const [stepNames, setStepNames] = useState<readonly string[] | null>(null);
  return (
    <Box component="section" aria-label="Machine status">
      <ConnectionRow />
      <StateLine stepNames={stepNames} />
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', columnGap: 1, mt: 0.75 }}>
        <GroupTemperature />
        <SteamTemperature />
        <WaterLevel />
        <ScaleWeight />
      </Box>
      <LoadedProfile onStepNames={setStepNames} />
      <ConnectionErrorNotice />
    </Box>
  );
}
