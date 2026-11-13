import { describe, expect, test } from "bun:test";
import {
  lineKey,
  type SidebarEntry,
  sidebarLineAt,
  sidebarLines,
  sidebarScrollStart,
  visibleSidebarLines,
} from "../src/ui/app/sidebarEntries";

function entry(id: string, label: string): SidebarEntry {
  return {
    conversation: { id },
    label,
    markers: { isUnread: false, mentions: 0 },
  } as SidebarEntry;
}

const groups = {
  sections: [],
  channels: [entry("C1", "#one"), entry("C2", "#two")],
  directMessages: [
    entry("D1", "@ann"),
    entry("D2", "@bob"),
    entry("D3", "@cy"),
  ],
  unknownChannels: [],
};

const keyAt = (
  lines: ReturnType<typeof sidebarLines>,
  start: number,
  height: number,
  row: number,
) => {
  const line = sidebarLineAt(lines, start, height, row);

  return line && lineKey(line);
};

describe("sidebar row mapping", () => {
  test("maps rows to headings and entries from the top", () => {
    const lines = sidebarLines(groups);

    expect(
      [0, 1, 2, 3, 4, 5, 6].map((row) => keyAt(lines, 0, 20, row)),
    ).toEqual([
      "heading:channels",
      "C1",
      "C2",
      "heading:directMessages",
      "D1",
      "D2",
      "D3",
    ]);
  });

  test("rows below the last line, above the top and past the height have nothing", () => {
    const lines = sidebarLines(groups);

    expect(keyAt(lines, 0, 20, 7)).toBeUndefined();
    expect(keyAt(lines, 0, 20, -1)).toBeUndefined();
    expect(keyAt(lines, 0, 3, 3)).toBeUndefined();
  });

  test("a collapsed section above moves the rows below it up", () => {
    const lines = sidebarLines(groups, {
      recentLimit: 10,
      showAll: false,
      collapsed: new Set(["channels"]),
    });

    expect(keyAt(lines, 0, 20, 0)).toBe("heading:channels");
    expect(keyAt(lines, 0, 20, 1)).toBe("heading:directMessages");
    expect(keyAt(lines, 0, 20, 2)).toBe("D1");
  });

  test("a collapsed section still has its open conversation on a row", () => {
    const lines = sidebarLines(groups, {
      recentLimit: 10,
      showAll: false,
      openId: "C2",
      collapsed: new Set(["channels"]),
    });

    expect(keyAt(lines, 0, 20, 1)).toBe("C2");
    expect(keyAt(lines, 0, 20, 2)).toBe("heading:directMessages");
  });

  test("the recent-DMs filter leaves the hidden ones out of the rows", () => {
    const lines = sidebarLines(groups, { recentLimit: 1, showAll: false });

    expect(keyAt(lines, 0, 20, 4)).toBe("D1");
    expect(keyAt(lines, 0, 20, 5)).toBeUndefined();
  });

  test("a scrolled sidebar counts rows from its first drawn line", () => {
    const lines = sidebarLines(groups);
    const start = sidebarScrollStart(0, lines, "D3", 4);

    expect(start).toBe(3);
    expect(keyAt(lines, start, 4, 0)).toBe("heading:directMessages");
    expect(keyAt(lines, start, 4, 3)).toBe("D3");
    expect(keyAt(lines, start, 4, 4)).toBeUndefined();
  });

  test("agrees with the lines the sidebar draws", () => {
    const lines = sidebarLines(groups);

    visibleSidebarLines(lines, 2, 4).forEach((line, row) => {
      expect(sidebarLineAt(lines, 2, 4, row)).toBe(line);
    });
  });
});
