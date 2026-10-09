/**
 * The machine row in the top bar, on every screen: Espresso, Steam, Flush
 * and Hot water. On a tablet each is its icon over a short label; a phone's
 * narrower bar shows the icons alone, each named for screen readers.
 *
 * While the machine runs anything, the start that runs turns into Stop in its
 * own place, filled in the error colour and the same size, so the finger that
 * started it finds Stop where it already is; the other starts are held. A
 * machine with a group-head controller starts from the group head: its row is
 * empty until something runs, then holds Stop alone. A sleeping machine shows
 * Wake alone.
 *
 * Stop turns back into a start in the place the finger just tapped, and Wake
 * into the row of starts: so for a moment after a run ends or the machine
 * wakes the starts are held, and a second tap meant for Stop or Wake starts
 * nothing.
 *
 * A failure has no room here: MachineAlerts shows it under the top bar.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button, { type ButtonProps } from '@mui/material/Button';
import AirRounded from '@mui/icons-material/AirRounded';
import CoffeeRounded from '@mui/icons-material/CoffeeRounded';
import ShowerRounded from '@mui/icons-material/ShowerRounded';
import StopRounded from '@mui/icons-material/StopRounded';
import WaterDropRounded from '@mui/icons-material/WaterDropRounded';
import WbSunnyRounded from '@mui/icons-material/WbSunnyRounded';
import { TID } from '../testIds.ts';
import type { StartCommand } from './commands.ts';
import { useMachineCommands } from './useMachineCommands.ts';

interface StartButtonSpec {
  command: StartCommand;
  label: string;
  icon: ReactNode;
  testId: string;
}

const START_BUTTONS: readonly StartButtonSpec[] = [
  { command: 'espresso', label: 'Espresso', icon: <CoffeeRounded />, testId: TID.espressoButton },
  { command: 'steam', label: 'Steam', icon: <AirRounded />, testId: TID.steamButton },
  { command: 'flush', label: 'Flush', icon: <ShowerRounded />, testId: TID.flushButton },
  { command: 'hotWater', label: 'Hot water', icon: <WaterDropRounded />, testId: TID.hotWaterButton },
];

/** How long the starts stay held after a run ends or the machine wakes. */
export const STARTS_HOLD_MS = 1000;

/** The start whose place Stop takes while the machine is in `state`. */
function stopPlace(state: string | null): StartCommand {
  switch (state) {
    case 'steam':
    case 'steamRinse':
      return 'steam';
    case 'flush':
    case 'airPurge':
      return 'flush';
    case 'hotWater':
      return 'hotWater';
    default:
      // A shot (espresso, skipStep), and anything else that runs (cleaning, descaling).
      return 'espresso';
  }
}

/** True while `flag` holds and for `ms` after it ends. */
function useHeldFor(flag: boolean, ms: number): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (flag) {
      setHeld(true);
      return;
    }
    const timer = setTimeout(() => setHeld(false), ms);
    return () => clearTimeout(timer);
  }, [flag, ms]);
  return flag || held;
}

/** The icon over its label, in a box Stop keeps when it takes the place. */
const LABELLED_SX = {
  width: 54,
  minWidth: 54,
  height: 48,
  p: 0,
  flex: 'none',
  flexDirection: 'column',
  gap: '1px',
  fontSize: '0.71875rem',
  lineHeight: 1.15,
  letterSpacing: 0,
  // "Hot water" on one line: a wrapped label would make this box taller than its neighbours.
  whiteSpace: 'nowrap',
  '& .MuiSvgIcon-root': { fontSize: 21 },
} as const;

/** The icon alone, in a phone's bar. */
const ICON_SX = {
  width: 44,
  minWidth: 44,
  height: 44,
  minHeight: 44,
  p: 0,
  flex: 'none',
  '& .MuiSvgIcon-root': { fontSize: 22 },
} as const;

interface RowButtonProps extends Omit<ButtonProps, 'children' | 'sx'> {
  icons: boolean;
  label: string;
  icon: ReactNode;
  testId?: string;
  /** Stop's label is set at 700. */
  bold?: boolean;
}

function RowButton({ icons, label, icon, testId, bold = false, ...props }: RowButtonProps) {
  return (
    <Button
      data-testid={testId}
      // Icons alone: the label is the button's name.
      aria-label={icons ? label : undefined}
      sx={[icons ? ICON_SX : LABELLED_SX, bold && { fontWeight: 700 }]}
      {...props}
    >
      {icon}
      {icons ? null : <span>{label}</span>}
    </Button>
  );
}

const visuallyHidden = {
  position: 'absolute',
  // Strings: in sx a bare 1 is 100%, a box as wide and tall as the pane that the frame could be scrolled to.
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
} as const;

export interface MachineRowProps {
  /** Icons only, for a phone's top bar; otherwise each icon over its label. */
  icons?: boolean;
}

export function MachineRow({ icons = false }: MachineRowProps) {
  const { model, state, pending, start, stop, sleepWake } = useMachineCommands();
  const reasonId = useId();
  const asleep = state === 'sleeping';
  const held = useHeldFor(model.running || asleep, STARTS_HOLD_MS);
  const stopHere = model.running ? stopPlace(state) : null;

  // Keyed as the start it replaces, so it is that very button, changed.
  const stopButton = (key: string) => (
    <RowButton
      key={key}
      icons={icons}
      label="Stop"
      icon={<StopRounded />}
      testId={TID.stopButton}
      variant="contained"
      color="error"
      bold
      disabled={!model.stopEnabled}
      onClick={stop}
    />
  );

  let buttons: ReactNode = null;
  // Why the starts are off, for a screen reader (the alert under the top bar says it on screen).
  let reason: string | null = null;
  if (asleep) {
    buttons = (
      <RowButton
        icons={icons}
        label="Wake"
        icon={<WbSunnyRounded />}
        color="inherit"
        disabled={!model.sleepWake.enabled}
        loading={pending === model.sleepWake.command}
        onClick={sleepWake}
      />
    );
  } else if (!model.startsVisible) {
    // A group-head machine: Stop alone while it runs; otherwise only its note, for a screen reader.
    if (model.running) buttons = stopButton('stop');
    else reason = model.startReason;
  } else {
    reason = model.startReason;
    buttons = START_BUTTONS.map((spec) =>
      spec.command === stopHere ? (
        stopButton(spec.command)
      ) : (
        <RowButton
          key={spec.command}
          icons={icons}
          label={spec.label}
          icon={spec.icon}
          testId={spec.testId}
          color="inherit"
          disabled={!model.startsEnabled || held}
          loading={pending === spec.command}
          aria-describedby={reason ? reasonId : undefined}
          onClick={() => start(spec.command)}
        />
      ),
    );
  }

  return (
    <Box
      role="group"
      aria-label="Machine"
      data-testid={TID.machineRow}
      data-icons={icons ? 'true' : undefined}
      sx={{ flex: 'none', display: 'flex', alignItems: 'center', gap: '2px' }}
    >
      {buttons}
      {reason && (
        <Box component="span" id={reasonId} sx={visuallyHidden}>
          {reason}
        </Box>
      )}
    </Box>
  );
}
