import { expect, test } from "bun:test";
import type { PaneRow } from "../src/ui/app/paneRows";
import { bottomIndex, windowRows } from "../src/ui/app/scroll";
import { visibleRowAt } from "../src/ui/app/selection";

function row(key: string, kind: PaneRow["kind"], messageTs?: string): PaneRow {
  return { key, kind, messageTs, runs: [{ text: key }] };
}

/*
 * A conversation as the pane lays it out: a separator, a wrapped message with
 * an attachment and reactions, a message with replies, a notice.
 */
const rows: PaneRow[] = [
  row("day:a", "daySeparator"),
  row("hdr:1", "authorHeader", "1"),
  row("1", "message", "1"),
  row("1:1", "message", "1"),
  row("att:1", "message", "1"),
  row("react:1", "reactions", "1"),
  row("day:b", "daySeparator"),
  row("2", "message", "2"),
  row("replies:2", "replyCount", "2"),
  row("notice:x", "notice"),
];

/** What is at each row of a pane `listHeight` tall (title included) showing the window ending at `anchor`. */
function at(listHeight: number, anchor: string | undefined, line: number) {
  const height = listHeight - 1;
  const bottom = bottomIndex(
    rows,
    anchor === undefined
      ? undefined
      : { key: anchor, index: rows.findIndex((r) => r.key === anchor) },
    height,
  );

  return visibleRowAt(windowRows(rows, bottom, height), listHeight, line)?.key;
}

test("the title row is no message", () => {
  expect(at(6, undefined, 0)).toBeUndefined();
});

test("a pane full of rows maps each line to the row drawn there", () => {
  expect([1, 2, 3, 4, 5].map((line) => at(6, undefined, line))).toEqual([
    "react:1",
    "day:b",
    "2",
    "replies:2",
    "notice:x",
  ]);
});

test("a short list is drawn from the bottom, leaving blank lines on top", () => {
  const short = rows.slice(-2);
  const listHeight = 6;

  expect(visibleRowAt(short, listHeight, 1)).toBeUndefined();
  expect(visibleRowAt(short, listHeight, 3)).toBeUndefined();
  expect(visibleRowAt(short, listHeight, 4)?.key).toBe("replies:2");
  expect(visibleRowAt(short, listHeight, 5)?.key).toBe("notice:x");
});

test("past the last line of the pane is nothing", () => {
  expect(visibleRowAt(rows.slice(-2), 6, 6)).toBeUndefined();
  expect(visibleRowAt(rows.slice(-2), 6, -1)).toBeUndefined();
});

test("a scrolled pane maps lines to the rows of its own window", () => {
  expect([1, 2, 3, 4, 5].map((line) => at(6, "react:1", line))).toEqual([
    "hdr:1",
    "1",
    "1:1",
    "att:1",
    "react:1",
  ]);
});

test("wrapped, attachment, reaction and reply rows belong to their message; separators and notices to none", () => {
  const owner = (line: number) =>
    rows.find((r) => r.key === at(6, undefined, line))?.messageTs;

  expect([1, 2, 3, 4, 5].map(owner)).toEqual([
    "1",
    undefined,
    "2",
    "2",
    undefined,
  ]);
});
