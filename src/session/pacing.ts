export type Pauser = {
  /** Waits `ms`, or less if `wakeAll` is called. */
  pause(ms: number): Promise<void>;
  /** Ends every wait in progress, so work paused between calls can notice the session stopped. */
  wakeAll(): void;
};

/** Pauses that can be cut short, so stopping the session doesn't wait out the delays. */
export function createPauser(): Pauser {
  const waits = new Set<{ timer: Timer; wake: () => void }>();

  return {
    pause: (ms) =>
      new Promise((resolve) => {
        const entry = {
          timer: setTimeout(() => {
            waits.delete(entry);
            resolve();
          }, ms),
          wake: () => {
            clearTimeout(entry.timer);
            waits.delete(entry);
            resolve();
          },
        };

        waits.add(entry);
      }),
    wakeAll() {
      for (const { wake } of [...waits]) {
        wake();
      }
    },
  };
}
