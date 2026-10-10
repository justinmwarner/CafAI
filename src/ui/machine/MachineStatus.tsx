/**
 * What the machine is doing, at a glance: the pieces of the stats card
 * (StatsCard.tsx).
 *
 * Every readout is its own small component that selects one formatted string
 * from telemetry, so a WebSocket tick re-renders at most the number that
 * changed and nothing around it (Crema rebuilt the whole screen per tick, and
 * taps landed in the gaps).
 */
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTelemetry } from '../../app/services.tsx';
import { TID } from '../testIds.ts';
import {
  DASH,
  describeMachineState,
  formatTemperature,
  formatWaterLevel,
  formatWeight,
  isWaterLow,
  splitUnit,
} from './format.ts';
import { stepNameAt } from './loadedProfileModel.ts';

const visuallyHidden = {
  position: 'absolute',
  // Strings: in sx a bare 1 is 100%, a box as wide and tall as the pane that the frame could be scrolled to.
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
} as const;

function Dot({ on }: { on: boolean }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        flex: 'none',
        bgcolor: on ? 'success.main' : 'transparent',
        border: 2,
        borderColor: on ? 'success.main' : 'text.disabled',
      }}
    />
  );
}

/** One link: its dot, and a word that says it too ("Scale", or "No scale"). */
function DeviceLink({ on, name, missing }: { on: boolean; name: string; missing: string }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
      <Dot on={on} />
      <Typography variant="label" component="span" color="text.secondary" noWrap>
        {on ? name : missing}
        {on && (
          <Box component="span" sx={visuallyHidden}>
            {' connected'}
          </Box>
        )}
      </Typography>
    </Box>
  );
}

/**
 * The machine's and the scale's links, short enough for a card's header on a
 * phone: "DE1" and "Scale" beside filled dots while connected, "No machine"
 * and "No scale" beside hollow rings while not. Decaid itself out of reach
 * is the alert's to say (MachineAlerts.tsx).
 */
export function ConnectionRow() {
  const machine = useTelemetry((s) => s.machineConnected);
  const scale = useTelemetry((s) => s.scaleConnected);
  return (
    <Box
      data-testid={TID.connectionStatus}
      sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', columnGap: 1.5, rowGap: 0.25 }}
    >
      <DeviceLink on={machine} name="DE1" missing="No machine" />
      <DeviceLink on={scale} name="Scale" missing="No scale" />
    </Box>
  );
}

/**
 * "Pulling a shot: pause" during Blooming's bloom: the step says why the pump
 * is off. Always one line: a step name too long for the card ("Pulling a
 * shot: reset temperature" on a phone) is cut short rather than wrapped, so
 * the readouts and the buttons under it never jump as the steps change. The
 * whole line is its title and what a screen reader hears, and the Shot view
 * names the step in full.
 */
export function StateLine({ stepNames }: { stepNames: readonly string[] | null }) {
  const text = useTelemetry((s) =>
    describeMachineState(
      s.machine?.state?.state ?? null,
      s.machine?.state?.substate ?? null,
      s.machineConnected,
      stepNameAt(stepNames, s.machine?.profileFrame),
    ),
  );
  return (
    <Typography data-testid={TID.machineState} variant="h5" component="p" aria-live="polite" noWrap title={text} sx={{ mt: 0.25 }}>
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
        {detail ?? ' '}
      </Typography>
    </Box>
  );
}

function GroupTemperature() {
  // A reading Decaid did not send is null: the dash, and no target line (5.8).
  const value = useTelemetry((s) => (s.machineConnected && s.machine ? formatTemperature(s.machine.groupTemperature) : DASH));
  const target = useTelemetry((s) => {
    const celsius = s.machineConnected ? s.machine?.targetGroupTemperature : null;
    return typeof celsius === 'number' && Number.isFinite(celsius) ? celsius.toFixed(1) : null;
  });
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

/**
 * Group, Steam, Water and Scale: four in a row, or two by two where a row of
 * four has no room. Every readout keeps its caption line, empty or not, so
 * the rows line up and nothing moves when "Refill" or "No scale" appears.
 */
export function MachineReadouts({ columns }: { columns: 2 | 4 }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, columnGap: 1, rowGap: 1, mt: 0.75 }}>
      <GroupTemperature />
      <SteamTemperature />
      <WaterLevel />
      <ScaleWeight />
    </Box>
  );
}
