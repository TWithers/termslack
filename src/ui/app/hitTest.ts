import { borderSize, type PaneWidths, paneInnerHeight } from "./paneLayout";

export type Rect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

/** The popups that can be drawn over the panes. */
export type PopupKind =
  | "help"
  | "switcher"
  | "themePicker"
  | "channelMenu"
  | "channelDetails"
  | "search"
  | "reaction"
  | "sectionName";

/** A popup as drawn, and the rectangle it covers (border included). */
export type PopupRegion = { kind: PopupKind; frame: Rect };

/**
 * Where everything is on the screen, in the numbers the app lays it out
 * with. Columns and rows count from 0 at the top left.
 */
export type MouseLayout = {
  columns: number;
  rows: number;
  sidebarWidth: number;
  /** Rows above the status bar: the sidebar's and the panes' boxes, borders included. */
  bodyHeight: number;
  /** The panes beside the sidebar: the message pane first when it is drawn, then the thread pane. */
  panes: PaneWidths;
  /** Whether a conversation is open, so the message pane is drawn (unless a thread covers it, see `panes`). */
  hasConversation: boolean;
  hasThread: boolean;
  /** Rows under the message pane's list that belong to the input: the completion list, any notice, the divider and the input lines; they sit inside the pane's border. */
  messageInputHeight: number;
  threadInputHeight: number;
  /** The open popup, drawn over everything. */
  popup?: PopupRegion;
};

/** What is under a point, with the point relative to that thing's top left. */
export type Hit =
  | { area: "none" }
  | { area: "statusBar"; column: number }
  | {
      /**
       * The sidebar: `row` counts from its first line inside the border (0;
       * -1 on the top border). A list pane: `row` counts from the first row
       * of its list inside the border, so the pane's own row layout maps it
       * to a message (-1 on the top border). An input: from its first row, the
       * completion list or notice if drawn, else the divider (past its last row on the bottom border). `column` counts from the
       * box's left edge, border included.
       */
      area: "sidebar" | "messages" | "thread" | "input" | "threadInput";
      column: number;
      row: number;
    }
  | {
      /** A popup, with the point relative to its top left corner; its list rows are worked out from that. */
      area: "popup";
      popup: PopupKind;
      column: number;
      row: number;
    };

function contains(
  { top, left, width, height }: Rect,
  column: number,
  row: number,
) {
  return (
    column >= left && column < left + width && row >= top && row < top + height
  );
}

/**
 * One pane's box: its border, its list on top, its input under it. The top
 * border belongs to the list (as row -1) and the bottom border to the input,
 * which starts at its completion list, notice or divider row (the divider
 * counts as the input).
 */
function hitPane(
  list: "messages" | "thread",
  input: "input" | "threadInput",
  left: number,
  width: number,
  inputHeight: number,
  bodyHeight: number,
  column: number,
  row: number,
): Hit {
  if (column < left || column >= left + width || row >= bodyHeight) {
    return { area: "none" };
  }

  const listHeight = Math.max(0, paneInnerHeight(bodyHeight) - inputHeight);
  const listRow = row - borderSize;

  return listRow < listHeight
    ? { area: list, column: column - left, row: listRow }
    : { area: input, column: column - left, row: listRow - listHeight };
}

/**
 * What is at `column`, `row`: a popup first, since it is drawn over
 * everything, then the status bar, the sidebar, and the panes with their
 * input boxes. The space where a pane would be with no conversation open,
 * and anywhere off the screen, is nothing.
 */
export function hitTest(layout: MouseLayout, column: number, row: number): Hit {
  const { columns, rows, bodyHeight, popup } = layout;

  if (column < 0 || row < 0 || column >= columns || row >= rows) {
    return { area: "none" };
  }

  if (popup && contains(popup.frame, column, row)) {
    return {
      area: "popup",
      popup: popup.kind,
      column: column - popup.frame.left,
      row: row - popup.frame.top,
    };
  }

  if (row === rows - 1) {
    return { area: "statusBar", column };
  }

  if (row >= bodyHeight) {
    return { area: "none" };
  }

  if (column < layout.sidebarWidth) {
    return { area: "sidebar", column, row: row - borderSize };
  }

  const { panes } = layout;
  let left = layout.sidebarWidth;

  if (layout.hasConversation && panes.showMessages) {
    const hit = hitPane(
      "messages",
      "input",
      left,
      panes.message,
      layout.messageInputHeight,
      bodyHeight,
      column,
      row,
    );

    if (hit.area !== "none") {
      return hit;
    }

    left += panes.message;
  }

  if (layout.hasThread) {
    return hitPane(
      "thread",
      "threadInput",
      left,
      panes.thread,
      layout.threadInputHeight,
      bodyHeight,
      column,
      row,
    );
  }

  return { area: "none" };
}
