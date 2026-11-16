import { afterEach, describe, expect, test } from "bun:test";
import { applyTheme, defaultThemeName, theme } from "../src/ui/theme";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import { waitFor } from "./support/fakeSlack";
import { findPopup, type Popup } from "./support/popup";
import { sidebarStatus, statusLine } from "./support/panes";

let app: AppHarness;

afterEach(async () => {
  await app.stop();
  applyTheme(defaultThemeName);
});

async function start(columns = 120, rows = 30) {
  app = await startAppHarness({ columns, rows });
  await app.waitForScreen("Channe", 5000);
  await waitFor(() => app.session.currentUserId);
  await waitFor(() => app.session.conversations().length > 0);
}

const popups: {
  name: string;
  title: string;
  open: () => Promise<void>;
  keys: string;
}[] = [
  {
    name: "help",
    title: "Keyboard shortcuts",
    open: () => app.press("?"),
    keys: "Esc or ? close",
  },
  {
    name: "quick switcher",
    title: "Switch conversation",
    open: () => app.press(keys.ctrlK),
    keys: "Enter open",
  },
  {
    name: "search results",
    title: "Search messages",
    open: () => app.press("/"),
    keys: "Enter search or open",
  },
  {
    name: "theme picker",
    title: "Theme",
    open: () => app.press("T"),
    keys: "Enter keep and save",
  },
  {
    name: "channel menu",
    title: "#general",
    open: () => app.press("m"),
    keys: "Enter/letter choose",
  },
];

const popup = (title: string): Popup => findPopup(app.screen(), title)!;

describe("a popup's title is on its top border and its keys on its bottom border", () => {
  for (const { name, title, open, keys: shown } of popups) {
    test(name, async () => {
      await start();
      await open();
      await app.waitForScreen(title);

      const box = popup(title);

      expect(box.topBorder).toMatch(new RegExp(`^╭─ ${title} ─+╮$`));
      expect(box.bottomBorder).toMatch(/^╰─ .+ ─+╯$/);
      expect(box.bottomBorder).toContain(shown);
      expect(box.rows.join("")).not.toContain(title);
      expect(box.rows.join("")).not.toContain(shown);
    });
  }

  test("channel details", async () => {
    await start();
    await app.press("m");
    await app.press("d");
    await app.waitForScreen("#general details");

    const box = popup("#general details");

    expect(box.topBorder).toMatch(/^╭─ #general details ─+╮$/);
    expect(box.bottomBorder).toContain("j/k scroll");
    expect(box.bottomBorder).toContain("Esc close");
  });

  test("the status line shows no keys while a popup is open", async () => {
    await start();
    await app.press(keys.ctrlK);
    await app.waitForScreen("Switch conversation");

    const line = statusLine(app.screen());

    expect(sidebarStatus(app.screen())).toContain("● connected");
    expect(line).not.toContain("Enter open");
    expect(line).not.toContain("j/k move");
  });
});

describe("in a narrow terminal the border keeps its corners and its title", () => {
  test("the keys shorten, keeping the last one", async () => {
    await start(52, 24);
    await app.press("?");
    await app.waitForScreen("Keyboard shortcuts");

    const box = popup("Keyboard shortcuts");

    expect(box.topBorder).toMatch(/^╭─ Keyboard shortcuts ─+╮$/);
    expect(box.bottomBorder).toMatch(/^╰─ .*Esc or \? close ─+╯$/);
    expect(box.bottomBorder).not.toContain("g/G");
    expect([...box.bottomBorder]).toHaveLength(box.right - box.left);
  });

  test("a title too long for the border ends in an ellipsis", async () => {
    await start(30, 24);
    await app.press("?");
    await app.waitForScreen("Keyboard");

    const box = popup("Keyboard");

    expect(box.topBorder).toMatch(/^╭─ Keyboard…? .*─*╮$/);
    expect(box.topBorder.startsWith("╭")).toBe(true);
    expect(box.topBorder.endsWith("╮")).toBe(true);
    expect(box.bottomBorder.startsWith("╰")).toBe(true);
    expect(box.bottomBorder.endsWith("╯")).toBe(true);
    expect([...box.topBorder]).toHaveLength(box.right - box.left);
  });
});

describe("colours follow the theme", () => {
  const code = (kind: 38 | 48, colour: string) => {
    const [red, green, blue] = [1, 3, 5].map((at) =>
      Number.parseInt(colour.slice(at, at + 2), 16),
    );

    return `\u001b[${kind};2;${red};${green};${blue}m`;
  };
  const row = (text: string) =>
    app.coloredScreen().find((line) => Bun.stripANSI(line).includes(text))!;

  test("the border, title and keys are painted from the theme, and again after a theme change", async () => {
    await start();
    await app.press("T");
    await app.waitForScreen("Theme");

    const check = () => {
      const top = row("╭─ Theme");
      const bottom = row("╰─ ↑/↓ preview");

      expect(top).toContain(code(38, theme.popupBorder));
      expect(top).toContain(code(38, theme.popupTitle));
      expect(top).toContain(code(48, theme.popupBackground));
      expect(bottom).toContain(code(38, theme.popupBorder));
      expect(bottom).toContain(code(38, theme.secondaryText));
      expect(bottom).toContain(code(38, theme.keyHintText));
      expect(bottom).toContain(code(48, theme.popupBackground));
    };

    check();

    const before = { ...theme };

    await app.press(keys.down);
    await waitFor(() => theme.popupBackground !== before.popupBackground);
    await waitFor(() =>
      row("╭─ Theme").includes(code(48, theme.popupBackground)),
    );

    check();
    expect(row("╭─ Theme")).not.toContain(code(48, before.popupBackground));
  });
});
