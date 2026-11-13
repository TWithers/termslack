import type { PaneRow } from "./paneRows";

/**
 * Where a scrolled-back view sits: the row at its bottom edge. Anchoring to a
 * row, not a position, is what keeps the view still while rows are added
 * above or below it. `index` is where that row last was, to fall back on if
 * it disappears (an edit that shortens a message, a deletion).
 */
export type Anchor = { key: string; index: number; newestTs?: string };

/** The first index the bottom edge can be at: the window is never scrolled above the first row. */
function lowestBottom(rowCount: number, height: number): number {
  return Math.min(Math.max(1, height), rowCount) - 1;
}

/** Index of the row at the window's bottom edge. `undefined` anchor follows the newest row. */
export function bottomIndex(
  rows: PaneRow[],
  anchor: Anchor | undefined,
  height: number,
): number {
  const last = rows.length - 1;

  if (!anchor) {
    return last;
  }

  const found = rows.findIndex((row) => row.key === anchor.key);
  const at = found >= 0 ? found : Math.min(anchor.index, last);

  return Math.max(lowestBottom(rows.length, height), Math.min(at, last));
}

/** The rows in the window whose bottom edge is at `bottom`. */
export function windowRows(
  rows: PaneRow[],
  bottom: number,
  height: number,
): PaneRow[] {
  return rows.slice(Math.max(0, bottom - Math.max(0, height) + 1), bottom + 1);
}

/** Index of the window's first row. */
export function topIndex(bottom: number, height: number): number {
  return Math.max(0, bottom - Math.max(1, height) + 1);
}

/** Where the bottom edge goes when scrolling by `delta` rows (negative is up), as an index clamped to the rows. */
export function scrolledBottom(
  rows: PaneRow[],
  bottom: number,
  delta: number,
  height: number,
): number {
  return Math.max(
    lowestBottom(rows.length, height),
    Math.min(bottom + delta, rows.length - 1),
  );
}

/** The anchor for a view whose bottom edge is row `bottom`, or `undefined` (follow the newest) when there is no such row. */
export function anchorAt(
  rows: PaneRow[],
  bottom: number,
  newestTs?: string,
): Anchor | undefined {
  const row = rows[bottom];

  if (!row) {
    return undefined;
  }

  return { key: row.key, index: bottom, newestTs };
}
