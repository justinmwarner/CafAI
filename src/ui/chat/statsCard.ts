/**
 * The stats card's place in the chat (D91): shown after one message of one
 * bag's chat, until anything new lands there. Screen-only state for this
 * session: never stored, never sent to the coach, and a reload starts afresh
 * (the chat's first showing posts the card again).
 */
export interface StatsCardSnapshot {
  /** The bag's chat and the message the card follows; null while hidden. */
  readonly at: { readonly bagId: string | null; readonly afterId: string | null } | null;
  /** The chat has shown this session, so the card has been posted once. */
  readonly opened: boolean;
}

export interface StatsCardState {
  /** The same object until the card moves or goes, as useSyncExternalStore needs. */
  getSnapshot(): StatsCardSnapshot;
  subscribe(listener: () => void): () => void;
  /** The chat's first showing this session: the card follows its newest message. Later calls do nothing. */
  open(bagId: string | null, newestId: string | null): void;
  /** The Stats prompt: the card moves to after the newest message. */
  show(bagId: string | null, newestId: string | null): void;
  /** Something new landed, or another bag opened: the card is gone until Stats. */
  hide(): void;
}

/** The card shows only right after the message it follows, in its own bag's chat. */
export function statsCardShown(snapshot: StatsCardSnapshot, bagId: string | null, newestId: string | null): boolean {
  return snapshot.at !== null && snapshot.at.bagId === bagId && snapshot.at.afterId === newestId;
}

export function createStatsCardState(): StatsCardState {
  let snapshot: StatsCardSnapshot = { at: null, opened: false };
  const listeners = new Set<() => void>();
  const set = (next: StatsCardSnapshot) => {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    open(bagId, newestId) {
      if (snapshot.opened) return;
      set({ at: { bagId, afterId: newestId }, opened: true });
    },
    show(bagId, newestId) {
      // Already right after the newest message: it is where Stats would put it.
      if (statsCardShown(snapshot, bagId, newestId)) return;
      set({ at: { bagId, afterId: newestId }, opened: true });
    },
    hide() {
      if (snapshot.at !== null) set({ ...snapshot, at: null });
    },
  };
}

const states = new WeakMap<object, StatsCardState>();

/**
 * The card's state for one services instance (keyed by an object that lives
 * as long as it, such as the coach), so a visit to History and back keeps it.
 */
export function statsCardFor(key: object): StatsCardState {
  let state = states.get(key);
  if (!state) {
    state = createStatsCardState();
    states.set(key, state);
  }
  return state;
}
