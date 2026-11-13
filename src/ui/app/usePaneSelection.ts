import { useEffect, useRef } from "react";
import type { PaneRow } from "./paneRows";
import {
  messageNear,
  type RowSpan,
  selectableTimestamps,
  spanOf,
} from "./selection";
import { scrolledBottom, topIndex } from "./scroll";
import { useMessageScroll } from "./useMessageScroll";

export type PaneSelection = {
  /** The rows in view, oldest first. `withSelection` marks the selected message in them. */
  visible: PaneRow[];
  /** The `ts` of the selected message; `undefined` while the pane has no messages. */
  selectedTs?: string;
  /** Whether messages have arrived below a view that was moved away from the newest. */
  hasNewBelow: boolean;
  /** Selects the message `delta` messages on (negative is older), clamped to the first and last. */
  moveBy(delta: number): void;
  /** Selects the message `ts` the way moving to it would, scrolling only as far as that takes. */
  select(ts: string): void;
  /** Scrolls a screen up or down and carries the selection with the view. */
  page(direction: 1 | -1): void;
  selectOldest(): void;
  selectNewest(): void;
  /**
   * Selects the message `ts` and scrolls it to the middle of the view, as
   * soon as its rows exist (they may still be loading); until then, and
   * after `reset` or `cancelFocus`, nothing changes.
   */
  focusOn(ts: string): void;
  /** Drops a `focusOn` still waiting for its message. */
  cancelFocus(): void;
  /** Back to the newest message, as when a conversation is opened. */
  reset(): void;
};

/** Rows that introduce a message (its author line, a day separator) are shown with it. */
function withLeadIn(rows: PaneRow[], span: RowSpan): RowSpan {
  let first = span.first;

  while (
    rows[first - 1]?.kind === "authorHeader" ||
    rows[first - 1]?.kind === "daySeparator"
  ) {
    first--;
  }

  return { ...span, first };
}

/**
 * A scrolling pane over `rows` with one message selected at a time, anchored
 * by `ts` so it stays on the same message while others arrive, load above or
 * change. Any pane whose rows carry a `messageTs` can use it: the message
 * pane and the thread pane both do.
 *
 * The selection is either a specific message or "the newest", which is what
 * a pane starts with and what keeps it following new messages. If the
 * selected message disappears (it was deleted) the selection moves to the
 * message after it, else the one before.
 */
export function usePaneSelection({
  rows,
  height,
  onReachTop,
}: {
  rows: PaneRow[];
  height: number;
  onReachTop(): void;
}): PaneSelection {
  const chosen = useRef<string | undefined>(undefined);
  const wanted = useRef<string | undefined>(undefined);
  const neighbours = useRef<{ previous?: string; next?: string }>({});
  const timestamps = selectableTimestamps(rows);
  const newest = timestamps.at(-1);

  /*
   * The refs are only read while rendering. A chosen message that has
   * disappeared is replaced by its neighbour here, and the effect below
   * stores the result, so event handlers (which run after it) never see the
   * stale choice. A key handled between this render and its effect has
   * already chosen again, and the effect must not overwrite that choice.
   */
  const rendered = chosen.current;
  const survivor =
    chosen.current === undefined || timestamps.includes(chosen.current)
      ? chosen.current
      : [neighbours.current.next, neighbours.current.previous].find(
          (ts) => ts !== undefined && timestamps.includes(ts),
        );
  const selectedTs = survivor ?? newest;
  const at = selectedTs === undefined ? -1 : timestamps.indexOf(selectedTs);
  const previous = timestamps[at - 1];
  const next = timestamps[at + 1];

  useEffect(() => {
    if (chosen.current !== rendered) {
      return;
    }

    chosen.current = survivor;
    neighbours.current = { previous, next };
  });

  const scroll = useMessageScroll({
    rows,
    height,
    newestTs: newest,
    onReachTop,
  });

  useEffect(() => {
    const ts = wanted.current;
    const span = ts === undefined ? undefined : spanOf(rows, ts);

    if (ts === undefined || span === undefined) {
      return;
    }

    wanted.current = undefined;

    if (ts === newest) {
      chosen.current = undefined;
      scroll.follow();
      return;
    }

    const size = span.last - span.first + 1;

    chosen.current = ts;
    scroll.scrollTo(
      span.first +
        Math.min(size, height) -
        1 +
        Math.floor(Math.max(0, height - size) / 2),
    );
  });

  function select(ts: string) {
    if (ts === newest) {
      chosen.current = undefined;
      scroll.follow();
      return;
    }

    chosen.current = ts;

    if (ts === timestamps[0]) {
      scroll.toTop();
      return;
    }

    const span = spanOf(rows, ts);

    if (span) {
      scroll.reveal(withLeadIn(rows, span));
    }
  }

  return {
    visible: scroll.visible,
    selectedTs,
    hasNewBelow: scroll.hasNewBelow,
    select,
    moveBy(delta) {
      const { top, bottom } = scroll.window;
      const span =
        selectedTs === undefined ? undefined : spanOf(rows, selectedTs);

      if (span && delta > 0 && span.last > bottom) {
        scroll.scrollTo(bottom + 1);
        return;
      }

      if (span && delta < 0 && span.first < top) {
        scroll.scrollTo(bottom - 1);
        return;
      }

      const next =
        timestamps[Math.max(0, Math.min(at + delta, timestamps.length - 1))];

      if (at >= 0 && next !== undefined) {
        select(next);
      }
    },
    page(direction) {
      const { top, bottom } = scroll.window;
      const span =
        selectedTs === undefined ? undefined : spanOf(rows, selectedTs);
      const offset = Math.max(
        0,
        Math.min((span?.first ?? bottom) - top, height - 1),
      );
      const nextBottom = scrolledBottom(
        rows,
        bottom,
        direction * scroll.pageSize,
        height,
      );
      const end = direction < 0 ? timestamps[0] : newest;

      if (nextBottom === bottom) {
        if (end !== undefined) {
          select(end);
        }

        return;
      }

      const ts = messageNear(
        rows,
        topIndex(nextBottom, height) + offset,
        direction,
      );

      if (ts === undefined) {
        return;
      }

      if (ts === newest) {
        select(ts);
        return;
      }

      chosen.current = ts;
      scroll.scrollTo(nextBottom);
    },
    selectOldest() {
      if (timestamps[0] !== undefined) {
        select(timestamps[0]);
      }
    },
    selectNewest() {
      if (newest !== undefined) {
        select(newest);
      }
    },
    focusOn(ts) {
      wanted.current = ts;
      scroll.follow();
    },
    cancelFocus() {
      wanted.current = undefined;
    },
    reset() {
      chosen.current = undefined;
      wanted.current = undefined;
      scroll.follow();
    },
  };
}
