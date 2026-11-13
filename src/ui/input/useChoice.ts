import { useState } from "react";

/**
 * A highlighted choice in a list of `count` entries. `key` says what the
 * list is for (the text it matches, say): the highlight returns to the first
 * entry whenever it changes, and stays within the list when the list shrinks.
 */
export function useChoice(
  key: string,
  count: number,
): {
  selected: number;
  /** Moves the highlight by `delta`, stopping at either end. */
  move(delta: number): void;
  /** Forgets the highlight, so the first entry is chosen. */
  reset(): void;
} {
  const [choice, setChoice] = useState<{ key: string; index: number }>();
  const selected =
    choice?.key === key ? Math.min(choice.index, Math.max(0, count - 1)) : 0;

  return {
    selected,
    move(delta) {
      setChoice({
        key,
        index: Math.max(0, Math.min(count - 1, selected + delta)),
      });
    },
    reset() {
      setChoice(undefined);
    },
  };
}
