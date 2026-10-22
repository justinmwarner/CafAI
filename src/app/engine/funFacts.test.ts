import { describe, expect, it } from 'vitest';
import type { ShotSummary } from '../../coach/types.ts';
import type { IterationOutcome, IterationRecord } from '../../storage/types.ts';
import { FUN_FACTS_SOURCES } from '../../coach/facts/types.ts';
import { coachShares, previousLikeShot } from './funFacts.ts';

describe('coachShares (D198)', () => {
  it("is the coach's mode and the web mode", () => {
    expect(FUN_FACTS_SOURCES.filter(coachShares)).toEqual(['coach', 'web']);
  });
});

const summaryOf = (shotId: string): ShotSummary => ({ shotId, durationS: 28 }) as ShotSummary;

let minute = 0;
function iteration(shotId: string, outcome: IterationOutcome, versionId = 'ver-2'): IterationRecord {
  minute += 1;
  const at = `2026-10-16T08:${String(minute).padStart(2, '0')}:00.000Z`;
  return {
    id: `iter-${shotId}`,
    bagId: 'bag-1',
    bagName: 'Kiambu AA',
    profileVersionId: versionId,
    profileVersion: versionId === 'ver-2' ? 2 : 1,
    shotId,
    summary: summaryOf(shotId),
    feedback: null,
    proposal: null,
    change: null,
    outcome,
    createdAt: at,
    updatedAt: at,
  };
}

describe('previousLikeShot (D197)', () => {
  it('is the shot before, once the barista kept the recipe the new shot ran', () => {
    const iterations = [iteration('shot-1', 'applied', 'ver-1'), iteration('shot-2', 'kept')];
    expect(previousLikeShot(iterations, 'ver-2', 'shot-3')?.shotId).toBe('shot-2');
  });

  it("reads the same with the new shot's own iteration in the list", () => {
    const iterations = [iteration('shot-2', 'kept'), iteration('shot-3', 'pending')];
    expect(previousLikeShot(iterations, 'ver-2', 'shot-3')?.shotId).toBe('shot-2');
  });

  it('compares with the latest earlier shot on the version, one left unanswered included', () => {
    // Shot 3 was never answered: a new shot set its question aside.
    const iterations = [iteration('shot-2', 'kept'), iteration('shot-3', 'superseded'), iteration('shot-4', 'pending')];
    expect(previousLikeShot(iterations, 'ver-2', 'shot-4')?.shotId).toBe('shot-3');
    expect(previousLikeShot([iteration('shot-2', 'kept'), iteration('shot-3', 'pending')], 'ver-2', 'shot-4')?.shotId).toBe('shot-3');
  });

  it('is none until a recipe was kept, or once a later decision changed something', () => {
    expect(previousLikeShot([], 'ver-2', 'shot-1')).toBeNull();
    expect(previousLikeShot([iteration('shot-1', 'pending')], 'ver-2', 'shot-2')).toBeNull();
    for (const outcome of ['applied', 'declined', 'undone'] as const) {
      expect(previousLikeShot([iteration('shot-1', 'kept'), iteration('shot-2', outcome)], 'ver-2', 'shot-3'), outcome).toBeNull();
    }
  });

  it('is none when the kept recipe is not the one the new shot ran', () => {
    // Kept on v1, and the barista has moved on to v2 since (or undone back from it).
    expect(previousLikeShot([iteration('shot-1', 'kept', 'ver-1')], 'ver-2', 'shot-2')).toBeNull();
  });

  it('is none without an earlier summary to compare with', () => {
    expect(previousLikeShot([{ ...iteration('shot-1', 'kept'), summary: null }], 'ver-2', 'shot-2')).toBeNull();
  });
});
