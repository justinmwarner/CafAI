/**
 * Settings > Drink screens (D217, D222): what each drink's view
 * shows while it runs, one of the drink's scenes (scenes/catalog.ts), and
 * whether the view goes back by itself once the drink is done, and after how
 * long (D221). The section after Steam, hot water and flush: those are
 * Decaid's, held while the machine runs; these are CafAI's, kept on this
 * device and live whatever the machine does. Each change applies at once and
 * is saved with CafAI's settings, as the temperature unit is
 * (src/app/drinkScreens.ts); a save that failed says so in an error Alert,
 * the change kept on screen until another one is saved.
 *
 * Laid out as the section above (DrinkSettingsSection.tsx): a group for each
 * drink under the machine row's icon and its name, side by side on a tablet
 * and stacked on a phone, where each setting is one row with its control at
 * the end. Go back by itself is a switch, as Sleep when idle's, with After
 * (the drinks' stepper) under it while it is on. Shown only when the services
 * carry the store.
 */
import { useId, useRef, useState, type ReactElement } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import AirRounded from '@mui/icons-material/AirRounded';
import ShowerRounded from '@mui/icons-material/ShowerRounded';
import WaterDropRounded from '@mui/icons-material/WaterDropRounded';
import type { DrinkScreenChoice, DrinkScreensStore } from '../../app/drinkScreens.ts';
import { GO_BACK_SECONDS } from '../../storage/settings.ts';
import type { DrinkScreen } from '../../storage/types.ts';
import type { DrinkKind } from '../drinks/kinds.ts';
import { SCENES, sceneFor } from '../drinks/scenes/catalog.ts';
import { useDrinkScreenChoices, useDrinkScreensStore } from '../drinks/useDrinkScreens.ts';
import { TID } from '../testIds.ts';
import { DrinkField } from './DrinkFields.tsx';
import type { DrinkFieldSpec } from './drinkSettings.ts';
import { Section } from './Section.tsx';

const HELP = "What each drink's screen shows while it runs, and whether it goes back by itself once it's done. Kept on this device.";
const STAYS = 'The screen stays until you tap Go back.';

const mutedSx = { color: 'text.secondary' } as const;

interface ScreenDrink {
  kind: DrinkKind;
  /** As the machine row names it. */
  name: string;
  icon: ReactElement;
}

/** The drinks in the order of the section above (Steam, hot water and flush), each with the machine row's own icon (MachineRow.tsx). */
const DRINKS: readonly ScreenDrink[] = [
  { kind: 'steam', name: 'Steam', icon: <AirRounded fontSize="small" /> },
  { kind: 'hotWater', name: 'Hot water', icon: <WaterDropRounded fontSize="small" /> },
  { kind: 'flush', name: 'Flush', icon: <ShowerRounded fontSize="small" /> },
];

/** After, as the drinks' stepper takes a setting (drinkSettings.ts): 5 to 60 s, 5 a tap, any whole second typed. */
function afterField(drink: string): DrinkFieldSpec {
  return {
    key: 'goBackSeconds',
    label: `${drink} go back after`,
    shortLabel: 'After',
    unit: 's',
    spokenUnit: 'seconds',
    integer: true,
    step: 5,
    range: GO_BACK_SECONDS,
  };
}

/** Three drinks side by side from 600 px (a tablet, a phone on its side), stacked under that. */
const groupsSx = {
  display: 'grid',
  gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(3, minmax(0, 1fr))' },
  gap: 3,
} as const;

/**
 * A drink's settings as the section above lays them out (DrinkFields.tsx): on
 * a phone one row each, the label then the control at the end, 184 px wide
 * (on the narrowest phones what the longest label leaves); from 600 px each
 * label over its control.
 */
const fieldsSx = {
  display: 'grid',
  gridTemplateColumns: { xs: 'max-content minmax(0, 184px)', sm: 'minmax(0, 1fr)' },
  justifyContent: { xs: 'space-between', sm: 'stretch' },
  alignItems: 'center',
  columnGap: 2,
  rowGap: { xs: 1, sm: 1.5 },
} as const;

/** One setting: on a phone its label and control join the grid's row; from 600 px a column of its own. */
const fieldSx = { display: { xs: 'contents', sm: 'grid' }, rowGap: 0.75 } as const;

/** Animation's label as the steppers' have theirs: a row's label read like a list; over its control a muted field label. */
const labelSx: SxProps<Theme> = (theme) => ({
  ...theme.typography.body2,
  color: theme.palette.text.primary,
  [theme.breakpoints.up('sm')]: { ...theme.typography.label, color: theme.palette.text.secondary },
});

/** A native select opens only from the select element itself, so it is the 48 px target. */
const selectSx = { '& .MuiInputBase-root': { minHeight: 48 }, '& .MuiNativeSelect-select': { py: '12.5px' } } as const;

/**
 * The switch's row spans the grid without widening the labels' column, which
 * would squeeze the controls on a phone: as a stepper's note
 * (DrinkFields.tsx), it has no width of its own and fills the row through
 * min-width.
 */
const switchRowSx = { gridColumn: '1 / -1', width: 0, minWidth: '100%' } as const;

/** MUI's switch is 38 px tall: the label around it, which toggles it too, is the 48 px touch target. */
const switchLabelSx = { minHeight: 48, mr: 0 } as const;

/**
 * In After's place while Go back by itself is off, spanning the row as the
 * switch's does, and at least a row's height, so nothing under it moves on a
 * phone; from 600 px it starts where After's label did.
 */
const staysSx = {
  ...switchRowSx,
  ...mutedSx,
  minHeight: 48,
  display: 'flex',
  alignItems: { xs: 'center', sm: 'flex-start' },
} as const;

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

interface DrinkScreenGroupProps {
  drink: ScreenDrink;
  choice: DrinkScreenChoice;
  onChange(change: Partial<DrinkScreen>): void;
}

/**
 * One drink: the machine row's icon and its name, then its Animation, Go back
 * by itself and After. A group, named by its heading; each control is named
 * for its drink too ("Steam animation"), the label shown saying only what.
 */
function DrinkScreenGroup({ drink, choice, onChange }: DrinkScreenGroupProps) {
  const headingId = useId();
  const selectId = useId();
  return (
    <Box role="group" aria-labelledby={headingId}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, color: 'text.secondary' }}>
        {drink.icon}
        <Typography id={headingId} variant="subtitle2" component="h3" sx={{ color: 'text.primary' }}>
          {drink.name}
        </Typography>
      </Box>
      <Box sx={fieldsSx}>
        <Box sx={fieldSx}>
          <Typography component="label" htmlFor={selectId} sx={labelSx}>
            Animation
          </Typography>
          <TextField
            select
            size="small"
            id={selectId}
            // A scene this build does not know (a newer build's) shows as the drink's default, as the dial draws it.
            value={sceneFor(drink.kind, choice.scene)}
            onChange={(event) => onChange({ scene: event.target.value })}
            sx={selectSx}
            slotProps={{
              select: { native: true },
              htmlInput: { 'aria-label': `${drink.name} animation`, 'data-testid': TID.drinkScene(drink.kind) },
            }}
          >
            {SCENES[drink.kind].map((scene) => (
              <option key={scene.id} value={scene.id}>
                {scene.name}
              </option>
            ))}
          </TextField>
        </Box>
        <Box sx={switchRowSx}>
          <FormControlLabel
            control={
              <Switch
                checked={choice.goBack}
                onChange={(event) => onChange({ goBack: event.target.checked })}
                slotProps={{ input: { 'aria-label': `Go back by itself after ${drink.name}`, 'data-testid': TID.drinkGoBackSwitch(drink.kind) } }}
              />
            }
            label="Go back by itself"
            // In the rows' size, as the labels beside the controls on a phone.
            slotProps={{ typography: { variant: 'body2' } }}
            sx={switchLabelSx}
          />
        </Box>
        {choice.goBack ? (
          <DrinkField
            spec={afterField(drink.name)}
            value={choice.goBackSeconds}
            loaded
            disabled={false}
            saving={false}
            error={null}
            layout="responsive"
            onCommit={(goBackSeconds) => onChange({ goBackSeconds })}
          />
        ) : (
          <Typography variant="body2" sx={staysSx}>
            {STAYS}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

function DrinkScreensForm({ store }: { store: DrinkScreensStore }) {
  const choices = useDrinkScreenChoices();
  const [error, setError] = useState<string | null>(null);
  const latestSave = useRef(0);

  /** The store shows the change at once and saves it; a failure says so under the help until a later change is saved. */
  const save = (kind: DrinkKind, change: Partial<DrinkScreen>) => {
    const ticket = ++latestSave.current;
    store.set(kind, change).then(
      () => {
        // An older change that saved clears nothing: a newer one may have failed.
        if (ticket === latestSave.current) setError(null);
      },
      (reason: unknown) => setError(`Could not save the drink screens: ${errorText(reason)}`),
    );
  };

  return (
    <Section title="Drink screens">
      <Stack spacing={2} data-testid={TID.drinkScreens}>
        <Typography variant="body2" sx={mutedSx}>
          {HELP}
        </Typography>
        {error ? (
          <Alert severity="error" data-testid={TID.drinkScreensError}>
            {error}
          </Alert>
        ) : null}
        <Box sx={groupsSx}>
          {DRINKS.map((drink) => (
            <DrinkScreenGroup key={drink.kind} drink={drink} choice={choices[drink.kind]} onChange={(change) => save(drink.kind, change)} />
          ))}
        </Box>
      </Stack>
    </Section>
  );
}

export function DrinkScreensSection() {
  const store = useDrinkScreensStore();
  // Without the store (a preview) there is nothing to keep a choice in: every drink keeps its default.
  return store ? <DrinkScreensForm store={store} /> : null;
}
