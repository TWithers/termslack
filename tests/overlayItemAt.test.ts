import { expect, test } from "bun:test";
import {
  overlayBox,
  overlayItemAt,
  overlayShownItems,
} from "../src/ui/app/Overlay";

/*
 * A compact popup in an 80x30 area: border, title, filter line, then up to
 * ten rows. Rows and columns count from the popup's top left corner.
 */
const frame = overlayBox("compact", 80, 30, {
  hasFilter: true,
  remainingItems: 25,
});
const list = { hasFilter: true, start: 0, count: 25 };

test("the border, title and filter line are not items, the list rows are", () => {
  expect(overlayItemAt(frame, list, 5, 0)).toBeUndefined();
  expect(overlayItemAt(frame, list, 5, 1)).toBeUndefined();
  expect(overlayItemAt(frame, list, 5, 2)).toBeUndefined();
  expect(overlayItemAt(frame, list, 5, 3)).toBe(0);
  expect(overlayItemAt(frame, list, 5, 12)).toBe(9);
  expect(overlayItemAt(frame, list, 5, 13)).toBeUndefined();
});

test("the side borders are not items", () => {
  expect(overlayItemAt(frame, list, 0, 3)).toBeUndefined();
  expect(overlayItemAt(frame, list, 1, 3)).toBe(0);
  expect(overlayItemAt(frame, list, frame.width - 2, 3)).toBe(0);
  expect(overlayItemAt(frame, list, frame.width - 1, 3)).toBeUndefined();
});

test("a scrolled list counts from its first shown item", () => {
  expect(overlayItemAt(frame, { ...list, start: 7 }, 5, 3)).toBe(7);
  expect(overlayItemAt(frame, { ...list, start: 15 }, 5, 12)).toBe(24);
});

test("rows below the last item are not items, and a popup with no filter line starts one row higher", () => {
  const short = overlayBox("compact", 80, 30, {
    hasFilter: true,
    remainingItems: 3,
  });

  expect(overlayItemAt(short, { ...list, count: 3 }, 5, 5)).toBe(2);
  expect(overlayItemAt(short, { ...list, count: 3 }, 5, 6)).toBeUndefined();

  const plain = overlayBox("large", 80, 30, {
    hasFilter: false,
    remainingItems: 0,
  });

  expect(
    overlayItemAt(plain, { hasFilter: false, start: 0, count: 50 }, 5, 2),
  ).toBe(0);
});

test("an item of several rows owns all of them, and a part-shown item at the bottom is not drawn", () => {
  const large = overlayBox("large", 80, 30, {
    hasFilter: true,
    remainingItems: 0,
  });
  const results = { hasFilter: true, itemHeight: 5, start: 2, count: 9 };
  const shown = overlayShownItems(large.height, true, 5);

  expect(shown).toBe(Math.floor((large.height - 2 - 2) / 5));
  expect(overlayItemAt(large, results, 5, 3)).toBe(2);
  expect(overlayItemAt(large, results, 5, 7)).toBe(2);
  expect(overlayItemAt(large, results, 5, 8)).toBe(3);
  expect(overlayItemAt(large, results, 5, 3 + shown * 5)).toBeUndefined();
});
