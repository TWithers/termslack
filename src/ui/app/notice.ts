import { useSyncExternalStore } from "react";

/** A note the status line shows once it is set. */
export type Notice = {
  current(): string | undefined;
  subscribe(listener: () => void): () => void;
};

/** A notice and the way to set it; only the first note counts. */
export function createNotice(): Notice & { set(note: string): void } {
  let note: string | undefined;
  const listeners = new Set<() => void>();

  return {
    current: () => note,
    subscribe(listener) {
      listeners.add(listener);

      return () => void listeners.delete(listener);
    },
    set(next) {
      if (note !== undefined) {
        return;
      }

      note = next;
      listeners.forEach((listener) => listener());
    },
  };
}

const noNotice: Notice = {
  current: () => undefined,
  subscribe: () => () => {},
};

export function useNotice(notice: Notice = noNotice): string | undefined {
  return useSyncExternalStore(notice.subscribe, notice.current);
}
