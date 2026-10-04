/**
 * Arranges a bag's stored versions and iterations for the history screen.
 */
import { getTemplate } from '../../coach/index.ts';
import type { IterationOutcome, IterationRecord, ProfileVersion, VersionStatus } from '../../storage/types.ts';

export interface VersionGroup {
  version: ProfileVersion;
  iterations: IterationRecord[];
}

/**
 * Versions newest first, each with its iterations in time order. An iteration
 * whose version id is gone (e.g. after an import) still finds its version by
 * number; iterations with no version at all are returned apart.
 */
export function groupHistory(
  versions: readonly ProfileVersion[],
  iterations: readonly IterationRecord[],
): { groups: VersionGroup[]; unassigned: IterationRecord[] } {
  const groups = [...versions]
    .sort((a, b) => b.version - a.version)
    .map((version) => ({ version, iterations: [] as IterationRecord[] }));
  const byId = new Map(groups.map((g) => [g.version.id, g]));
  const byNumber = new Map(groups.map((g) => [g.version.version, g]));
  const unassigned: IterationRecord[] = [];
  const ordered = [...iterations].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const record of ordered) {
    const group =
      (record.profileVersionId !== null ? byId.get(record.profileVersionId) : undefined) ??
      (record.profileVersion !== null ? byNumber.get(record.profileVersion) : undefined);
    if (group) group.iterations.push(record);
    else unassigned.push(record);
  }
  return { groups, unassigned };
}

/** The catalog's display name; an id no longer in the catalog is shown as words. */
export function templateName(templateId: string): string {
  const known = getTemplate(templateId)?.name;
  if (known) return known;
  const words = templateId.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const STATUS_LABELS: Record<VersionStatus, string> = {
  active: 'Active',
  superseded: 'Superseded',
  undone: 'Undone',
};

export function versionStatusLabel(status: VersionStatus): string {
  return STATUS_LABELS[status];
}

const OUTCOME_LABELS: Record<IterationOutcome, string> = {
  pending: 'No decision yet',
  applied: 'Change applied',
  declined: 'Change declined',
  undone: 'Change undone',
  kept: 'Kept as is',
  superseded: 'Superseded by the next shot',
};

export function outcomeLabel(outcome: IterationOutcome): string {
  return OUTCOME_LABELS[outcome];
}
