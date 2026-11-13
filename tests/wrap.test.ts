import { expect, test } from "bun:test";
import { wrapPreformatted, wrapRuns } from "../src/ui/app/wrap";

const text = (lines: ReturnType<typeof wrapRuns>) =>
  lines.map((line) => line.map((run) => run.text).join(""));

test("text that fits stays on one line", () => {
  expect(text(wrapRuns([{ text: "hello world" }], 20))).toEqual([
    "hello world",
  ]);
});

test("lines break at spaces and never exceed the width", () => {
  expect(text(wrapRuns([{ text: "one two three four" }], 9))).toEqual([
    "one two",
    "three",
    "four",
  ]);
});

test("a word longer than the width is split", () => {
  expect(text(wrapRuns([{ text: "abcdefghij" }], 4))).toEqual([
    "abcd",
    "efgh",
    "ij",
  ]);
});

test("newlines start new lines and empty text is one empty line", () => {
  expect(text(wrapRuns([{ text: "a\n\nb" }], 10))).toEqual(["a", "", "b"]);
  expect(text(wrapRuns([{ text: "" }], 10))).toEqual([""]);
});

test("wide characters and emoji count as two cells", () => {
  const lines = text(wrapRuns([{ text: "日本語日本語" }], 6));

  expect(lines).toEqual(["日本語", "日本語"]);

  for (const line of text(wrapRuns([{ text: "🎉🎉🎉 🎉🎉🎉" }], 7))) {
    expect(Bun.stringWidth(line)).toBeLessThanOrEqual(7);
  }
});

test("styles survive wrapping", () => {
  const lines = wrapRuns(
    [{ text: "aa " }, { text: "bbbb cc", bold: true, color: "red" }],
    6,
  );

  expect(lines).toEqual([
    [{ text: "aa" }],
    [{ text: "bbbb", bold: true, color: "red" }],
    [{ text: "cc", bold: true, color: "red" }],
  ]);
});

test("preformatted text keeps spaces and breaks only at newlines and the width", () => {
  expect(
    wrapPreformatted([{ text: "  a  b\n\n    abcdefg" }], 6).map((line) =>
      line.map((run) => run.text).join(""),
    ),
  ).toEqual(["  a  b", "", "    ab", "cdefg"]);
});

test("skin tones are left out and joined emoji split into parts, measured as drawn", () => {
  const lines = text(wrapRuns([{ text: "👍🏻 👨‍👩‍👧 🧑🏽‍💻" }], 8));

  expect(lines).toEqual(["👍", "👨👩👧", "🧑💻"]);

  for (const line of lines) {
    expect(Bun.stringWidth(line)).toBeLessThanOrEqual(8);
  }

  expect(text(wrapPreformatted([{ text: "👍🏽👨‍👩‍👧" }], 20))).toEqual(["👍👨👩👧"]);
});
