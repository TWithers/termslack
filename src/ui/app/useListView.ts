import { useState } from "react";
import { handleInputKey } from "../input/inputKeys";
import type { InputState } from "../input/textInput";
import { type KeyPress, pressed, type ShortcutId } from "./shortcuts";

export type ListView = {
  /** The highlighted item (meaningful when the list is selectable). */
  selected: number;
  /** The first item shown. */
  start: number;
  /** Moves by `delta` items, stopping at either end. */
  move(delta: number): void;
  /** Moves by a page. */
  page(direction: 1 | -1): void;
  toStart(): void;
  toEnd(): void;
  /** Back to the top, or with the item at `selected` highlighted (and in view). */
  reset(selected?: number): void;
};

/**
 * Where a list of `count` items taller than `height` rows is showing. A
 * selectable list moves a highlight and scrolls to keep it in view; one that
 * isn't selectable (the help screen) just scrolls. A shrinking list or a
 * taller window keep both within range.
 */
export function useListView({
  count,
  height,
  selectable,
  onHighlight,
}: {
  count: number;
  height: number;
  selectable: boolean;
  /** Called with the new highlighted index as a move sets it, before the render that shows it. */
  onHighlight?(index: number): void;
}): ListView {
  const [position, setPosition] = useState({ selected: 0, start: 0 });
  const rowsShown = Math.max(1, height);
  const last = Math.max(0, count - 1);
  const highestStart = Math.max(0, count - rowsShown);
  const selected = Math.min(position.selected, last);
  const start = Math.min(position.start, highestStart);

  function moveTo(index: number) {
    if (!selectable) {
      setPosition({
        selected: 0,
        start: Math.max(0, Math.min(highestStart, index)),
      });
      return;
    }

    const next = Math.max(0, Math.min(last, index));
    const nextStart =
      next < start
        ? next
        : next >= start + rowsShown
          ? next - rowsShown + 1
          : start;

    onHighlight?.(next);
    setPosition({ selected: next, start: nextStart });
  }

  const here = selectable ? selected : start;

  return {
    selected,
    start,
    move: (delta) => moveTo(here + delta),
    page: (direction) => moveTo(here + direction * rowsShown),
    toStart: () => moveTo(0),
    toEnd: () => moveTo(selectable ? last : highestStart),
    reset: (index = 0) => {
      const next = Math.max(0, index);

      setPosition({
        selected: next,
        start: next >= rowsShown ? next - rowsShown + 1 : 0,
      });
    },
  };
}

/**
 * Moves the list for the table's `list.*` keys and returns whether the key
 * was one. `letters: false` leaves `j`/`k`/`g`/`G` alone for a filter line.
 */
export function handleListKey(
  view: ListView,
  input: string,
  key: KeyPress,
  options: { letters?: boolean } = {},
): boolean {
  const is = (id: ShortcutId) => pressed(id, input, key, options);

  if (is("list.down")) {
    view.move(1);
  } else if (is("list.up")) {
    view.move(-1);
  } else if (is("list.pageUp")) {
    view.page(-1);
  } else if (is("list.pageDown")) {
    view.page(1);
  } else if (is("list.top")) {
    view.toStart();
  } else if (is("list.bottom")) {
    view.toEnd();
  } else {
    return false;
  }

  return true;
}

/**
 * The keys an overlay with a filter line over a list shares: `next` and
 * `previous` (and the `list.*` keys, without letters) move the highlight, and
 * any other key edits the filter. Returns the filter's new state when the key
 * edited it (one line only), for the caller to apply, else undefined.
 */
export function handleFilteredListKey(
  view: ListView,
  filter: InputState,
  input: string,
  key: KeyPress,
  { next, previous }: { next: ShortcutId; previous: ShortcutId },
): InputState | undefined {
  if (pressed(next, input, key)) {
    view.move(1);
    return undefined;
  }

  if (pressed(previous, input, key)) {
    view.move(-1);
    return undefined;
  }

  if (handleListKey(view, input, key, { letters: false })) {
    return undefined;
  }

  const action = handleInputKey(filter, input, key);

  return action.kind === "edit" && !action.state.text.includes("\n")
    ? action.state
    : undefined;
}
