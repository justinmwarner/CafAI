/**
 * Settings > Machine (D233): what Decaid does with the machine while it
 * runs, Sleep and wake (SleepWakeSection.tsx, D157), and Machine care
 * (CareSection.tsx, D152, D187), side by side on a wide pane. Care's "Set it
 * in Settings" opens this group and brings Machine care into view.
 */
import { CareSection } from '../CareSection.tsx';
import { CardColumn, CardColumns } from '../groupLayout.tsx';
import { SleepWakeSection } from '../SleepWakeSection.tsx';

export function MachineGroup() {
  return (
    <CardColumns>
      <CardColumn>
        <SleepWakeSection />
      </CardColumn>
      <CardColumn>
        <CareSection />
      </CardColumn>
    </CardColumns>
  );
}
