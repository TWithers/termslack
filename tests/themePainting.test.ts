import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import chalk from "chalk";
import { theme } from "../src/ui/theme";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import { findPopup } from "./support/popup";

let app: AppHarness;
let colourLevel: typeof chalk.level;

/** Ink only emits colour codes when it thinks the terminal has colour. */
beforeAll(() => {
  colourLevel = chalk.level;
  chalk.level = 3;
});

afterAll(() => {
  chalk.level = colourLevel;
});

afterEach(() => app.stop());

const other = "U222222222";

/** The escape that sets a 24-bit background, as Ink writes it. */
function backgroundCode(colour: string): string {
  const [red, green, blue] = [1, 3, 5].map((at) =>
    Number.parseInt(colour.slice(at, at + 2), 16),
  );

  return `\u001b[48;2;${red};${green};${blue}m`;
}

/** The characters of `row` that are drawn with no background at all. */
function cellsWithoutBackground(row: string): string {
  let hasBackground = false;
  let bare = "";

  for (const part of row.split(/(\u001b\[[0-9;]*m)/)) {
    const code = /^\u001b\[([0-9;]*)m$/.exec(part)?.[1];

    if (code === undefined) {
      bare += hasBackground ? "" : part;
    } else if (code === "49" || code === "0" || code === "") {
      hasBackground = false;
    } else if (code.startsWith("48;")) {
      hasBackground = true;
    }
  }

  return bare;
}

async function start() {
  app = await startAppHarness({
    columns: 100,
    rows: 30,
    prepare: (slack) => {
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [
          {
            type: "message",
            user: other,
            text: "hello there",
            ts: "1600000000.000001",
          },
        ],
        has_more: false,
      }));
    },
  });
  await app.waitForScreen("#general", 5000);
  await app.press(keys.enter);
  await app.waitForScreen("hello there");
}

const rowWith = (text: string) =>
  app.coloredScreen().find((row) => Bun.stripANSI(row).includes(text))!;

test("the sidebar entries are painted with the sidebar background", async () => {
  await start();

  expect(rowWith("#random")).toContain(backgroundCode(theme.sidebarBackground));
});

test("the pane is painted with the pane background", async () => {
  await start();

  expect(rowWith("hello there")).toContain(
    backgroundCode(theme.paneBackground),
  );
});

test("the status bar is painted with the status bar background", async () => {
  await start();

  expect(app.coloredScreen().at(-1)).toContain(
    backgroundCode(theme.statusBarBackground),
  );
});

test("an open popup fills its whole area with the popup background and a border colour", async () => {
  await start();
  await app.press("?");
  await app.waitForScreen("Keyboard shortcuts");

  const popup = findPopup(app.screen(), "Keyboard shortcuts")!;
  const rows = app.coloredScreen();
  const popupRows = rows.slice(popup.top, popup.bottom);
  const interior = popupRows.slice(1, -1);

  expect(interior.length).toBeGreaterThan(5);

  for (const row of interior) {
    expect(row).toContain(backgroundCode(theme.popupBackground));
  }

  expect(popupRows[0]).toContain(backgroundCode(theme.popupBackground));
  expect(popupRows[0]).toContain("\u001b[38;2;134;134;134m");
});

test("no cell of the screen is left on the terminal's own background", async () => {
  await start();

  for (const row of app.coloredScreen()) {
    expect(cellsWithoutBackground(row)).toBe("");
  }

  await app.press("?");
  await app.waitForScreen("Keyboard shortcuts");

  for (const row of app.coloredScreen()) {
    expect(cellsWithoutBackground(row)).toBe("");
  }

  await app.press("?");
  await app.press(keys.ctrlK);
  await app.waitForScreen("> ");

  for (const row of app.coloredScreen()) {
    expect(cellsWithoutBackground(row)).toBe("");
  }
});
