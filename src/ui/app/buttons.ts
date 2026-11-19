import type { SpanAction } from "../../session/content";
import { cellWidth } from "../terminalSafeText";
import { theme } from "../theme";
import type { PaneRow } from "./paneRows";
import type { Run } from "./wrap";

/** An interactive element's label on a pane row: the column it starts at (from the row's left) and what clicking it does. */
export type RowButton = { start: number; action: SpanAction };

/** The label of a pane row the pointer is over: the row's `key` and the column the label starts at. */
export type HoveredButton = { key: string; start: number };

type Stretch = RowButton & { end: number; runs: number[] };

/** A row's labels, each the run indexes it is drawn with: runs side by side with the same action, split by any run without one. */
function stretches(runs: Run[]): Stretch[] {
  const found: Stretch[] = [];
  let column = 0;

  runs.forEach((run, index) => {
    const width = cellWidth(run.text);
    const last = found.at(-1);

    if (run.action && last?.action === run.action && last.end === column) {
      last.end += width;
      last.runs.push(index);
    } else if (run.action) {
      found.push({
        start: column,
        end: column + width,
        action: run.action,
        runs: [index],
      });
    }

    column += width;
  });

  return found;
}

/** The label drawn under `column` of `row` (counted from the row's first cell), if there is one. */
export function buttonAt(row: PaneRow, column: number): RowButton | undefined {
  const stretch = stretches(row.runs).find(
    ({ start, end }) => column >= start && column < end,
  );

  return stretch && { start: stretch.start, action: stretch.action };
}

/** `rows` with the hovered label drawn in the hover background; other rows are returned as they are. */
export function withHoveredButton(
  rows: PaneRow[],
  hovered: HoveredButton | undefined,
): PaneRow[] {
  if (hovered === undefined) {
    return rows;
  }

  return rows.map((row): PaneRow => {
    if (row.key !== hovered.key) {
      return row;
    }

    const stretch = stretches(row.runs).find(
      ({ start }) => start === hovered.start,
    );

    if (!stretch) {
      return row;
    }

    return {
      ...row,
      runs: row.runs.map((run, index) =>
        stretch.runs.includes(index)
          ? { ...run, backgroundColor: theme.buttonHoverBackground }
          : run,
      ),
    };
  });
}
