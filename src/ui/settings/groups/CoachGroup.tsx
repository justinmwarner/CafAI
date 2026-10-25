/**
 * Settings > Coach (D233): where the coach runs (CoachSourceSection.tsx),
 * the Anthropic API key while it runs there (ApiKeySection.tsx, D140: the
 * key and the bridge's address and code take turns with the choice, and
 * neither shows until the saved choice is read), the model and its replies
 * (ModelCard.tsx: the model, how the coach replies and fun facts), and what
 * the coach has used and cost (UsageCard.tsx, D239). Where it runs and the
 * key share the first column on a wide pane, the model and the usage the
 * second.
 */
import { ApiKeySection } from '../ApiKeySection.tsx';
import { CoachSourceSection } from '../CoachSourceSection.tsx';
import { useShowsApiKey } from '../coachSourceView.ts';
import { CardColumn, CardColumns } from '../groupLayout.tsx';
import { ModelCard } from '../ModelCard.tsx';
import { UsageCard } from '../UsageCard.tsx';

export function CoachGroup() {
  const showsApiKey = useShowsApiKey();
  return (
    <CardColumns>
      <CardColumn>
        <CoachSourceSection />
        {showsApiKey ? <ApiKeySection /> : null}
      </CardColumn>
      <CardColumn>
        <ModelCard />
        <UsageCard />
      </CardColumn>
    </CardColumns>
  );
}
