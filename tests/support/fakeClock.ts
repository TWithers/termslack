import type { Clock } from "../../src/session/clock";

export type FakeClock = Clock & {
  /** Moves time forward, running the timers that come due on the way in order. */
  advance(ms: number): void;
};

/** A clock that only moves when `advance` is called. */
export function fakeClock(start = Date.UTC(2026, 10, 9, 12, 0, 0)): FakeClock {
  let current = start;
  let nextId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();

  return {
    now: () => current,
    setTimer(callback, ms) {
      const id = nextId++;

      timers.set(id, { at: current + ms, callback });

      return () => void timers.delete(id);
    },
    advance(ms) {
      const target = current + ms;

      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort(([, a], [, b]) => a.at - b.at)[0];

        if (!due) {
          break;
        }

        timers.delete(due[0]);
        current = Math.max(current, due[1].at);
        due[1].callback();
      }

      current = target;
    },
  };
}
