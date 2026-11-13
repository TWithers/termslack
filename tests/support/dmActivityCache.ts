import type { DmActivityCache, DmActivityState } from "../../src/config/state";

/** An in-memory `DmActivityCache`: `saved` is the last state the session recorded. */
export type MemoryDmActivityCache = DmActivityCache & {
  saved: DmActivityState | undefined;
  /** How many times the session recorded state. */
  saves: number;
};

export function memoryDmActivityCache(
  initial?: DmActivityState,
): MemoryDmActivityCache {
  const cache: MemoryDmActivityCache = {
    saved: initial,
    saves: 0,
    load: async () => cache.saved,
    save(state) {
      cache.saved = state;
      cache.saves += 1;
    },
    flush: async () => undefined,
  };

  return cache;
}
