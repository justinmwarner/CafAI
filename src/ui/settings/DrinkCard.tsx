/**
 * Settings > Drinks: one drink in one card (D235), Steam, Hot water or
 * Flush under the machine row's own icon and name. First what the machine
 * runs it with, Decaid's preset (DrinkFields.tsx, read and written by
 * useDrinkPresets.ts in the group, D114, D124): held while the machine runs
 * or no DE1 is connected, the reason said once over the three cards
 * (DrinksGroup.tsx). Then "On screen", CafAI's own (D217, D221, D222): the
 * drink's Animation, Go back by itself and After, kept on this device and
 * live whatever the machine does, each change shown at once and saved with
 * CafAI's settings (src/app/drinkScreens.ts); a save that failed says so in
 * the card, the change kept on screen until another one saves. Without the
 * drink screens' store (a preview) the card is the machine's settings alone.
 *
 * Laid out for the room the group's pane has, not the window (D235): three
 * across from 840 px of pane width, each setting's label over its control;
 * stacked under that, each setting one row with its control at the end, as
 * a phone always had them.
 */
import { useId } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import type { DrinkScreenChoice } from '../../app/drinkScreens.ts';
import { GO_BACK_SECONDS } from '../../storage/settings.ts';
import type { DrinkScreen } from '../../storage/types.ts';
import type { DrinkKind } from '../drinks/kinds.ts';
import { SCENES, sceneFor } from '../drinks/scenes/catalog.ts';
import { TID } from '../testIds.ts';
import { DrinkField, DrinkFieldsGrid, type Drink, type DrinkFieldsLayout } from './DrinkFields.tsx';
import type { DrinkFieldSpec } from './drinkSettings.ts';
import { Section, useSubheadingLevel } from './Section.tsx';
import type { DrinkPresetsState } from './useDrinkPresets.ts';

export const STAYS = 'The screen stays until you tap Go back.';

const mutedSx = { color: 'text.secondary' } as const;

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

/**
 * The screen's settings as the machine's sit above them: in rows, the labels
 * then the controls at the end, 184 px (on the narrowest phones what the
 * longest label leaves); stacked, each label over its control.
 */
function fieldsSx(stacked: boolean) {
  return stacked
    ? ({ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', rowGap: 1.5 } as const)
    : ({
        display: 'grid',
        gridTemplateColumns: 'max-content minmax(0, 184px)',
        justifyContent: 'space-between',
        alignItems: 'center',
        columnGap: 2,
        rowGap: 1,
      } as const);
}

/** One setting: in rows its label and control join the grid's row; stacked, a column of its own. */
const fieldSx = (stacked: boolean) => (stacked ? ({ display: 'grid', rowGap: 0.75 } as const) : ({ display: 'contents' } as const));

/** Animation's label as the steppers' have theirs: a row's label read like a list; over its control a muted field label. */
function labelSx(stacked: boolean): SxProps<Theme> {
  return (theme) => (stacked ? { ...theme.typography.label, color: theme.palette.text.secondary } : { ...theme.typography.body2, color: theme.palette.text.primary });
}

/** A native select opens only from the select element itself, so it is the 48 px target. */
const selectSx = { '& .MuiInputBase-root': { minHeight: 48 }, '& .MuiNativeSelect-select': { py: '12.5px' } } as const;

/**
 * The switch's row spans the grid without widening the labels' column, which
 * would squeeze the controls in rows: as a stepper's note (DrinkFields.tsx),
 * it has no width of its own and fills the row through min-width.
 */
const switchRowSx = { gridColumn: '1 / -1', width: 0, minWidth: '100%' } as const;

/** MUI's switch is 38 px tall: the label around it, which toggles it too, is the 48 px touch target. */
const switchLabelSx = { minHeight: 48, mr: 0 } as const;

/** In After's place while Go back by itself is off, at least a row's height, so nothing under it moves. */
const staysSx = { ...switchRowSx, ...mutedSx, minHeight: 48, display: 'flex', alignItems: 'center' } as const;

interface ScreenFieldsProps {
  kind: DrinkKind;
  name: string;
  choice: DrinkScreenChoice;
  stacked: boolean;
  onChange(change: Partial<DrinkScreen>): void;
}

/** "On screen": the drink's Animation, Go back by itself and After, each control named for its drink too ("Steam animation"). */
function ScreenFields({ kind, name, choice, stacked, onChange }: ScreenFieldsProps) {
  const selectId = useId();
  return (
    <Box sx={fieldsSx(stacked)}>
      <Box sx={fieldSx(stacked)}>
        <Typography component="label" htmlFor={selectId} sx={labelSx(stacked)}>
          Animation
        </Typography>
        <TextField
          select
          size="small"
          id={selectId}
          // A scene this build does not know (a newer build's) shows as the drink's default, as the dial draws it.
          value={sceneFor(kind, choice.scene)}
          onChange={(event) => onChange({ scene: event.target.value })}
          sx={selectSx}
          slotProps={{
            select: { native: true },
            htmlInput: { 'aria-label': `${name} animation`, 'data-testid': TID.drinkScene(kind) },
          }}
        >
          {SCENES[kind].map((scene) => (
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
              slotProps={{ input: { 'aria-label': `Go back by itself after ${name}`, 'data-testid': TID.drinkGoBackSwitch(kind) } }}
            />
          }
          label="Go back by itself"
          // In the rows' size, as the labels beside the controls.
          slotProps={{ typography: { variant: 'body2' } }}
          sx={switchLabelSx}
        />
      </Box>
      {choice.goBack ? (
        <DrinkField
          spec={afterField(name)}
          value={choice.goBackSeconds}
          loaded
          disabled={false}
          saving={false}
          error={null}
          layout={stacked ? 'responsive' : 'rows'}
          onCommit={(goBackSeconds) => onChange({ goBackSeconds })}
        />
      ) : (
        <Typography variant="body2" sx={staysSx}>
          {STAYS}
        </Typography>
      )}
    </Box>
  );
}

export interface DrinkCardProps {
  kind: DrinkKind;
  /** The drink's machine settings: its name, icon and fields (drinksFor, DrinkFields.tsx). */
  drink: Drink;
  /** Decaid's presets as the group read them, shared by the three cards. */
  presets: DrinkPresetsState;
  /** The drink's screen as chosen; null without the store (a preview), and then no On screen. */
  screen: DrinkScreenChoice | null;
  /** Why the last change of this drink's screen did not save, until one does. */
  screenError: string | null;
  onScreenChange(change: Partial<DrinkScreen>): void;
  /** Three across: each setting's label over its control. */
  stacked: boolean;
}

export function DrinkCard({ kind, drink, presets, screen, screenError, onScreenChange, stacked }: DrinkCardProps) {
  const subheading = useSubheadingLevel();
  // From the tablet's 600 px up, 'responsive' sets each label over its stepper: the card is only ever stacked on a tablet.
  const layout: DrinkFieldsLayout = stacked ? 'responsive' : 'rows';
  return (
    <Section title={drink.name} icon={drink.icon}>
      <DrinkFieldsGrid
        drink={drink}
        data={presets.presets?.[drink.key] ?? null}
        loaded={presets.loaded}
        disabled={presets.disabled}
        pending={presets.pending}
        failed={presets.failed}
        onCommit={presets.commit}
        layout={layout}
      />
      {screen ? (
        <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
          <Typography variant="subtitle2" component={subheading} sx={{ mb: 1 }}>
            On screen
          </Typography>
          <ScreenFields kind={kind} name={drink.name} choice={screen} stacked={stacked} onChange={onScreenChange} />
          {screenError ? (
            <Alert severity="error" data-testid={TID.drinkScreensError} sx={{ mt: 1.5 }}>
              {screenError}
            </Alert>
          ) : null}
        </Box>
      ) : null}
    </Section>
  );
}
