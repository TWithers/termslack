import { afterEach, expect, test } from "bun:test";
import {
  shortcutGroups,
  shortcutLabel,
  shortcuts,
} from "../src/ui/app/shortcuts";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import { waitFor } from "./support/fakeSlack";
import { findPopup } from "./support/popup";

let app: AppHarness;

afterEach(() => app.stop());

const general = "C012AB3CD";
const me = "U123ABC456";
const other = "U222222222";
const parentTs = "1600000000.000001";
const mineTs = "1600000100.000001";

const parent = {
  type: "message",
  user: other,
  text: "their parent",
  ts: parentTs,
  thread_ts: parentTs,
  reply_count: 1,
};
const mine = { type: "message", user: me, text: "my words", ts: mineTs };
const reply = {
  type: "message",
  user: other,
  text: "a reply",
  ts: "1600000010.000001",
  thread_ts: parentTs,
};

async function start({
  rows = 40,
  columns = 160,
}: { rows?: number; columns?: number } = {}) {
  app = await startAppHarness({
    columns,
    rows,
    prepare: (slack) => {
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [mine, parent],
        has_more: false,
      }));
      slack.respond("conversations.replies", () => ({
        ok: true,
        messages: [parent, reply],
        has_more: false,
      }));
    },
  });
  await app.waitForScreen("#general", 5000);
}

async function openGeneral() {
  await app.press(keys.enter);
  await app.waitForScreen("my words");
  await waitFor(() => app.session.currentUserId);
}

const statusBar = () => app.screen().trimEnd().split("\n").at(-1)!;
const helpIsOpen = () => app.screen().includes("Keyboard shortcuts");

test("? opens the help from the sidebar before any conversation is open, and Esc closes it", async () => {
  await start();

  await app.press("?");

  expect(helpIsOpen()).toBe(true);
  expect(findPopup(app.screen(), "Keyboard shortcuts")!.bottomBorder).toContain(
    "Esc or ? close",
  );
  expect(statusBar()).not.toContain("Esc or ? close");
  expect(app.screen()).toContain("#general");

  await app.press(keys.escape);

  expect(helpIsOpen()).toBe(false);
  expect(app.screen()).toContain("#general");
});

test("? opens the help from the message pane and closes it again with ?, focus back on the messages", async () => {
  await start();
  await openGeneral();
  await app.press(keys.tab);
  expect(statusBar()).toContain("j/k select");

  await app.press("?");

  expect(helpIsOpen()).toBe(true);

  await app.press("?");

  expect(helpIsOpen()).toBe(false);
  expect(statusBar()).toContain("r react");

  await app.press("d");

  expect(statusBar()).toContain("Delete this message?");
});

test("? opens the help from the thread pane and Esc returns to the thread, not closing it", async () => {
  await start();
  await openGeneral();
  await app.press(keys.tab);
  await app.press("k");
  await app.press(keys.enter);
  await app.waitForScreen("a reply");
  expect(statusBar()).toContain("Esc close thread");

  await app.press("?");

  expect(helpIsOpen()).toBe(true);

  await app.press(keys.escape);

  expect(helpIsOpen()).toBe(false);
  expect(app.screen()).toContain("a reply");
  expect(statusBar()).toContain("Esc close thread");
});

test("in an input box ? types a ?", async () => {
  await start();
  await openGeneral();
  await app.press(keys.tab);
  await app.press(keys.tab);
  expect(statusBar()).toContain("Esc back");

  await app.press("?");

  expect(helpIsOpen()).toBe(false);
  expect(app.screen()).toContain("?");
});

test("keys go only to the help while it is open", async () => {
  await start();
  await openGeneral();
  await app.press(keys.tab);
  await app.press("?");

  for (const key of ["d", "e", "r", "t", "i", "q", keys.enter, keys.tab, "a"]) {
    await app.press(key);
  }

  expect(helpIsOpen()).toBe(true);
  expect(app.session.status).not.toBe("disconnected");

  await app.press(keys.escape);

  expect(statusBar()).not.toContain("Delete this message?");
  expect(statusBar()).toContain("r react");
  expect(app.screen()).not.toContain("Add reaction");
});

test("Ctrl+C still quits while the help is open", async () => {
  await start();
  await app.press("?");

  await app.press(keys.ctrlC);

  await waitFor(() => app.session.status === "disconnected");
});

test("the help lists every shortcut of every group", async () => {
  await start({ rows: 200, columns: 300 });
  await app.press("?");

  const screen = app.screen();

  for (const group of shortcutGroups) {
    expect(screen).toContain(group.title);
  }

  for (const shortcut of shortcuts) {
    expect(screen).toContain(shortcut.description);
  }
});

test("a help taller than the terminal scrolls with j/k, arrows, paging and g/G", async () => {
  await start({ rows: 12, columns: 300 });
  await app.press("?");

  expect(app.screen()).toContain("Everywhere");
  expect(app.screen()).not.toContain("Overlays");

  await app.press("G");

  expect(app.screen()).toContain("Jump to the bottom");
  expect(app.screen()).not.toContain("Everywhere");

  await app.press("g");

  expect(app.screen()).toContain("Everywhere");

  await app.press("j");
  await app.press("j");
  await app.press(keys.up);

  expect(app.screen()).not.toContain("Everywhere");
  expect(app.screen()).toContain("Show this help");

  await app.press(keys.pageDown);

  expect(app.screen()).not.toContain("Show this help");

  await app.press(keys.pageUp);
  await app.press("g");

  expect(app.screen()).toContain("Everywhere");
});

test("reopening the help starts at the top", async () => {
  await start({ rows: 12, columns: 300 });
  await app.press("?");
  await app.press("G");
  await app.press("?");
  await app.press("?");

  expect(app.screen()).toContain("Everywhere");
});

test("the help is a large popup, centred over the panes, which stay where they were", async () => {
  await start();
  await openGeneral();
  const before = app.screen().split("\n");

  await app.press("?");

  const popup = findPopup(app.screen(), "Keyboard shortcuts")!;
  const width = popup.right - popup.left;
  const height = popup.bottom - popup.top + 1;

  expect(width).toBe(128);
  expect(popup.left).toBe(16);
  expect(height).toBe(31);
  expect(popup.top).toBe(4);

  const after = app.screen().split("\n");

  for (const [index, line] of before.entries()) {
    if (index === before.length - 1) {
      continue;
    }

    const inside = index >= popup.top && index <= popup.bottom;
    const outside = (text: string) =>
      (inside
        ? [...text].slice(0, popup.left).join("") +
          [...text].slice(popup.right).join("")
        : text
      ).trimEnd();

    expect(outside(after[index] ?? "")).toBe(outside(line));
  }

  expect(after[1]).toContain("Channels");
  expect(before.join("\n")).toContain("my words");
  expect(popup.rows.join("\n")).not.toContain("my words");
});

test("nothing from the panes shows through the help popup", async () => {
  await start({ rows: 14, columns: 100 });
  await openGeneral();
  const before = app.screen().split("\n");
  const underPopup = (
    lines: string[],
    popup: NonNullable<ReturnType<typeof findPopup>>,
  ) =>
    lines
      .slice(popup.top + 1, popup.bottom)
      .map((line) => [...line].slice(popup.left + 1, popup.right - 1).join(""));

  await app.press("?");

  const popup = findPopup(app.screen(), "Keyboard shortcuts")!;

  expect(underPopup(before, popup).join("\n")).toContain("my words");
  expect(popup.rows.join("\n")).not.toContain("my words");
  expect(popup.rows.join("\n")).not.toContain("their parent");
  expect(popup.rows.join("\n")).not.toContain("#general");
});

test("in a narrow, short terminal the help popup grows to fill the panes area", async () => {
  await start({ rows: 14, columns: 40 });
  await app.press("?");

  const popup = findPopup(app.screen(), "Keyboard shortcuts")!;

  expect(popup.left).toBe(0);
  expect(popup.right).toBe(40);
  expect(popup.top).toBe(0);
  expect(popup.bottom).toBe(11);

  expect(popup.rows.length).toBe(10);

  await app.press("G");

  expect(app.screen()).not.toContain("Everywhere");
  expect(app.screen()).toContain("Jump to the bottom");
});

const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);

/** The popup's content with the border and padding stripped, one entry per screen row. */
const popupLines = () =>
  findPopup(app.screen(), "Keyboard shortcuts")!.rows.map((row) =>
    row.replace(/^│/, "").replace(/│$/, "").trimEnd(),
  );

async function scrollThrough(): Promise<string> {
  await app.press("g");
  const seen: string[] = [];
  let previous = "";

  for (let step = 0; step < 60; step++) {
    const lines = popupLines().join("\n");

    if (lines === previous) {
      break;
    }

    seen.push(lines);
    previous = lines;
    await app.press(keys.pageDown);
  }

  return seen.join("\n");
}

test("in a narrow terminal every description shows in full, wrapped under itself", async () => {
  await start({ rows: 30, columns: 60 });
  await app.press("?");

  const popup = findPopup(app.screen(), "Keyboard shortcuts")!;
  const everything = await scrollThrough();
  const flattened = everything.replace(/\s+/g, " ");

  for (const shortcut of shortcuts) {
    const words = wordsOf(shortcut.description);

    expect(flattened).toContain(words.at(-1)!);
    expect(flattened).toContain(words[0]!);
  }

  for (const line of everything.split("\n")) {
    expect([...line].length).toBeLessThanOrEqual(popup.right - popup.left);
  }

  expect(everything).not.toContain("…");
});

test("a long description's continuation lines start in the description column", async () => {
  await start({ rows: 40, columns: 60 });
  await app.press("?");

  const lines = popupLines();
  const first = lines.findIndex((line) => line.includes("Quick switcher"));
  const column = lines[first]!.indexOf("Quick switcher");

  expect(column).toBeGreaterThan(2);
  expect(lines[first + 1]!.slice(0, column).trim()).toBe("");
  expect(lines[first + 1]!.slice(column).trim()).not.toBe("");
});

test("the key column takes at most a third of the help's width and long labels wrap", async () => {
  await start({ rows: 200, columns: 60 });
  await app.press("?");

  const inner = 60 * 0.8 - 2;
  const limit = Math.floor((inner - 1) / 3);
  const column = (line: string) => line.search(/\S/);
  const lines = popupLines();
  const widest = Math.max(
    ...shortcuts.map((shortcut) => [...shortcutLabel(shortcut)].length),
  );

  expect(widest).toBeGreaterThan(limit);

  const longest = shortcuts.find(
    (shortcut) => [...shortcutLabel(shortcut)].length === widest,
  )!;
  const firstWord = shortcutLabel(longest).split(" ")[0]!;
  const row = lines.findIndex((line) => line.includes(firstWord));

  expect(row).toBeGreaterThan(-1);

  for (const line of lines) {
    const label = line.slice(0, 3 + limit);

    expect(label.length).toBeLessThanOrEqual(3 + limit);
  }

  expect(column(lines[row]!)).toBe(3);
});

test("scrolling to the bottom of a narrow help reaches its last line", async () => {
  await start({ rows: 14, columns: 60 });
  await app.press("?");
  await app.press("G");

  const last = shortcuts
    .filter((shortcut) => shortcut.group === shortcutGroups.at(-1)!.id)
    .at(-1)!;
  const lastWord = wordsOf(last.description).at(-1)!;

  expect(popupLines().join("\n")).toContain(lastWord);

  await app.press("j");

  expect(popupLines().join("\n")).toContain(lastWord);
});
