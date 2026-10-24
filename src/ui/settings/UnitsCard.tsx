/**
 * Settings > Display > Units: how CafAI writes what it measures. For now the
 * temperatures, °C or °F (TemperatureUnitRow.tsx, D172), which left
 * Appearance for this card; the clock (D245) takes its place under them.
 * Each row applies at once, with no Save, as the rest of Display does.
 */
import Stack from '@mui/material/Stack';
import { Section } from './Section.tsx';
import { TemperatureUnitRow } from './TemperatureUnitRow.tsx';

export const UNITS_CARD_TITLE = 'Units';

export function UnitsCard() {
  return (
    <Section title={UNITS_CARD_TITLE}>
      <Stack spacing={2}>
        <TemperatureUnitRow />
      </Stack>
    </Section>
  );
}
