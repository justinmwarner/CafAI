/**
 * Settings > About (D233): CafAI's and Decaid's versions, the verified line
 * and the drift report (AboutCard.tsx); What's new and Report a problem
 * (D248) follow it in the same column.
 */
import { AboutCard } from '../AboutCard.tsx';
import { CardColumn, CardColumns } from '../groupLayout.tsx';

export function AboutGroup() {
  return (
    <CardColumns>
      <CardColumn>
        <AboutCard />
      </CardColumn>
    </CardColumns>
  );
}
