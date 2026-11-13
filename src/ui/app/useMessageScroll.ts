import { useRef, useState } from "react";
import { compareTs } from "../../session/workspaceStore";
import type { PaneRow } from "./paneRows";
import {
  type Anchor,
  anchorAt,
  bottomIndex,
  scrolledBottom,
  topIndex,
  windowRows,
} from "./scroll";
import type { RowSpan } from "./selection";

export type MessageScroll = {
  /** The rows in view, oldest first. */
  visible: PaneRow[];
  /** Whether messages have arrived below a view that was scrolled away from the newest. */
  hasNewBelow: boolean;
  /** Rows in a screenful, less one so a page keeps a line of context. */
  pageSize: number;
  /** Indices of the first and last row in view. */
  window: { top: number; bottom: number };
  /** Puts the row at index `bottom` (clamped) at the view's bottom edge and holds the view there. */
  scrollTo(bottom: number): void;
  /** Scrolls the least that brings `span` into view; a span taller than the view shows its start. */
  reveal(span: RowSpan): void;
  /** Scrolls to the first row, which loads older history. */
  toTop(): void;
  /** Back to following the newest row, as when a conversation is opened. */
  follow(): void;
};

/**
 * Scroll state for the message pane over `rows` in a window of `height`
 * lines. The view either follows the newest row or is anchored to the row at
 * its bottom edge, so rows arriving above or below don't move it. Scrolling
 * up to the first row calls `onReachTop` (which loads older history).
 * Callers decide where to scroll; this only holds the view still afterwards.
 */
export function useMessageScroll({
  rows,
  height,
  newestTs,
  onReachTop,
}: {
  rows: PaneRow[];
  height: number;
  newestTs?: string;
  onReachTop(): void;
}): MessageScroll {
  const anchor = useRef<Anchor | undefined>(undefined);
  const [, forceRedraw] = useState(0);
  const bottom = bottomIndex(rows, anchor.current, height);
  const top = topIndex(bottom, height);

  function scrollTo(target: number) {
    const next = scrolledBottom(rows, target, 0, height);

    anchor.current = anchorAt(rows, next, anchor.current?.newestTs ?? newestTs);
    forceRedraw((count) => count + 1);

    if (topIndex(next, height) === 0) {
      onReachTop();
    }
  }

  return {
    visible: windowRows(rows, bottom, height),
    hasNewBelow:
      anchor.current?.newestTs !== undefined &&
      newestTs !== undefined &&
      compareTs(newestTs, anchor.current.newestTs) > 0,
    pageSize: Math.max(1, height - 1),
    window: { top, bottom },
    scrollTo,
    reveal(span) {
      if (span.last > bottom) {
        scrollTo(Math.min(span.last, span.first + height - 1));
        return;
      }

      scrollTo(span.first < top ? span.first + height - 1 : bottom);
    },
    toTop: () => scrollTo(0),
    follow() {
      anchor.current = undefined;
      forceRedraw((count) => count + 1);
    },
  };
}
