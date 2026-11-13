import { theme } from "../theme";
import type { PaneRow } from "./paneRows";
import type { Run } from "./wrap";

/** The first and last row index of one message's rows. */
export type RowSpan = { first: number; last: number };

/** The `ts` of every selectable message in `rows`, oldest first. */
export function selectableTimestamps(rows: PaneRow[]): string[] {
  const seen: string[] = [];

  for (const row of rows) {
    if (row.messageTs !== undefined && seen.at(-1) !== row.messageTs) {
      seen.push(row.messageTs);
    }
  }

  return seen;
}

/** Where the rows belonging to the message `ts` start and end, if it is in `rows`. */
export function spanOf(rows: PaneRow[], ts: string): RowSpan | undefined {
  const first = rows.findIndex((row) => row.messageTs === ts);

  if (first < 0) {
    return undefined;
  }

  let last = first;

  while (rows[last + 1]?.messageTs === ts) {
    last++;
  }

  return { first, last };
}

/**
 * The message owning the row nearest `index`, looking towards `direction`
 * first so a row that belongs to no message (a day separator) hands the
 * selection to the next message that way.
 */
export function messageNear(
  rows: PaneRow[],
  index: number,
  direction: 1 | -1,
): string | undefined {
  const start = Math.max(0, Math.min(index, rows.length - 1));

  for (let offset = 0; offset < rows.length; offset++) {
    for (const at of [start + offset * direction, start - offset * direction]) {
      const ts = rows[at]?.messageTs;

      if (ts !== undefined) {
        return ts;
      }
    }
  }

  return undefined;
}

/**
 * The row of a pane's list drawn `row` lines down from its first line (0),
 * given the `visible` rows and the list's height `listHeight`. Rows are drawn
 * from the bottom up, so a short list leaves its blank lines on top.
 * `undefined` for a blank line or anywhere past the list.
 */
export function visibleRowAt(
  visible: PaneRow[],
  listHeight: number,
  row: number,
): PaneRow | undefined {
  const blank = Math.max(0, listHeight - visible.length);

  return row < 0 ? undefined : visible[row - blank];
}

const barText = "▌";

/**
 * `rows` with the rows of message `ts` marked by a bar in the left gutter,
 * drawn over the first character of the row's indent (every row of a message
 * starts with indent). Other rows are returned as they are.
 */
export function withSelection(rows: PaneRow[], ts?: string): PaneRow[] {
  if (ts === undefined) {
    return rows;
  }

  return rows.map((row): PaneRow => {
    const [lead, ...rest] = row.runs;

    if (row.messageTs !== ts || !lead) {
      return row;
    }

    const bar: Run = {
      text: barText,
      color: theme.selectedMessageBar,
      bold: true,
    };

    return {
      ...row,
      runs: [
        bar,
        ...(lead.text.length > 1
          ? [{ ...lead, text: lead.text.slice(1) }]
          : []),
        ...rest,
      ],
    };
  });
}
