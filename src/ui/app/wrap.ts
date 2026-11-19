import type { SpanAction } from "../../session/content";
import { terminalSafeText } from "../terminalSafeText";

/** A stretch of text drawn in one style. */
export type Run = {
  text: string;
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  underline?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  /** The address the text is a terminal hyperlink to (see `hyperlink`). */
  url?: string;
  /** What clicking the text does: it is an interactive element's label (`[View task]`). */
  action?: SpanAction;
};

type Cell = { grapheme: string; width: number; style: Omit<Run, "text"> };

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function sameStyle(a: Omit<Run, "text">, b: Omit<Run, "text">): boolean {
  return (
    a.color === b.color &&
    a.backgroundColor === b.backgroundColor &&
    a.bold === b.bold &&
    a.underline === b.underline &&
    a.italic === b.italic &&
    a.strikethrough === b.strikethrough &&
    a.url === b.url &&
    a.action === b.action
  );
}

function toRuns(cells: Cell[]): Run[] {
  const runs: Run[] = [];

  for (const { grapheme, style } of cells) {
    const last = runs.at(-1);

    if (last && sameStyle(last, style)) {
      last.text += grapheme;
    } else {
      runs.push({ ...style, text: grapheme });
    }
  }

  return runs;
}

function trimEnd(cells: Cell[]): Cell[] {
  let end = cells.length;

  while (end > 0 && cells[end - 1]!.grapheme === " ") {
    end--;
  }

  return cells.slice(0, end);
}

const widthOf = (cells: Cell[]) =>
  cells.reduce((total, cell) => total + cell.width, 0);

/**
 * Breaks styled text into terminal lines of at most `width` cells (wide
 * characters and emoji count as the cells they take). Lines break at spaces
 * where they can and inside a word where they can't; `\n` starts a new line.
 * Always returns at least one line.
 */
export function wrapRuns(runs: Run[], width: number): Run[][] {
  const limit = Math.max(1, width);
  const lines: Cell[][] = [];
  let current: Cell[] = [];
  let currentWidth = 0;
  let lastSpace = -1;

  const finish = () => {
    lines.push(trimEnd(current));
    current = [];
    currentWidth = 0;
    lastSpace = -1;
  };

  for (const { text, ...style } of runs) {
    for (const { segment } of segmenter.segment(terminalSafeText(text))) {
      if (segment === "\n" || segment === "\r\n") {
        finish();
        continue;
      }

      const grapheme = segment === "\t" || segment === "\r" ? " " : segment;
      const cell: Cell = {
        grapheme,
        width: Bun.stringWidth(grapheme),
        style,
      };

      while (current.length > 0 && currentWidth + cell.width > limit) {
        if (grapheme === " ") {
          break;
        }

        if (lastSpace < 0) {
          finish();
          break;
        }

        const carried = current.slice(lastSpace + 1);

        lines.push(trimEnd(current.slice(0, lastSpace)));
        current = carried;
        currentWidth = widthOf(carried);
        lastSpace = -1;
      }

      if (grapheme === " " && currentWidth + cell.width > limit) {
        finish();
        continue;
      }

      if (grapheme === " " && current.length === 0 && lines.length > 0) {
        continue;
      }

      current.push(cell);
      currentWidth += cell.width;

      if (grapheme === " ") {
        lastSpace = current.length - 1;
      }
    }
  }

  finish();

  return lines.map(toRuns);
}

/**
 * Breaks preformatted text into lines of at most `width` cells: only `\n`
 * and the width end a line, and spaces are kept as typed. Always returns at
 * least one line.
 */
export function wrapPreformatted(runs: Run[], width: number): Run[][] {
  const limit = Math.max(1, width);
  const lines: Cell[][] = [];
  let current: Cell[] = [];
  let currentWidth = 0;

  for (const { text, ...style } of runs) {
    for (const { segment } of segmenter.segment(terminalSafeText(text))) {
      if (segment === "\n" || segment === "\r\n") {
        lines.push(current);
        current = [];
        currentWidth = 0;
        continue;
      }

      const grapheme = segment === "\t" ? "  " : segment;
      const cellWidth = Bun.stringWidth(grapheme);

      if (current.length > 0 && currentWidth + cellWidth > limit) {
        lines.push(current);
        current = [];
        currentWidth = 0;
      }

      current.push({ grapheme, width: cellWidth, style });
      currentWidth += cellWidth;
    }
  }

  lines.push(current);

  return lines.map((line) => toRuns(trimEnd(line)));
}
