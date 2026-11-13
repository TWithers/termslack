import type { Key } from "ink";
import { pressed } from "./shortcuts";
import type { PaneSelection } from "./usePaneSelection";

/**
 * Moves a pane's selection for the keys every message list shares (the
 * message pane and the thread pane): j/k and arrows by message, PgUp/PgDn by
 * page, g/G to the oldest and newest. Returns whether the key was one of them.
 */
export function handleSelectionKey(
  group: "messages" | "thread",
  selection: PaneSelection,
  input: string,
  key: Key,
): boolean {
  if (pressed(`${group}.down`, input, key)) {
    selection.moveBy(1);
    return true;
  }

  if (pressed(`${group}.up`, input, key)) {
    selection.moveBy(-1);
    return true;
  }

  if (pressed(`${group}.pageUp`, input, key)) {
    selection.page(-1);
    return true;
  }

  if (pressed(`${group}.pageDown`, input, key)) {
    selection.page(1);
    return true;
  }

  if (pressed(`${group}.oldest`, input, key)) {
    selection.selectOldest();
    return true;
  }

  if (pressed(`${group}.newest`, input, key)) {
    selection.selectNewest();
    return true;
  }

  return false;
}
