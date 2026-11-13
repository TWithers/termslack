import type { DmActivityCache, DmActivityState } from "../config/state";
import type { ChangeTracker } from "./changeTracker";
import { compareTs } from "./workspaceStore";

/** When each DM and group DM last had a message, and which DMs to hide. */
export type DmActivity = {
  /**
   * When the DM last had a message (ms since the epoch): the newest message
   * seen or remembered, else the listing's `updated`, else undefined.
   */
  activity(id: string): number | undefined;
  /** The newest message `ts` seen or remembered for the DM, if any. */
  latestTs(id: string): string | undefined;
  /** Whether Slack refused the DM's history, so the sidebar leaves it out. */
  isHidden(id: string): boolean;
  /** The DMs that are hidden. */
  hiddenIds(): string[];
  /** Notes a message in a DM; a DM that was hidden is shown again. */
  observe(id: string, ts: string): void;
  hide(id: string): void;
  lastRun(): string | undefined;
  setLastRun(day: string): void;
  /** Merges what an earlier run saved; anything seen since is kept. */
  restore(state: DmActivityState | undefined): void;
  flush(): Promise<void>;
};

export function createDmActivity({
  changes,
  updated,
  cache,
}: {
  changes: ChangeTracker;
  /** The listing's `updated` for a conversation, as the instant fallback. */
  updated: (id: string) => number | undefined;
  cache?: DmActivityCache;
}): DmActivity {
  const latest = new Map<string, string>();
  const hidden = new Set<string>();
  let lastRun: string | undefined;

  function changed(): void {
    changes.changed();
    cache?.save({
      latest: Object.fromEntries(latest),
      hidden: [...hidden],
      lastRun,
    });
  }

  function remember(id: string, ts: string): boolean {
    const known = latest.get(id);

    if (known !== undefined && compareTs(known, ts) >= 0) {
      return false;
    }

    latest.set(id, ts);

    return true;
  }

  return {
    activity(id) {
      const ts = latest.get(id);

      return ts === undefined ? updated(id) : Number(ts) * 1000;
    },
    latestTs: (id) => latest.get(id),
    isHidden: (id) => hidden.has(id),
    hiddenIds: () => [...hidden],
    observe(id, ts) {
      const wasHidden = hidden.delete(id);

      if (remember(id, ts) || wasHidden) {
        changed();
      }
    },
    hide(id) {
      if (!hidden.has(id)) {
        hidden.add(id);
        changed();
      }
    },
    lastRun: () => lastRun,
    setLastRun(day) {
      if (lastRun !== day) {
        lastRun = day;
        changed();
      }
    },
    restore(state) {
      if (!state) {
        return;
      }

      for (const [id, ts] of Object.entries(state.latest)) {
        remember(id, ts);
      }

      for (const id of state.hidden) {
        if (!latest.has(id)) {
          hidden.add(id);
        }
      }

      lastRun ??= state.lastRun;
      changes.changed();
    },
    flush: async () => cache?.flush(),
  };
}
