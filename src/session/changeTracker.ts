export type ChangeTracker = {
  /** Counts changes. Unchanged between changes, different after any change. */
  version(): number;
  /** Records a change and schedules one coalesced notification. */
  changed(): void;
  /** Calls `listener` (no arguments) after changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
};

/**
 * Counts changes and tells listeners about them. The version bumps at once on
 * every change, so reading it is always accurate. Listeners are called once
 * per microtask however many changes happened in it, so a loop over a whole
 * page of records is one notification. Shaped for React's `useSyncExternalStore`.
 */
export function createChangeTracker(): ChangeTracker {
  const listeners = new Set<() => void>();
  let version = 0;
  let scheduled = false;

  function notify(): void {
    scheduled = false;

    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        // One broken view mustn't stop the others; surface it without unwinding the loop.
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }

  return {
    version: () => version,
    changed() {
      version += 1;

      if (!scheduled) {
        scheduled = true;
        queueMicrotask(notify);
      }
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}
