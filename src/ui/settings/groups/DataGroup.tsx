/**
 * Settings > Data and privacy (D233): the backup into Decaid and what it
 * holds (BackupCard.tsx), sharing usage with CafAI's developer
 * (UsageRow.tsx, D212, only in a build that shares), and the log
 * (LogSection.tsx, D139), which was last on the old page, and Your data
 * (ExportCard.tsx: Export, D244). On a wide pane the log has the second
 * column; Your data follows the backup in the first.
 */
import { BackupCard } from '../BackupCard.tsx';
import { ExportCard } from '../ExportCard.tsx';
import { CardColumn, CardColumns } from '../groupLayout.tsx';
import { LogSection } from '../LogSection.tsx';
import { ShareUsageSection } from '../UsageRow.tsx';

export function DataGroup() {
  return (
    <CardColumns>
      <CardColumn>
        <BackupCard />
        <ExportCard />
        <ShareUsageSection />
      </CardColumn>
      <CardColumn>
        <LogSection />
      </CardColumn>
    </CardColumns>
  );
}
