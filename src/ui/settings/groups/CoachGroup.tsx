/**
 * Settings > Coach (D233): where the coach runs (CoachSourceSection.tsx),
 * the Anthropic API key while it runs there (ApiKeySection.tsx, D140: the
 * key and the bridge's address and code take turns with the choice, and
 * neither shows until the saved choice is read), and the model and its
 * replies (ModelCard.tsx). Where it runs and the key share the first column
 * on a wide pane, the model the second, where Usage and cost (D239) joins
 * it.
 */
import { ApiKeySection } from '../ApiKeySection.tsx';
import { CoachSourceSection } from '../CoachSourceSection.tsx';
import { useShowsApiKey } from '../coachSourceView.ts';
import { CardColumn, CardColumns } from '../groupLayout.tsx';
import { ModelCard } from '../ModelCard.tsx';

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
      </CardColumn>
    </CardColumns>
  );
}
