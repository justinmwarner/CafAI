/**
 * Settings > Grinder (D233): your grinder, its setting and Add a grinder
 * (GrinderCard.tsx), one card, so one column of at most 760 px whatever the
 * width.
 */
import { CardColumn, CardColumns } from '../groupLayout.tsx';
import { GrinderCard } from '../GrinderCard.tsx';

export function GrinderGroup() {
  return (
    <CardColumns>
      <CardColumn>
        <GrinderCard />
      </CardColumn>
    </CardColumns>
  );
}
