import type { ChangeTracker } from "./changeTracker";

/** Where one of the background startup listings has got to. */
export type ListingStatus = "loading" | "loaded" | "retrying" | "failed";

/** How the background listings that `start` kicks off are doing. */
export type ListingHealth = {
  conversations: ListingStatus;
  people: ListingStatus;
};

export const defaultListingRetryDelaysMs = [2000, 5000, 15_000, 30_000, 60_000];

export type ListingHealthTracker = {
  current(): ListingHealth;
  /** Marks every listing as loading again, for a fresh start. */
  reset(): void;
  /** Runs a listing, retrying with backoff while it fails and the session runs. Never rejects. */
  load(name: keyof ListingHealth, load: () => Promise<void>): Promise<void>;
};

export function createListingHealth({
  changes,
  retryDelaysMs,
  pause,
  isStopped,
}: {
  changes: ChangeTracker;
  retryDelaysMs: number[];
  pause: (ms: number) => Promise<void>;
  isStopped: () => boolean;
}): ListingHealthTracker {
  let health: ListingHealth = { conversations: "loading", people: "loading" };

  function setHealth(name: keyof ListingHealth, next: ListingStatus): void {
    if (health[name] === next) {
      return;
    }

    const wasQuiet = health[name] === "loading";

    health = { ...health, [name]: next };

    // Loading straight to loaded changes nothing a view shows (the listing's own data already notified).
    if (!(wasQuiet && next === "loaded")) {
      changes.changed();
    }
  }

  return {
    current: () => health,
    reset() {
      health = { conversations: "loading", people: "loading" };
    },
    async load(name, load) {
      for (let attempt = 0; ; attempt += 1) {
        try {
          await load();
          setHealth(name, "loaded");

          return;
        } catch {
          const delay = retryDelaysMs[attempt];

          if (isStopped()) {
            return;
          }

          if (delay === undefined) {
            setHealth(name, "failed");

            return;
          }

          setHealth(name, "retrying");
          await pause(delay);

          if (isStopped()) {
            return;
          }
        }
      }
    },
  };
}
