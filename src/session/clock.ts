/** Time as the session sees it, so tests can run it by hand. */
export type Clock = {
  /** Milliseconds since the epoch. */
  now(): number;
  /** Calls `callback` once after `ms`. Returns a function that cancels it. */
  setTimer(callback: () => void, ms: number): () => void;
};

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimer(callback, ms) {
    const timer = setTimeout(callback, ms);

    return () => clearTimeout(timer);
  },
};
