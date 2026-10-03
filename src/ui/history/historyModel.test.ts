import { describe, expect, it } from 'vitest';
import type { IterationRecord, ProfileVersion } from '../../storage/types.ts';
import { groupHistory, outcomeLabel, templateName, versionStatusLabel } from './historyModel.ts';

function version(n: number, id = `v${n}`): ProfileVersion {
  return {
    id,
    bagId: 'bag1',
    version: n,
    title: `Kiambu AA v${n}`,
    templateId: 'blooming-espresso',
    profile: {} as ProfileVersion['profile'],
    decaidProfileId: null,
    parentVersionId: null,
    change: null,
    status: 'superseded',
    createdAt: `2026-10-0${n}T08:00:00.000Z`,
  };
}

function iteration(id: string, createdAt: string, link: { versionId: string | null; n: number | null }): IterationRecord {
  return {
    id,
    bagId: 'bag1',
    bagName: 'Kiambu AA',
    profileVersionId: link.versionId,
    profileVersion: link.n,
    shotId: null,
    summary: null,
    feedback: null,
    proposal: null,
    change: null,
    outcome: 'pending',
    createdAt,
    updatedAt: createdAt,
  };
}

describe('groupHistory', () => {
  it('lists versions newest first with their iterations in time order', () => {
    const versions = [version(1), version(2)];
    const iterations = [
      iteration('b', '2026-10-02T09:00:00.000Z', { versionId: 'v2', n: 2 }),
      iteration('a', '2026-10-02T08:00:00.000Z', { versionId: 'v2', n: 2 }),
      iteration('c', '2026-10-01T08:30:00.000Z', { versionId: 'v1', n: 1 }),
    ];
    const { groups, unassigned } = groupHistory(versions, iterations);
    expect(groups.map((g) => g.version.version)).toEqual([2, 1]);
    expect(groups[0]?.iterations.map((i) => i.id)).toEqual(['a', 'b']);
    expect(groups[1]?.iterations.map((i) => i.id)).toEqual(['c']);
    expect(unassigned).toEqual([]);
  });

  it('falls back to the version number when the id does not match', () => {
    const { groups } = groupHistory([version(1, 'x')], [iteration('a', '2026-10-01T09:00:00.000Z', { versionId: 'gone', n: 1 })]);
    expect(groups[0]?.iterations.map((i) => i.id)).toEqual(['a']);
  });

  it('keeps iterations without a known version apart', () => {
    const { groups, unassigned } = groupHistory(
      [version(1)],
      [iteration('a', '2026-10-01T09:00:00.000Z', { versionId: null, n: null })],
    );
    expect(groups[0]?.iterations).toEqual([]);
    expect(unassigned.map((i) => i.id)).toEqual(['a']);
  });
});

describe('labels', () => {
  it('names the bundled templates and humanizes unknown ids', () => {
    expect(templateName('blooming-espresso')).toBe('Blooming Espresso');
    expect(templateName('d-flow')).toBe('D-Flow');
    expect(templateName('londonium')).toBe('Londonium');
    expect(templateName('some-new-template')).toBe('Some new template');
  });

  it('describes version statuses and iteration outcomes', () => {
    expect(versionStatusLabel('active')).toBe('Active');
    expect(versionStatusLabel('superseded')).toBe('Superseded');
    expect(versionStatusLabel('undone')).toBe('Undone');
    expect(outcomeLabel('pending')).toBe('No decision yet');
    expect(outcomeLabel('applied')).toBe('Change applied');
    expect(outcomeLabel('declined')).toBe('Change declined');
    expect(outcomeLabel('undone')).toBe('Change undone');
    expect(outcomeLabel('kept')).toBe('Kept as is');
  });
});
