/**
 * Settings > Display (D233): how CafAI looks (AppearanceSection.tsx: Mode,
 * Tint, Custom hue), its units (UnitsCard.tsx: the temperatures and the
 * clock), what shot cards show (ShotCardsCard.tsx: the TDS cell, D246) and
 * the screensaver (ScreensaverSection.tsx, D225, D247). Appearance has the
 * first column of a wide pane to itself; the rest share the second.
 */
import { AppearanceSection } from '../AppearanceSection.tsx';
import { CardColumn, CardColumns } from '../groupLayout.tsx';
import { ScreensaverSection } from '../ScreensaverSection.tsx';
import { ShotCardsCard } from '../ShotCardsCard.tsx';
import { UnitsCard } from '../UnitsCard.tsx';

export function DisplayGroup() {
  return (
    <CardColumns>
      <CardColumn>
        <AppearanceSection />
      </CardColumn>
      <CardColumn>
        <UnitsCard />
        <ShotCardsCard />
        <ScreensaverSection />
      </CardColumn>
    </CardColumns>
  );
}
