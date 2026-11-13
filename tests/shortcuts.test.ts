import { expect, test } from "bun:test";
import {
  matchesChord,
  pressed,
  shortcutGroups,
  shortcuts,
} from "../src/ui/app/shortcuts";

test("the shortcut table has unique ids and a heading for every group it uses", () => {
  const ids = shortcuts.map((shortcut) => shortcut.id);
  const groups = new Set(shortcutGroups.map((group) => group.id));

  expect(new Set(ids).size).toBe(ids.length);
  expect(shortcuts.every((shortcut) => groups.has(shortcut.group))).toBe(true);
});

test("chords match plain characters, named keys and Ctrl combinations", () => {
  expect(matchesChord("j", "j", {})).toBe(true);
  expect(matchesChord("j", "j", { ctrl: true })).toBe(false);
  expect(matchesChord("ctrl+c", "c", { ctrl: true })).toBe(true);
  expect(matchesChord("ctrl+c", "c", {})).toBe(false);
  expect(matchesChord("esc", "", { escape: true })).toBe(true);
  expect(matchesChord("space", " ", {})).toBe(true);
  expect(pressed("list.down", "", { downArrow: true })).toBe(true);
  expect(pressed("list.down", "j", {}, { letters: false })).toBe(false);
});
