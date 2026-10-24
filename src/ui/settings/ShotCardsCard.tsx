/**
 * Settings > Display > Shot cards: what a shot's card shows, for now whether
 * it carries the TDS cell and the extraction (ShowTdsRow.tsx, D246), applied
 * at once as the rest of Display. Without the display store (a preview) the
 * row has nowhere to keep a choice and draws nothing, so neither does the
 * card.
 */
import { useOptionalServices } from '../../app/services.tsx';
import { Section } from './Section.tsx';
import { ShowTdsRow } from './ShowTdsRow.tsx';

export const SHOT_CARDS_TITLE = 'Shot cards';

export function ShotCardsCard() {
  const store = useOptionalServices()?.displayPrefs;
  if (!store) return null;
  return (
    <Section title={SHOT_CARDS_TITLE}>
      <ShowTdsRow />
    </Section>
  );
}
