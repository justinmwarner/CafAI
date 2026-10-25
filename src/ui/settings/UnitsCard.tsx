/**
 * Settings > Display > Units: how CafAI writes what it measures and tells:
 * the temperatures, °C or °F (TemperatureUnitRow.tsx, D172), which left
 * Appearance for this card, and the clock, 24-hour or 12-hour (ClockRow.tsx,
 * D245). Each row applies at once, with no Save, as the rest of Display does.
 */
import Stack from '@mui/material/Stack';
import { ClockRow } from './ClockRow.tsx';
import { Section } from './Section.tsx';
import { TemperatureUnitRow } from './TemperatureUnitRow.tsx';

export const UNITS_CARD_TITLE = 'Units';

export function UnitsCard() {
  return (
    <Section title={UNITS_CARD_TITLE}>
      <Stack spacing={2}>
        <TemperatureUnitRow />
        <ClockRow />
      </Stack>
    </Section>
  );
}
