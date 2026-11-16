import { expect, test } from "bun:test";
import { standardEmoji } from "../src/session/emoji";
import { cellWidth, terminalSafeText } from "../src/ui/terminalSafeText";

const skinTones = /[\u{1F3FB}-\u{1F3FF}]/u;

test.each([
  ["thumbs up", "👍🏻", "👍"],
  ["a wave in the darkest tone", "👋🏿", "👋"],
  ["a raised hand mid-sentence", "high 🙌🏽 five", "high 🙌 five"],
  ["a person", "🧑🏾", "🧑"],
  ["several in a row", "👍🏻👍🏼👍🏽", "👍👍👍"],
])("a skin tone is left out: %s", (_, text, expected) => {
  expect(terminalSafeText(text)).toBe(expected);
});

test("skin tones from shortcodes are left out", () => {
  for (const tone of [2, 3, 4, 5, 6]) {
    const character = standardEmoji("+1", tone)!;

    expect(character).toMatch(skinTones);
    expect(terminalSafeText(character)).toBe("👍");
  }
});

test.each([
  ["a family", "👨‍👩‍👧", "👨👩👧"],
  ["a rainbow flag", "🏳️‍🌈", "🏳🌈"],
  ["a profession", "🧑‍💻", "🧑💻"],
  ["a profession with a skin tone", "🧑🏽‍💻", "🧑💻"],
])("a joined sequence is split into its parts: %s", (_, text, expected) => {
  expect(terminalSafeText(text)).toBe(expected);
});

test.each([
  ["a red heart", "❤️", "❤"],
  ["a warning sign", "⚠️", "⚠"],
  ["a smile mid-sentence", "thanks ☺️ really", "thanks ☺ really"],
  ["a check mark", "✔️", "✔"],
  ["a sun", "☀️", "☀"],
])("a symbol asked to be drawn as emoji is drawn plain, one cell: %s", (_, text, expected) => {
  expect(terminalSafeText(text)).toBe(expected);
  expect(cellWidth(text)).toBe(Bun.stringWidth(expected));
});

test("a symbol asked to be drawn as emoji measures one cell, as every terminal draws it", () => {
  for (const text of ["❤️", "⚠️", "☺️", "✔️", "☀️", "✌️"]) {
    expect(cellWidth(text)).toBe(1);
  }
});

test.each([
  ["one", "1️⃣", "1"],
  ["hash", "#️⃣", "#"],
  ["star", "*️⃣", "*"],
])("a keycap is drawn as its character: %s", (_, text, expected) => {
  expect(terminalSafeText(text)).toBe(expected);
  expect(cellWidth(text)).toBe(1);
});

test("text with none of these is unchanged", () => {
  const text = "plain 🇺🇸 🎉 👍 ✨ 日本語 é";

  expect(terminalSafeText(text)).toBe(text);
});

test("a split sequence measures as the sum of its parts", () => {
  for (const text of ["👨‍👩‍👧", "🏳️‍🌈", "🧑‍💻", "🧑🏽‍💻", "👍🏻"]) {
    const safe = terminalSafeText(text);
    const summed = [...new Intl.Segmenter().segment(safe)].reduce(
      (total, { segment }) => total + Bun.stringWidth(segment),
      0,
    );

    expect(cellWidth(text)).toBe(summed);
  }

  expect(cellWidth("👨‍👩‍👧")).toBe(6);
  expect(cellWidth("👍🏻")).toBe(2);
});
