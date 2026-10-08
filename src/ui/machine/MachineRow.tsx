import Box from '@mui/material/Box';
import { TID } from '../testIds.ts';

export interface MachineRowProps {
  /** Icons only, for a phone's top bar; otherwise each icon over its label. */
  icons?: boolean;
}

export function MachineRow({ icons = false }: MachineRowProps) {
  return <Box data-testid={TID.machineRow} data-icons={icons ? 'true' : undefined} />;
}
