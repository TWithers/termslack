export type Popup = {
  /** Screen column of the border's left edge. */
  left: number;
  /** Screen row of the border's top edge. */
  top: number;
  /** Screen column just past the border's right edge. */
  right: number;
  /** Screen row of the border's bottom edge. */
  bottom: number;
  /** The top border row as drawn, with the title on it, from the left corner to the right. */
  topBorder: string;
  /** The bottom border row as drawn, with the keys on it. */
  bottomBorder: string;
  /** The text inside the border, one entry per row, first row first (the title is on the border, not a row), right edge untrimmed. */
  rows: string[];
};

/**
 * Finds the bordered popup whose top border carries `title` on a rendered
 * screen, or undefined when none is drawn. Every pane has a title on its
 * border too, so when the same text is on several top borders the lowest one
 * is the popup (a popup is drawn over the panes, never above their titles).
 */
export function findPopup(screen: string, title: string): Popup | undefined {
  const lines = screen.split("\n");
  const top = lines.findLastIndex(
    (line) => line.includes(`─ ${title}`) && line.includes("╭"),
  );

  if (top < 0) {
    return undefined;
  }

  const cells = [...lines[top]!];
  const titleAt = cells.join("").indexOf(`─ ${title}`);
  const titleCell = [...cells.join("").slice(0, titleAt)].length;
  const left = cells.lastIndexOf("╭", titleCell);
  const right = cells.indexOf("╮", titleCell) + 1;

  if (left < 0 || right <= left) {
    return undefined;
  }

  const bottom = lines.findIndex(
    (line, index) => index > top && [...line][left] === "╰",
  );

  const across = (line: string | undefined) =>
    [...(line ?? "")].slice(left, right).join("");

  return {
    left,
    top,
    right,
    bottom,
    topBorder: across(lines[top]),
    bottomBorder: across(lines[bottom]),
    rows: lines
      .slice(top + 1, bottom)
      .map((line) => [...line].slice(left + 1, right - 1).join("")),
  };
}
