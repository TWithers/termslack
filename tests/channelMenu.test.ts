import { afterEach, expect, test } from "bun:test";
import { overlayBox } from "../src/ui/app/Overlay";
import { loadFixture } from "./support/fixtures";
import { waitFor } from "./support/fakeSlack";
import { findPopup } from "./support/popup";
import {
  type AppHarness,
  keys,
  sgrMouse,
  startAppHarness,
} from "./support/appHarness";

let app: AppHarness;

afterEach(() => app.stop());

const general = "C012AB3CD";
const secret = "G012AB3CD";
const rightButton = 2;
const sidebarWidth = 32;

async function start() {
  const [info] = await loadFixture("conversations-info-private");
  const [channels, directs] = [
    ...(await loadFixture("users-conversations-channels")),
    ...(await loadFixture("users-conversations-dms")),
  ];

  app = await startAppHarness({
    rows: 30,
    columns: 120,
    prepare: async (slack) => {
      slack.respondPaged("users.conversations", [
        { ...channels!, channels: [...channels!.channels, info!.channel] },
        directs!,
      ]);
      slack.respondPaged(
        "conversations.list",
        await loadFixture("conversations-list-public"),
      );
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [
          {
            type: "message",
            user: "U222222222",
            text: "earlier",
            ts: "1600000000.000001",
          },
        ],
        has_more: false,
      }));
      slack.grantScopes([
        "identify",
        "dnd:read",
        "channels:read",
        "channels:write",
        "groups:write",
      ]);
    },
  });
  await app.waitForScreen("#secret");
  await waitFor(() => app.session.currentUserId);
}

const statusBar = () => app.screen().trimEnd().split("\n").at(-1)!;
/** The menu popup, found by the title over its border; the sidebar's own `#name` rows are blanked out first. */
const menu = (title: string) =>
  findPopup(
    app
      .screen()
      .split("\n")
      .map((line) => " ".repeat(sidebarWidth) + line.slice(sidebarWidth))
      .join("\n"),
    title,
  );
const sidebarRows = () =>
  app
    .screen()
    .split("\n")
    .map((line) => line.slice(0, sidebarWidth).trim());
const rowOf = (name: string) =>
  sidebarRows().findIndex((row) => row.includes(name));
const selectedRow = () => sidebarRows().find((row) => row.startsWith("›"));
const leaveCalls = () =>
  app.slack.calls.filter((call) => call.method === "conversations.leave");
const rightClick = (column: number, row: number) =>
  app.mouse(sgrMouse(rightButton, column, row, "M"));

async function selectRow(name: string) {
  const selectedIndex = () =>
    sidebarRows().findIndex((row) => row.startsWith("›"));

  while (!selectedRow()?.includes(name)) {
    await app.press(selectedIndex() < rowOf(name) ? "j" : "k");
  }
}

test("m on a channel opens the menu titled with its name, listing Leave channel with its letter", async () => {
  await start();

  await app.press("m");

  const popup = menu("#general");

  expect(popup).toBeDefined();
  expect(popup!.rows.join("\n")).toContain("l Leave channel");
  expect(popup!.rows.join("\n")).toContain("›");
  expect(statusBar()).toContain("Enter or the item's letter choose");
});

test("m on a private channel opens its menu too", async () => {
  await start();

  await selectRow("#secret");
  await app.press("m");

  expect(menu("#secret")).toBeDefined();
});

test("the menu opens beside the selected entry, over the panes", async () => {
  await start();

  await selectRow("#random");
  await app.press("m");

  const popup = menu("#random")!;

  expect(popup.left).toBe(sidebarWidth);
  expect(popup.top).toBe(rowOf("#random"));
});

test("m on a DM, a group DM or a heading does nothing, not even a status message", async () => {
  await start();

  const before = statusBar();

  for (const name of ["Direct messages", "@Peter Venkman", "@stantz"]) {
    await selectRow(name);
    await app.press("m");

    expect(app.screen()).not.toContain("Leave channel");
    expect(statusBar()).toBe(before);
    expect(statusBar()).not.toContain("y/n");
  }

  await selectRow("Channels");
  await app.press("m");

  expect(app.screen()).not.toContain("Leave channel");
});

test("a right-click on a channel selects it, without opening it, and opens its menu", async () => {
  await start();

  await rightClick(5, rowOf("#secret"));

  expect(selectedRow()).toContain("#secret");
  expect(menu("#secret")).toBeDefined();
  expect(app.screen()).toContain("No conversation open");
  expect(
    app.slack.calls.filter((c) => c.method === "conversations.history"),
  ).toHaveLength(0);
});

test("a right-click on a DM, a heading or an empty row does nothing", async () => {
  await start();

  await rightClick(5, rowOf("@Peter Venkman"));
  await rightClick(5, rowOf("Direct messages"));
  await rightClick(5, 28);

  expect(app.screen()).not.toContain("Leave channel");
  expect(selectedRow()).not.toContain("@Peter");
});

test("j/k move the highlight and Enter chooses: Leave asks the same question as x", async () => {
  await start();

  await app.press("m");
  await app.press("j");
  await app.press("j");
  await app.press("j");
  await app.press("k");
  await app.press("j");
  await app.press(keys.enter);

  expect(menu("#general")).toBeUndefined();
  expect(statusBar()).toContain("Leave #general? y/n");
  expect(leaveCalls()).toHaveLength(0);
});

test("the letter chooses straight away, and y then leaves the channel", async () => {
  await start();

  await app.press("m");
  await app.press("l");

  expect(menu("#general")).toBeUndefined();
  expect(statusBar()).toContain("Leave #general? y/n");

  await app.press("y");
  await waitFor(() => rowOf("#general") < 0);

  expect(leaveCalls().map((call) => call.params)).toEqual([
    { channel: general },
  ]);
});

test("a private channel asks about the invite, as x does", async () => {
  await start();

  await selectRow("#secret");
  await app.press("m");
  await app.press("l");

  expect(statusBar()).toContain("Leave #secret?");
  expect(statusBar()).toContain("can't rejoin without an invite");

  await app.press("n");

  expect(leaveCalls()).toHaveLength(0);
});

test("a left click on the item chooses it", async () => {
  await start();

  await app.press("m");

  const popup = menu("#general")!;

  await app.click(popup.left + 3, popup.top + 5);

  expect(menu("#general")).toBeUndefined();
  expect(statusBar()).toContain("Leave #general? y/n");
});

test("a click on the popup's title does nothing, outside it closes the menu", async () => {
  await start();

  await app.press("m");

  const popup = menu("#general")!;

  await app.click(popup.left + 3, popup.top + 1);

  expect(menu("#general")).toBeDefined();

  await app.click(100, 27);

  expect(menu("#general")).toBeUndefined();
  expect(statusBar()).not.toContain("y/n");
});

test("the wheel moves the highlighted row without choosing", async () => {
  await start();

  await app.press("m");

  const popup = menu("#general")!;

  await app.wheel("down", popup.left + 3, popup.top + 2);

  expect(menu("#general")).toBeDefined();
  expect(leaveCalls()).toHaveLength(0);
});

test("Esc closes the menu and the sidebar has the keys again; other keys are taken while it's open", async () => {
  await start();

  await app.press("m");
  await app.press("x");
  await app.press("a");

  expect(menu("#general")).toBeDefined();
  expect(statusBar()).not.toContain("Leave #general? y/n");

  await app.press(keys.escape);

  expect(menu("#general")).toBeUndefined();

  await app.press("j");

  expect(selectedRow()).toContain("#random");
});

test("overlayBox puts an anchored compact popup at the anchor, kept on the screen", () => {
  const rows = { hasFilter: false, remainingItems: 1 };

  expect(
    overlayBox("compact", 120, 30, { ...rows, anchor: { top: 7, left: 32 } }),
  ).toMatchObject({ top: 7, left: 32, height: 4 });
  expect(
    overlayBox("compact", 120, 30, { ...rows, anchor: { top: 29, left: 100 } }),
  ).toMatchObject({ top: 26, left: 60 });
});
