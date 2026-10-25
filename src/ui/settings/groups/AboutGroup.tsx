/**
 * Settings > About (D233): CafAI's and Decaid's versions, the verified line,
 * the drift report, What's new and Report a problem (AboutCard.tsx, D248).
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
