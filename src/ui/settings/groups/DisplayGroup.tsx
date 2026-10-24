/**
 * Settings > Display (D233): how CafAI looks (AppearanceSection.tsx: Mode,
 * Tint, Custom hue), its units (UnitsCard.tsx: the temperatures) and the
 * screensaver (ScreensaverSection.tsx, D225). Appearance has the first
 * column of a wide pane to itself; Units and the screensaver share the
 * second, where Shot cards (D246) goes between them.
 */
import { AppearanceSection } from '../AppearanceSection.tsx';
import { CardColumn, CardColumns } from '../groupLayout.tsx';
import { ScreensaverSection } from '../ScreensaverSection.tsx';
import { UnitsCard } from '../UnitsCard.tsx';

export function DisplayGroup() {
  return (
    <CardColumns>
      <CardColumn>
        <AppearanceSection />
      </CardColumn>
      <CardColumn>
        <UnitsCard />
        <ScreensaverSection />
      </CardColumn>
    </CardColumns>
  );
}
