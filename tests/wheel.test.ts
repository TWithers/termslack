import { afterEach, describe, expect, test } from "bun:test";
import { themeChoices } from "../src/ui/app/themeChoices";
import {
  applyTheme,
  currentThemeName,
  defaultThemeName,
} from "../src/ui/theme";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import { waitFor } from "./support/fakeSlack";
import { findPopup } from "./support/popup";

let app: AppHarness | undefined;

afterEach(async () => {
  await app?.stop();
  app = undefined;
  applyTheme(defaultThemeName);
});

const sidebarWidth = 32;
const parentTs = "1600000000.000001";

/** Message `n` of a conversation numbered oldest (1) to newest. */
const numbered = (n: number) => ({
  type: "message",
  user: "U222222222",
  text: `msg ${String(n).padStart(4, "0")}`,
  ts: `1600000000.${String(n).padStart(6, "0")}`,
  ...(n === 40 ? { thread_ts: `1600000000.000040`, reply_count: 1 } : {}),
});

/** Slack's history pages for messages 1..count: newest first, 50 per page. */
function historyPages(count: number) {
  const pages: Record<string, unknown>[] = [];

  for (let high = count; high > 0; high -= 50) {
    const low = Math.max(1, high - 49);
    const messages = [];

    for (let n = high; n >= low; n--) {
      messages.push(numbered(n));
    }

    pages.push({
      ok: true,
      messages,
      has_more: low > 1,
      response_metadata: { next_cursor: low > 1 ? `before-${low}` : "" },
    });
  }

  return pages;
}

const replies = [
  { ...numbered(40), thread_ts: "1600000000.000040" },
  {
    type: "message",
    user: "U222222222",
    text: "first reply",
    ts: "1600000050.000001",
    thread_ts: "1600000000.000040",
  },
  {
    type: "message",
    user: "U222222222",
    text: "second reply",
    ts: "1600000050.000002",
    thread_ts: "1600000000.000040",
  },
];

async function start(count = 40, rows = 30) {
  app = await startAppHarness({
    columns: 160,
    rows,
    prepare: (slack) => {
      slack.grantScopes([
        "identify",
        "channels:read",
        "channels:write",
        "chat:write",
      ]);
      slack.respondPaged("conversations.history", historyPages(count));
      slack.respond("conversations.replies", () => ({
        ok: true,
        messages: replies,
        has_more: false,
      }));
    },
  });
  await app.waitForScreen("#general", 5000);
  await app.press(keys.enter);
  await app.waitForScreen(/msg \d{4}/);
  await waitFor(() => app!.session.currentUserId);
  await app.press(keys.tab);
}

const screenRows = () => app!.screen().split("\n");
const statusBar = () => screenRows().at(-1)!;
const messagesFocused = () => statusBar().includes("j/k select");
const historyCalls = () =>
  app!.slack.calls.filter((call) => call.method === "conversations.history");

/** The screen row of `text` in the message pane. */
const rowOf = (text: string, fromColumn = sidebarWidth) =>
  screenRows().findIndex((line) => line.slice(fromColumn).includes(text));

/** Which message numbers carry the selection bar (only a focused list draws it). */
const selected = () =>
  screenRows().flatMap((line) => {
    const match = line.slice(sidebarWidth).match(/^ ▌ .*msg (\d{4})/);

    return match ? [Number(match[1])] : [];
  });

const paneColumn = 60;
const paneRow = 10;

describe("the message pane", () => {
  test("the wheel moves the selection one message per event and leaves focus alone", async () => {
    await start();
    expect(selected()).toEqual([40]);

    await app!.wheel("up", paneColumn, paneRow);
    expect(selected()).toEqual([39]);

    await app!.wheel("up", paneColumn, paneRow);
    await app!.wheel("down", paneColumn, paneRow);
    expect(selected()).toEqual([39]);
    expect(messagesFocused()).toBe(true);
  });

  test("a burst of wheel events ends on the right message", async () => {
    await start();
    await app!.wheel("up", paneColumn, paneRow, 30);
    expect(selected()).toEqual([10]);

    await app!.wheel("down", paneColumn, paneRow, 12);
    expect(selected()).toEqual([22]);
  });

  test("the wheel over the pane acts while the sidebar has focus, without moving it", async () => {
    await start();
    await app!.click(5, 20);
    expect(messagesFocused()).toBe(false);

    await app!.wheel("up", paneColumn, paneRow, 3);
    await app!.press(keys.tab);

    expect(selected()).toEqual([37]);
  });

  test("the wheel while typing in the input box leaves the cursor there", async () => {
    await start();
    await app!.press("i");
    await app!.press("abc");
    await app!.wheel("up", paneColumn, paneRow, 2);
    await app!.press("d");

    expect(statusBar()).toContain("Enter send");
    expect(app!.screen()).toContain("abcd");

    await app!.press(keys.escape);
    expect(selected()).toEqual([38]);
  });

  test("wheeling past the oldest loaded message loads older history once", async () => {
    await start(120);
    expect(historyCalls()).toHaveLength(1);

    await app!.wheel("up", paneColumn, paneRow, 80);
    await app!.wheel("up", paneColumn, paneRow, 5);
    await app!.wheel("up", paneColumn, paneRow);
    await waitFor(() => historyCalls().length === 2);
    await waitFor(() => screenRows().join().includes("msg 0069"));

    expect(historyCalls()).toHaveLength(2);
  });
});

describe("the thread pane", () => {
  const threadColumn = 140;

  /** The thread pane's selected line (only a focused list draws the bar). */
  const selectedReply = () =>
    screenRows()
      .map((line) => line.slice(sidebarWidth))
      .filter((line) => line.includes("▌") && /reply|msg 0040/.test(line));

  test("the wheel moves the thread's selection, even while its input box has the cursor", async () => {
    await start();
    await app!.press(keys.enter);
    await app!.waitForScreen("second reply");
    expect(selectedReply().join()).toContain("second reply");

    await app!.press("i");
    await app!.press("xy");
    await app!.wheel("up", threadColumn, 10);
    await app!.press("z");

    expect(statusBar()).toContain("Ctrl+T also send");
    expect(app!.screen()).toContain("xyz");

    await app!.press(keys.escape);
    expect(selectedReply().join()).toContain("first reply");

    await app!.wheel("up", threadColumn, 10);
    await app!.wheel("down", threadColumn, 10, 3);
    expect(selectedReply().join()).toContain("second reply");
    expect(statusBar()).toContain("Esc close thread");
  });
});

describe("the sidebar", () => {
  test("the wheel moves the selection a row at a time, opening nothing", async () => {
    await start();

    const selectedRow = () =>
      screenRows().findIndex((line) => line.slice(0, 5).includes("›"));

    await app!.click(5, 20);
    const before = selectedRow();

    await app!.wheel("up", 5, 5);
    expect(selectedRow()).toBeLessThan(before);

    await app!.press(keys.tab);
    await app!.wheel("down", 5, 5, 2);
    await app!.wheel("down", 5, 5);

    expect(selectedRow()).toBeGreaterThan(before);
    expect(messagesFocused()).toBe(true);
    expect(app!.screen()).toContain("msg 0040");
  });
});

describe("popups", () => {
  const highlighted = (title: string) =>
    findPopup(app!.screen(), title)!.rows.filter((row) => row.includes("› "));

  test("the wheel over the switcher moves the highlighted row, and outside it does nothing", async () => {
    await start();
    await app!.press(keys.ctrlK);
    await app!.waitForScreen("Switch conversation");

    const popup = findPopup(app!.screen(), "Switch conversation")!;
    const first = highlighted("Switch conversation");

    await app!.wheel("down", popup.left + 5, popup.top + 3, 2);
    const moved = highlighted("Switch conversation");

    expect(moved).not.toEqual(first);

    await app!.wheel("up", 0, 0, 2);
    expect(highlighted("Switch conversation")).toEqual(moved);

    await app!.wheel("up", popup.left + 5, popup.top + 3, 2);
    expect(highlighted("Switch conversation")).toEqual(first);
  });

  test("the wheel over the theme picker moves the highlighted row and previews its theme", async () => {
    await start();
    await app!.press("T");
    await app!.waitForScreen("Theme");

    const popup = findPopup(app!.screen(), "Theme")!;
    const second = themeChoices("")[1]!.name;
    const first = currentThemeName;

    await app!.wheel("down", popup.left + 5, popup.top + 3);
    await waitFor(() => currentThemeName === second);

    await app!.wheel("up", popup.left + 5, popup.top + 3);
    await waitFor(() => currentThemeName === first);
  });

  test("the wheel scrolls the help", async () => {
    await start(40, 14);
    await app!.press("?");
    await app!.waitForScreen("Keyboard shortcuts");

    const popup = findPopup(app!.screen(), "Keyboard shortcuts")!;
    const before = popup.rows.join("\n");

    await app!.wheel("down", popup.left + 5, popup.top + 3, 4);
    expect(
      findPopup(app!.screen(), "Keyboard shortcuts")!.rows.join("\n"),
    ).not.toBe(before);

    await app!.wheel("up", popup.left + 5, popup.top + 3, 4);
    expect(
      findPopup(app!.screen(), "Keyboard shortcuts")!.rows.join("\n"),
    ).toBe(before);
  });

  test("the wheel over the messages while a popup is open moves nothing", async () => {
    await start();
    await app!.press("?");
    await app!.waitForScreen("Keyboard shortcuts");
    await app!.wheel("up", paneColumn, 28, 5);
    await app!.press("?");

    expect(selected()).toEqual([40]);
  });

  test("the wheel does nothing while a y/n question is showing, and doesn't cancel it", async () => {
    await start();
    await app!.click(5, 1);
    await app!.press("x");
    await app!.waitForScreen("Leave #general? y/n");

    await app!.wheel("up", paneColumn, paneRow, 3);
    await app!.wheel("down", 5, 5, 3);

    expect(statusBar()).toContain("Leave #general? y/n");

    await app!.press("n");
    expect(screenRows()[1]).toContain("›");

    await app!.press(keys.tab);
    expect(selected()).toEqual([40]);
  });
});
