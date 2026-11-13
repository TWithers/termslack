import { useRef } from "react";
import {
  firstSelectable,
  headingIdOf,
  resolveSelection,
  type SidebarSelection,
} from "./sidebarEntries";
import { useForceRender } from "./useForceRender";

/**
 * The selected sidebar row. It lives in a ref, so it can be reconciled
 * against the selectable `ids` of every render as it happens; `select`
 * forces the render that shows a change.
 */
export function useSidebarSelection(ids: string[]): {
  selectedId: string | undefined;
  select(id: string | undefined): void;
  /** Moves the selection `delta` rows (negative is up) among the selectable rows, stopping at either end. */
  moveBy(delta: number): void;
} {
  const selection = useRef<SidebarSelection>({ ids: [], initial: true });
  const redraw = useForceRender();

  const resolvedId = resolveSelection(
    selection.current.id,
    selection.current.ids,
    ids,
  );
  const selectedId =
    selection.current.initial && headingIdOf(resolvedId) !== undefined
      ? firstSelectable(ids)
      : resolvedId;

  selection.current = {
    id: selectedId,
    ids,
    initial: selection.current.initial && headingIdOf(selectedId) !== undefined,
  };

  function select(id: string | undefined) {
    selection.current = { ...selection.current, id, initial: false };
    redraw();
  }

  return {
    selectedId,
    select,
    moveBy(delta) {
      const index = selectedId === undefined ? -1 : ids.indexOf(selectedId);

      select(ids[Math.max(0, Math.min(index + delta, ids.length - 1))]);
    },
  };
}
