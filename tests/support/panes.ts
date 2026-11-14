/**
 * The sidebar's rows from a screen: the lines between its top and bottom
 * border, without the side borders. `width` is the sidebar's whole width
 * (border included). Row `n` is on screen row `n + 1`.
 */
export function sidebarRows(screen: string, width = 32): string[] {
  const lines = screen.split("\n");
  const bottom = lines.findIndex((line) => line.startsWith("╰"));

  return lines
    .slice(1, bottom < 0 ? undefined : bottom)
    .map((line) => line.slice(1, width - 1));
}

/**
 * A pane's input lines from a screen: the rows under its divider (`├───┤`)
 * down to its bottom border, without the side borders and padding. `from` and
 * `to` are the pane's screen columns (the message pane starts at the sidebar's
 * width, 32); the lowest divider in that range is used.
 */
export function paneInputLines(
  screen: string,
  from = 32,
  to?: number,
): string[] {
  const lines = screen.split("\n").map((line) => line.slice(from, to));
  const divider = lines.findLastIndex((line) => line.startsWith("├"));
  const bottom = lines.findLastIndex((line) => line.startsWith("╰"));

  if (divider < 0) {
    return [];
  }

  return lines
    .slice(divider + 1, bottom < 0 ? undefined : bottom)
    .map((line) => line.replace(/\s*│$/, "").replace(/^│ ?/, "").trimEnd());
}

/** The screen row of a pane's divider, or -1: the lowest row that starts with `├` in the pane's columns. */
export function dividerRow(screen: string, from = 32, to?: number): number {
  return screen
    .split("\n")
    .findLastIndex((line) => line.slice(from, to).startsWith("├"));
}

/**
 * The status line from a screen: the message pane's bottom border, the lowest
 * row that starts with `╰` in the pane's columns (the message pane starts at
 * the sidebar's width, 32). Pass `to` to stop before the thread pane when it
 * is open.
 */
export function statusLine(screen: string, from = 32, to?: number): string {
  const line = screen
    .split("\n")
    .map((row) => row.slice(from, to))
    .findLast((row) => row.startsWith("╰"));

  return line ?? "";
}

/** The sidebar's bottom border: the connection, the unread check and "muted hidden". */
export function sidebarStatus(screen: string, width = 32): string {
  return statusLine(screen, 0, width);
}
