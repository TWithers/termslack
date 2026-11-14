import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import chalk from "chalk";
import { rm } from "node:fs/promises";
import { saveThemeChoice } from "../src/config/config";
import { configFile } from "../src/config/paths";
import { applyTheme, defaultThemeName, theme } from "../src/ui/theme";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import { waitFor } from "./support/fakeSlack";
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

afterEach(async () => {
  await app.stop();
  applyTheme(defaultThemeName);
  await rm(configFile, { force: true, recursive: true });
});

const other = "U222222222";
const parentTs = "1600000000.000001";
const title = "Theme";

const parent = {
  type: "message",
  user: other,
  text: "hello there",
  ts: parentTs,
  thread_ts: parentTs,
  reply_count: 1,
};
const reply = {
  type: "message",
  user: other,
  text: "a reply",
  ts: "1600000010.000001",
  thread_ts: parentTs,
};

function colourCode(kind: 38 | 48, colour: string): string {
  const [red, green, blue] = [1, 3, 5].map((at) =>
    Number.parseInt(colour.slice(at, at + 2), 16),
  );

  return `\u001b[${kind};2;${red};${green};${blue}m`;
}

async function start(options: Parameters<typeof startAppHarness>[0] = {}) {
  app = await startAppHarness({
    columns: 100,
    rows: 30,
    ...options,
    prepare: (slack) => {
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [parent],
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
  await app.waitForScreen("hello there");
}

const rowWith = (text: string) =>
  app.coloredScreen().find((row) => Bun.stripANSI(row).includes(text))!;
/** The escape that sets the colour of the author's name above the message (not the sidebar's entry for them). */
const authorColourCode = () =>
  /(\u001b\[38;2;[\d;]+m)Peter Venkman/.exec(
    app
      .coloredScreen()
      .filter((row) => Bun.stripANSI(row).includes(" Peter Venkman"))
      .at(-1)!,
  )![1];
const popupRows = () => findPopup(app.screen(), title)?.rows ?? [];
const statusBar = () => app.screen().trimEnd().split("\n").at(-1)!;
const listed = () =>
  popupRows()
    .slice(1)
    .map((line) => line.replace(/^\s*(› )?/, "").trimEnd())
    .filter(Boolean);
const highlighted = () =>
  popupRows()
    .find((line) => line.trimStart().startsWith("›"))
    ?.replace(/^\s*› /, "")
    .trimEnd();

async function type(text: string) {
  for (const character of text) {
    await app.press(character);
  }
}

test("T opens the theme popup from the sidebar, listing slack-dark first, then the others alphabetically, with the one in use marked and highlighted", async () => {
  await start();
  await app.press("T");

  expect(app.screen()).toContain(title);

  const names = listed().map((line) => line.split(" ")[0]);

  expect(names.slice(0, 4)).toEqual([
    "slack-dark",
    "catppuccin",
    "catppuccin-latte",
    "ethereal",
  ]);
  expect(listed()[0]).toBe("slack-dark in use");
  expect(listed()[2]).toBe("catppuccin-latte light");
  expect(highlighted()).toBe("slack-dark in use");
  expect(findPopup(app.screen(), title)!.bottomBorder).toContain(
    "Enter keep and save",
  );
  expect(statusBar()).not.toContain("Enter keep and save");
});

test("the highlighted row starts on the theme in use", async () => {
  applyTheme("nord");
  await start();
  await app.press("T");

  expect(highlighted()).toBe("nord in use");
});

test("T opens it from the message pane and from the thread pane too", async () => {
  await start();
  await openGeneral();
  await app.press(keys.tab);
  await app.press("T");

  expect(app.screen()).toContain(title);

  await app.press(keys.escape);
  await app.press("t");
  await app.waitForScreen("a reply");
  await app.press("T");

  expect(app.screen()).toContain(title);
});

test("T typed in an input box is a T", async () => {
  await start();
  await openGeneral();
  await app.press(keys.tab);
  await app.press("i");
  await app.press("T");

  expect(app.screen()).not.toContain(title);
  expect(app.screen()).toContain("T");
  expect(app.screen()).not.toContain("Message #general");
});

test("the help lists T", async () => {
  await start();
  await app.press("?");
  await app.waitForScreen("Keyboard shortcuts");

  expect(app.screen()).toContain("Choose the theme");
});

test("moving the highlighted row repaints the sidebar, a message row, the status bar and the popup in that theme", async () => {
  await start();
  await openGeneral();

  const before = { ...theme };
  const authorBefore = authorColourCode();

  await app.press("T");
  await app.press(keys.down);

  expect(highlighted()).toBe("catppuccin");
  expect(theme.paneBackground).not.toBe(before.paneBackground);

  await waitFor(() =>
    rowWith("#random").includes(colourCode(48, theme.sidebarBackground)),
  );

  const sidebar = rowWith("#random");
  const message = rowWith("hello there");

  expect(sidebar).not.toContain(colourCode(48, before.sidebarBackground));
  expect(message).toContain(colourCode(48, theme.paneBackground));
  expect(message).toContain(colourCode(38, theme.text));
  expect(message).not.toContain(colourCode(48, before.paneBackground));
  expect(message).not.toContain(colourCode(38, before.text));
  expect(authorColourCode()).not.toBe(authorBefore);
  expect(app.coloredScreen().at(-1)).toContain(
    colourCode(48, theme.statusBarBackground),
  );
  expect(rowWith(title)).toContain(colourCode(48, theme.popupBackground));
  expect(rowWith("catppuccin")).toContain(
    colourCode(48, theme.selectionBackground),
  );
});

test("a move repaints in one pass: no frame drawn after the key still has the previous theme's pane background", async () => {
  await start();
  await openGeneral();
  await app.press("T");

  const previous = colourCode(48, theme.paneBackground);
  const drawn = app.coloredFrames().length;

  await app.press(keys.down);

  const after = app.coloredFrames().slice(drawn);

  expect(after.length).toBeGreaterThan(0);
  expect(after.some((frame) => frame.includes(previous))).toBe(false);

  await type("nord");

  const typed = app.coloredFrames().slice(drawn + after.length);

  expect(typed.some((frame) => frame.includes(colourCode(48, "#2e3440")))).toBe(
    true,
  );
});

test("a thread's rows repaint too", async () => {
  await start();
  await openGeneral();
  await app.press(keys.tab);
  await app.press("t");
  await app.waitForScreen("a reply");

  const before = { ...theme };
  const authorBefore = authorColourCode();

  await app.press("T");
  await app.press(keys.down);
  await waitFor(() => theme.text !== before.text);

  expect(authorColourCode()).not.toBe(authorBefore);

  const reply = rowWith("a reply");

  expect(reply).toContain(colourCode(38, theme.text));
  expect(reply).not.toContain(colourCode(38, before.text));
});

test("the help repaints too", async () => {
  await start();
  await app.press("?");
  await app.waitForScreen("Keyboard shortcuts");
  await app.press("?");

  const before = { ...theme };

  await app.press("T");
  await type("nord");
  await app.press(keys.enter);
  await app.press("?");
  await app.waitForScreen("Keyboard shortcuts");

  expect(theme.helpKeyText).not.toBe(before.helpKeyText);
  expect(rowWith("Show this help")).toContain(
    colourCode(38, theme.helpKeyText),
  );
});

test("typing filters the list by name and previews the first match", async () => {
  await start();
  await app.press("T");
  await type("nord");

  expect(listed()).toEqual(["nord"]);
  expect(highlighted()).toBe("nord");
  expect(app.screen()).toContain("> nord");
  expect(theme.paneBackground).toBe("#2e3440");

  await app.press(keys.backspace);
  await app.press(keys.backspace);
  await app.press(keys.backspace);
  await app.press(keys.backspace);

  expect(listed()).toHaveLength(10);
  expect(highlighted()).toBe("slack-dark in use");
  expect(theme.paneBackground).toBe("#1a1d21");
});

test("Enter keeps the theme, closes the popup and writes theme to config.toml, keeping the rest of the file", async () => {
  await Bun.write(
    configFile,
    '# my termslack\nbell = false\ntheme = "gruvbox" # old\n\n[workspaces.T1]\nname = "Acme"\n',
  );
  await start({ saveTheme: saveThemeChoice });
  await app.press("T");
  await type("nord");
  await app.press(keys.enter);

  expect(app.screen()).not.toContain(title);
  expect(theme.paneBackground).toBe("#2e3440");
  await waitFor(async () =>
    (await Bun.file(configFile).text()).includes('theme = "nord"'),
  );
  expect(await Bun.file(configFile).text()).toBe(
    '# my termslack\nbell = false\ntheme = "nord"\n\n[workspaces.T1]\nname = "Acme"\n',
  );
});

test("a theme that can't be saved is kept, and the status bar says so", async () => {
  await start({
    saveTheme: async () => {
      throw new Error("disk full");
    },
  });
  await app.press("T");
  await type("nord");
  await app.press(keys.enter);
  await app.waitForScreen("Couldn't save the theme");

  expect(statusBar()).toContain("disk full");
  expect(theme.paneBackground).toBe("#2e3440");
});

test("Esc closes the popup and puts back the theme from when it opened, saving nothing", async () => {
  applyTheme("gruvbox");
  await start({ saveTheme: saveThemeChoice });

  const before = { ...theme };

  await app.press("T");
  await type("white");
  expect(theme.paneBackground).not.toBe(before.paneBackground);

  await app.press(keys.escape);

  expect(app.screen()).not.toContain(title);
  expect(theme.paneBackground).toBe(before.paneBackground);
  expect(rowWith("#random")).toContain(
    colourCode(48, before.sidebarBackground),
  );
  expect(await Bun.file(configFile).exists()).toBe(false);
});
