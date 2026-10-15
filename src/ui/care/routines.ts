/**
 * The cleaning guide's routines, by how often (D153): one at a time on the
 * Care screen, and part of its address (`#/care/weekly`).
 */
export type RoutineId = 'daily' | 'weekly' | 'monthly' | 'asNeeded';

/** In the order the segments show them. */
export const ROUTINE_IDS: readonly RoutineId[] = ['daily', 'weekly', 'monthly', 'asNeeded'];
