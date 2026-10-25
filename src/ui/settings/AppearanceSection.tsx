/**
 * Settings > Display > Appearance: dark, light or the device's own setting,
 * and a tint (a named one from palette.ts, or any hue from the slider). A
 * change shows on every screen at once and is saved with the other settings
 * (AppearanceStore, src/app/appearance.ts); the slider shows each hue as it
 * moves and saves only where it stops. The temperatures, which were last
 * here, are the Units card's now (UnitsCard.tsx).
 */
import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactElement } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { alpha, type SxProps, type Theme } from '@mui/material/styles';
import BrightnessAutoRounded from '@mui/icons-material/BrightnessAutoRounded';
import DarkModeRounded from '@mui/icons-material/DarkModeRounded';
import LightModeRounded from '@mui/icons-material/LightModeRounded';
import { useAppearance, useServices } from '../../app/services.tsx';
import type { Appearance, AppearanceMode } from '../../storage/types.ts';
import { paletteFor, resolveTint } from '../appearance.ts';
import { oklch } from '../color.ts';
import { DEFAULT_TINT_ID, TINTS } from '../palette.ts';
import { usePrefersDark } from '../platform/usePrefersDark.ts';
import { TID } from '../testIds.ts';
import { Section } from './Section.tsx';

// The test id goes on the slider's range input, the one element a test (or a
// keyboard) can focus and drive.
declare module '@mui/material/Slider' {
  interface SliderInputSlotPropsOverrides {
    'data-testid'?: string;
  }
}

const MODES: ReadonlyArray<{ mode: AppearanceMode; label: string; icon: ReactElement }> = [
  { mode: 'dark', label: 'Dark', icon: <DarkModeRounded fontSize="small" /> },
  { mode: 'light', label: 'Light', icon: <LightModeRounded fontSize="small" /> },
  { mode: 'auto', label: 'Auto', icon: <BrightnessAutoRounded fontSize="small" /> },
];

/** Round the hue wheel in 30 degree steps, as hex: the Chromium 91 WebView has no oklch(). */
const HUE_STOPS = Array.from({ length: 13 }, (_, step) => oklch(0.76, 0.11, step * 30)).join(', ');
const HUE_WHEEL = `conic-gradient(${HUE_STOPS})`;
const HUE_RAIL = `linear-gradient(90deg, ${HUE_STOPS})`;

const RAIL_HEIGHT = 30;
const RAIL_RADIUS = RAIL_HEIGHT / 2;
const THUMB_SHADOW = '0 1px 4px rgba(0, 0, 0, 0.5)';

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

/** The labels over the controls and the notes under them. */
const mutedSx = { color: 'text.secondary' } as const;

/** A segmented control: the chosen mode a paper-coloured pill on the raised track. */
const modeSx: SxProps<Theme> = (theme) => ({
  bgcolor: 'cafai.raised',
  borderRadius: '14px',
  p: '4px',
  gap: '4px',
  // Beats the group's own joined-button borders, margins and corners.
  '& .MuiToggleButtonGroup-grouped': {
    flex: '1 1 0',
    minWidth: 0,
    minHeight: 48,
    gap: '6px',
    m: 0,
    border: 0,
    borderRadius: '10px',
    color: 'text.secondary',
    fontSize: '0.9375rem',
    transition: theme.transitions.create(['background-color', 'color', 'box-shadow'], {
      duration: theme.transitions.duration.shorter,
    }),
    '&.Mui-selected, &.Mui-selected:hover': {
      bgcolor: 'background.paper',
      color: 'text.primary',
      boxShadow: `0 1px 2px rgba(0, 0, 0, ${theme.palette.mode === 'dark' ? 0.35 : 0.14})`,
    },
  },
});

/**
 * One tint: a round swatch with its name under it, the whole cell one
 * button so a tap on the name picks it too. The colours arrive as CSS
 * variables, so all eight cells share one class however the hue moves. A
 * name that wraps on a narrow phone ("Cold Brew" at 320 px) grows down from
 * the top, so the swatches of a row stay in line.
 */
const swatchSx: SxProps<Theme> = (theme) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'flex-start',
  textAlign: 'center',
  gap: '8px',
  minWidth: 0,
  py: '6px',
  borderRadius: '12px',
  color: 'text.secondary',
  '&[aria-checked="true"]': { color: 'text.primary' },
  '& .swatch-dot': {
    position: 'relative',
    width: 48,
    height: 48,
    borderRadius: '50%',
    background: 'var(--swatch-outer)',
    transition: theme.transitions.create(['box-shadow', 'transform'], { duration: theme.transitions.duration.shorter }),
    // The tint's page colour, so each swatch shows its accent on its own background.
    '&::after': {
      content: '""',
      position: 'absolute',
      top: 9,
      right: 9,
      bottom: 9,
      left: 9,
      borderRadius: '50%',
      background: 'var(--swatch-inner)',
    },
  },
  '&[aria-checked="true"] .swatch-dot': {
    boxShadow: `0 0 0 3px ${theme.palette.background.paper}, 0 0 0 5.5px ${theme.palette.text.primary}`,
  },
  '&:active .swatch-dot': { transform: 'scale(0.94)' },
});

function swatchColors(outer: string, inner: string): CSSProperties {
  return { '--swatch-outer': outer, '--swatch-inner': inner } as CSSProperties;
}

interface SwatchProps {
  id: string;
  name: string;
  checked: boolean;
  /** The ring: the tint's accent, or the hue wheel for Custom. */
  outer: string;
  /** The centre: the tint's page background. */
  inner: string;
  onSelect(): void;
}

function Swatch({ id, name, checked, outer, inner, onSelect }: SwatchProps) {
  return (
    <ButtonBase
      role="radio"
      aria-checked={checked}
      aria-label={name}
      data-testid={TID.tintSwatch(id)}
      disableRipple
      onClick={onSelect}
      style={swatchColors(outer, inner)}
      sx={swatchSx}
    >
      <span className="swatch-dot" />
      <Typography variant="label" component="span">
        {name}
      </Typography>
    </ButtonBase>
  );
}

/** Arrow keys, Home and End move between the tints; each is also a stop of its own in the tab order. */
function moveBetweenRadios(event: KeyboardEvent<HTMLElement>) {
  const radios = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
  const index = radios.indexOf(event.target as HTMLElement);
  if (index < 0) return;
  let next: number;
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      next = (index + 1) % radios.length;
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
      next = (index - 1 + radios.length) % radios.length;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = radios.length - 1;
      break;
    default:
      return;
  }
  event.preventDefault();
  radios[next]?.focus();
}

/**
 * The thumb travels between the centres of the rail's round ends, so it never
 * hangs off them: the rail reaches half its height past each end of the
 * slider, and its gradient repeats into those ends, which only works because
 * the hue wheel comes back round to where it started.
 */
const hueSx: SxProps<Theme> = (theme) => ({
  display: 'block',
  height: RAIL_HEIGHT,
  borderRadius: `${RAIL_RADIUS}px`,
  // A 48 px touch target: the rail and 9 px above and below it, on every pointer.
  py: '9px',
  '@media (pointer: coarse)': { py: '9px' },
  '& .MuiSlider-rail': {
    left: -RAIL_RADIUS,
    width: `calc(100% + ${RAIL_HEIGHT}px)`,
    px: `${RAIL_RADIUS}px`,
    boxSizing: 'border-box',
    opacity: 1,
    backgroundColor: 'transparent',
    backgroundImage: HUE_RAIL,
    backgroundOrigin: 'content-box',
  },
  '& .MuiSlider-thumb': {
    // 28 px of the accent inside a 4 px white ring.
    width: 36,
    height: 36,
    bgcolor: 'primary.main',
    border: '4px solid #fff',
    // MUI draws its elevation on ::before, inside the border, where it would grey the ring.
    '&::before': { display: 'none' },
    '&::after': { width: 48, height: 48 },
  },
  '& .MuiSlider-thumb, & .MuiSlider-thumb:hover, & .MuiSlider-thumb.Mui-focusVisible': { boxShadow: THUMB_SHADOW },
  '& .MuiSlider-thumb.Mui-active': {
    boxShadow: `${THUMB_SHADOW}, 0 0 0 10px ${alpha(theme.palette.primary.main, 0.24)}`,
  },
});

export function AppearanceSection() {
  const { appearance: store } = useServices();
  const appearance = useAppearance();
  const prefersDark = usePrefersDark();
  const modeHelpId = useId();
  const tintHelpId = useId();
  const [error, setError] = useState<string | null>(null);
  const latestSave = useRef(0);
  // The hue the slider last showed in this drag. MUI keeps its own record of
  // it past the end of a drag, so a later tap that does not move the thumb
  // would commit a stale hue from an earlier one.
  const dragged = useRef<number | null>(null);

  const custom = typeof appearance.tint !== 'string';
  // A tint this build does not know is drawn as the default (resolveTint), so it reads as that one here too.
  const checked = custom ? 'custom' : (TINTS.find((tint) => tint.id === appearance.tint)?.id ?? DEFAULT_TINT_ID);
  // The custom hue, or the named tint's own, so the slider starts from what is on screen.
  const hue = resolveTint(appearance.tint).hue;
  /** A tint as it looks in the mode on screen. */
  const look = (tint: Appearance['tint']) => paletteFor({ mode: appearance.mode, tint }, prefersDark);

  const save = (next: Appearance) => {
    const ticket = ++latestSave.current;
    setError(null);
    store.set(next).catch((reason: unknown) => {
      // Only the newest change speaks: one made after this that saved carried this one with it.
      if (ticket === latestSave.current) setError(`Could not save the appearance: ${errorText(reason)}`);
    });
  };
  // Each change keeps the other half of what is on screen now.
  const saveMode = (mode: AppearanceMode) => save({ ...store.get(), mode });
  const saveTint = (tint: Appearance['tint']) => save({ ...store.get(), tint });

  const previewHue = (value: number) => {
    dragged.current = value;
    store.preview({ ...store.get(), tint: { hue: value } });
  };
  const saveHue = () => {
    const value = dragged.current ?? hue;
    dragged.current = null;
    saveTint({ hue: value });
  };

  return (
    <Section title="Appearance">
      <Stack spacing={2}>
        <Stack spacing={1}>
          <Typography variant="label" component="div" sx={mutedSx}>
            Mode
          </Typography>
          <ToggleButtonGroup
            exclusive
            fullWidth
            aria-label="Mode"
            aria-describedby={modeHelpId}
            value={appearance.mode}
            // A tap on the chosen mode reports null: it stays chosen.
            onChange={(_event, mode: AppearanceMode | null) => {
              if (mode !== null) saveMode(mode);
            }}
            sx={modeSx}
          >
            {MODES.map(({ mode, label, icon }) => (
              <ToggleButton key={mode} value={mode} data-testid={TID.appearanceMode(mode)}>
                {icon}
                {label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Typography id={modeHelpId} variant="body2" sx={mutedSx}>
            Auto follows this device&apos;s light or dark setting.
          </Typography>
        </Stack>
        <Stack spacing={1}>
          <Typography variant="label" component="div" sx={mutedSx}>
            Tint
          </Typography>
          <Box
            role="radiogroup"
            aria-label="Tint"
            aria-describedby={tintHelpId}
            onKeyDown={moveBetweenRadios}
            sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '10px 6px' }}
          >
            {TINTS.map((tint) => {
              const palette = look(tint.id);
              return (
                <Swatch
                  key={tint.id}
                  id={tint.id}
                  name={tint.name}
                  checked={checked === tint.id}
                  outer={palette.accent}
                  inner={palette.background}
                  onSelect={() => saveTint(tint.id)}
                />
              );
            })}
            <Swatch
              id="custom"
              name="Custom"
              checked={custom}
              outer={HUE_WHEEL}
              inner={look({ hue }).background}
              onSelect={() => saveTint({ hue })}
            />
          </Box>
        </Stack>
        <Stack spacing={0.5}>
          <Typography variant="label" component="div" sx={mutedSx}>
            Custom hue
          </Typography>
          <Box sx={{ px: `${RAIL_RADIUS}px` }}>
            <Slider
              min={0}
              max={359}
              step={1}
              value={hue}
              track={false}
              aria-label="Custom hue"
              getAriaValueText={(value) => `${value} degrees`}
              onChange={(_event, value) => previewHue(value)}
              onChangeCommitted={saveHue}
              slotProps={{ input: { 'data-testid': TID.tintHue } }}
              sx={hueSx}
            />
          </Box>
          <Typography id={tintHelpId} variant="body2" sx={mutedSx}>
            The tint colours the buttons and tints the backgrounds. Shot graph colours never change: pressure green, flow blue.
          </Typography>
        </Stack>
        {error ? (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
      </Stack>
    </Section>
  );
}
