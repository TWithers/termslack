export type Popup = {
  /** Screen column of the border's left edge. */
  left: number;
  /** Screen row of the border's top edge. */
  top: number;
  /** Screen column just past the border's right edge. */
  right: number;
  /** Screen row of the border's bottom edge. */
  bottom: number;
  /** The text inside the border, one entry per row, title row first, right edge untrimmed. */
  rows: string[];
};

/** Finds the bordered popup whose title row contains `title` on a rendered screen, or undefined when none is drawn. */
export function findPopup(screen: string, title: string): Popup | undefined {
  const lines = screen.split("\n");
  const titleRow = lines.findIndex((line) => line.includes(title));
  const top = titleRow - 1;

  if (top < 0) {
    return undefined;
  }

  const left = [...lines[top]!].indexOf("╭");
  const right = [...lines[top]!].indexOf("╮") + 1;

  if (left < 0 || right <= left) {
    return undefined;
  }

  const bottom = lines.findIndex(
    (line, index) => index > top && [...line][left] === "╰",
  );

  return {
    left,
    top,
    right,
    bottom,
    rows: lines
      .slice(top + 1, bottom)
      .map((line) => [...line].slice(left + 1, right - 1).join("")),
  };
}
