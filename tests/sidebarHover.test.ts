import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import chalk from "chalk";
import { theme } from "../src/ui/theme";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";

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

const sidebarWidth = 32;

/** The escape that sets a 24-bit background, as Ink writes it. */
function backgroundCode(colour: string): string {
  const [red, green, blue] = [1, 3, 5].map((at) =>
    Number.parseInt(colour.slice(at, at + 2), 16),
  );

  return `\u001b[48;2;${red};${green};${blue}m`;
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
            user: "U222222222",
            text: "hello there",
            ts: "1600000000.000001",
          },
        ],
        has_more: false,
      }));
    },
  });
  await app.waitForScreen("#general", 5000);
  await app.waitForScreen("@Peter Venkman, stantz");
}

/** The screen row of the sidebar line showing `text`. */
const rowOf = (text: string) =>
  app
    .screen()
    .split("\n")
    .findIndex((row) => row.slice(0, sidebarWidth).includes(text));

const colouredRow = (text: string) => app.coloredScreen()[rowOf(text)]!;

const isHovered = (text: string) =>
  colouredRow(text).includes(backgroundCode(theme.sidebarHoverBackground));

/** Which sidebar rows are drawn with the hover background. */
const hoveredRows = () =>
  app
    .coloredScreen()
    .slice(0, 12)
    .filter((row) => row.includes(backgroundCode(theme.sidebarHoverBackground)))
    .map((row) => Bun.stripANSI(row).slice(0, sidebarWidth).trim());

test("the entry under the pointer is drawn with the hover background across the sidebar's width, and it moves with the pointer", async () => {
  await start();

  expect(hoveredRows()).toEqual([]);

  await app.hover(5, rowOf("#random"));
  expect(hoveredRows()).toEqual([expect.stringContaining("#random")]);

  const hovered = colouredRow("#random");
  const filled = hovered.slice(
    hovered.indexOf(backgroundCode(theme.sidebarHoverBackground)),
  );

  expect(Bun.stripANSI(filled).length).toBeGreaterThanOrEqual(sidebarWidth - 4);

  await app.hover(5, rowOf("@stantz"));
  expect(isHovered("@stantz")).toBe(true);
  expect(isHovered("#random")).toBe(false);
});

test("a section heading is hovered too", async () => {
  await start();

  const heading = app
    .screen()
    .split("\n")
    .findIndex((row) => /^│ [▾▸]/.test(row));

  expect(heading).toBeGreaterThanOrEqual(0);

  await app.hover(2, heading);
  expect(hoveredRows()).toHaveLength(1);
  expect(
    app
      .coloredScreen()
      [heading]!.includes(backgroundCode(theme.sidebarHoverBackground)),
  ).toBe(true);
});

test("hover clears when the pointer leaves the sidebar, moves to an empty row or over the messages", async () => {
  await start();
  await app.press(keys.enter);
  await app.waitForScreen("hello there");

  await app.hover(5, rowOf("#random"));
  expect(isHovered("#random")).toBe(true);

  await app.hover(sidebarWidth + 10, rowOf("#random"));
  expect(hoveredRows()).toEqual([]);

  await app.hover(5, rowOf("#random"));
  await app.hover(5, 25);
  expect(hoveredRows()).toEqual([]);
});

test("hover clears when the terminal loses focus", async () => {
  await start();
  await app.hover(5, rowOf("#random"));
  expect(isHovered("#random")).toBe(true);

  await app.loseTerminalFocus();
  expect(hoveredRows()).toEqual([]);
});

test("hover clears when a popup opens, and motion over a popup hovers nothing underneath", async () => {
  await start();
  await app.hover(5, rowOf("#random"));
  expect(isHovered("#random")).toBe(true);

  await app.press("?");
  await app.waitForScreen("Keyboard shortcuts");
  expect(hoveredRows()).toEqual([]);

  await app.hover(5, rowOf("#random"));
  expect(hoveredRows()).toEqual([]);

  await app.press(keys.escape);
  expect(hoveredRows()).toEqual([]);
});

test("hover never changes focus, selection or the open conversation, and a drag counts as motion", async () => {
  await start();

  const before = app.screen();

  await app.hover(5, rowOf("#random"));
  await app.mouse(`\x1b[<32;6;${rowOf("#random") + 1}M`);

  const after = app.screen().split("\n");

  expect(after).toEqual(before.split("\n"));
  expect(after.at(-1)).toContain("Acme · ");
});

test("the selected row keeps the selection's colours when it is hovered, and the open marker stays", async () => {
  await start();
  await app.press(keys.enter);
  await app.waitForScreen("hello there");

  const selected = rowOf("#general");

  expect(colouredRow("#general")).toContain(
    backgroundCode(theme.selectionBackground),
  );

  await app.hover(5, selected);
  expect(isHovered("#general")).toBe(false);
  expect(colouredRow("#general")).toContain(
    backgroundCode(theme.selectionBackground),
  );
  expect(app.screen().split("\n")[selected]).toContain("›▌");
});

test("an open conversation that is not selected shows its marker under the hover", async () => {
  await start();
  await app.press(keys.enter);
  await app.waitForScreen("hello there");
  await app.press("j");

  await app.hover(5, rowOf("▌"));
  expect(isHovered("▌")).toBe(true);
  expect(colouredRow("▌")).not.toContain(
    backgroundCode(theme.selectionBackground),
  );
});

test("a stream of motion reports over one row draws once, and motion outside the sidebar with nothing hovered draws nothing", async () => {
  await start();

  const row = rowOf("#random");

  await app.hover(5, row);

  const drawn = app.frames().length;

  for (const column of [3, 6, 9, 12, 8, 4]) {
    await app.hover(column, row);
  }

  expect(app.frames()).toHaveLength(drawn);

  await app.hover(sidebarWidth + 10, row);
  expect(app.frames()).toHaveLength(drawn + 1);

  for (const column of [40, 50, 60, 70]) {
    await app.hover(column, 5);
  }

  expect(app.frames()).toHaveLength(drawn + 1);
});

test("hover clears while a y/n question is showing, and comes back once it is answered", async () => {
  await start();
  await app.hover(5, rowOf("#random"));
  expect(isHovered("#random")).toBe(true);

  await app.press("x");
  await app.waitForScreen("y/n");
  expect(hoveredRows()).toEqual([]);

  await app.press("n");
  expect(app.screen()).not.toContain("y/n");
  await app.hover(5, rowOf("#random"));
  expect(isHovered("#random")).toBe(true);
});
