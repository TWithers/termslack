import { afterEach, describe, expect, test } from "bun:test";
import { applyTheme, defaultThemeName, theme } from "../src/ui/theme";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import {
  foregroundAt,
  foregroundCode,
  useTerminalColour,
} from "./support/colours";
import { waitFor } from "./support/fakeSlack";
import { loadFixture } from "./support/fixtures";
import { sidebarRows } from "./support/panes";

useTerminalColour();

let app: AppHarness;

afterEach(async () => {
  await app.stop();
  applyTheme(defaultThemeName);
});

const parentTs = "1600000000.000001";
const newestTs = "1600000100.000001";

type Raw = Record<string, unknown>;

const history: Raw[] = [
  { type: "message", user: "U222222222", text: "plain text", ts: newestTs },
  {
    type: "message",
    user: "U123ABC456",
    text: "parent text",
    ts: parentTs,
    thread_ts: parentTs,
    reply_count: 2,
  },
];

async function start(
  options: Parameters<typeof startAppHarness>[0] & { members?: number } = {},
) {
  const { members, ...rest } = options;

  app = await startAppHarness({
    columns: 120,
    rows: 30,
    ...rest,
    prepare: async (slack) => {
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: history,
        has_more: false,
      }));
      slack.respond("conversations.replies", () => ({
        ok: true,
        messages: [
          history[1],
          {
            type: "message",
            user: "U222222222",
            text: "first reply",
            ts: "1600000010.000001",
            thread_ts: parentTs,
          },
          {
            type: "message",
            user: "U222222222",
            text: "second reply",
            ts: "1600000020.000001",
            thread_ts: parentTs,
          },
        ],
        has_more: false,
      }));

      if (members !== undefined) {
        const [channels, directs] = await Promise.all([
          loadFixture("users-conversations-channels"),
          loadFixture("users-conversations-dms"),
        ]);

        slack.respondPaged("users.conversations", [
          {
            ...channels[0]!,
            channels: channels[0]!.channels.map((channel: Raw) => ({
              ...channel,
              num_members: members,
            })),
          },
          directs[0]!,
        ]);
      }

      await rest.prepare?.(slack);
    },
  });
  await waitFor(
    () =>
      app.screen().split("\n").length === (rest.rows ?? 30) &&
      app.session.conversations().length > 0 &&
      app.session.currentUserId,
    5000,
  );
}

/** Opens #general (Enter on the first sidebar entry that is selected) and waits for its messages. */
async function openGeneral() {
  await app.press(keys.enter);
  await app.waitForScreen("plain text");
}

const lines = () => app.screen().split("\n");
const topBorder = () => lines()[0]!;
/** The message pane's part of the top border: from column 32 to the next box's edge or the end. */
const paneTop = (from = 32, to?: number) => topBorder().slice(from, to);

/** Which boxes' top borders are drawn in the focus colour, left to right. */
function focusedBoxes(): boolean[] {
  const row = app.coloredScreen()[0]!;
  const boxes = (row.match(/╭─/g) ?? []).length;

  return Array.from(
    { length: boxes },
    (_, box) => foregroundAt(row, "╭─", box) === foregroundCode(theme.focus),
  );
}

describe("titles", () => {
  test("the sidebar is a box titled with the workspace name", async () => {
    await start();

    expect(topBorder()).toMatch(/^╭─ Acme ─+╮╭─/);
    expect(lines().findIndex((line) => line.startsWith("╰"))).toBe(28);
    expect(sidebarRows(app.screen())[0]!.trim()).toBe("▾ Channels");
  });

  test("with no conversation open the message pane box says so", async () => {
    await start();

    expect(paneTop()).toMatch(/^╭─ No conversation open ─+╮$/);
    expect(lines().findIndex((line) => line.slice(32).startsWith("╰"))).toBe(
      28,
    );
  });

  test("a channel is titled with its name, and with its member count when Slack gave one", async () => {
    await start({ members: 120 });
    await openGeneral();

    expect(paneTop()).toMatch(/^╭─ #general ─+ 120 members ─╮$/);
  });

  test("a channel with no known member count has only its name", async () => {
    await start();
    await openGeneral();

    expect(paneTop()).toMatch(/^╭─ #general ─+╮$/);
  });

  test("a group DM is titled with the names of the people in it, and has no right-hand label", async () => {
    await start();
    await app.waitForScreen("@Peter Venkman, stantz");

    for (let down = 0; down < 4; down++) {
      await app.press(keys.down);
    }

    await app.press(keys.enter);
    await app.waitForScreen("╭─ @Peter Venkman, stantz");
    expect(paneTop()).toMatch(/^╭─ @Peter Venkman, stantz ─+╮$/);
  });

  test("the thread pane is titled Thread with its reply count", async () => {
    await start({ columns: 140 });
    await openGeneral();
    await app.press(keys.tab);
    await app.press("k");
    await app.press(keys.enter);
    await app.waitForScreen("first reply");

    expect(topBorder().slice(32 + 54)).toMatch(/^╭─ Thread ─+ 2 replies ─╮$/);
  });

  test("the thread pane box has no reply count while the thread has no replies yet", async () => {
    await start({ columns: 140 });
    await openGeneral();
    await app.press(keys.tab);
    await app.press(keys.enter);
    await app.waitForScreen(/Thread/);

    expect(topBorder().slice(32 + 54)).toMatch(/^╭─ Thread ─+╮$/);
  });

  test("with the thread closed the message pane box takes the full width", async () => {
    await start();
    await openGeneral();

    expect([...paneTop()]).toHaveLength(88);
    expect(paneTop().endsWith("╮")).toBe(true);
  });
});

describe("focus", () => {
  test("the focused box's border and title are in the focus colour, the others in the border colour", async () => {
    await start();
    await openGeneral();

    expect(focusedBoxes()).toEqual([true, false]);

    await app.press(keys.tab);
    expect(focusedBoxes()).toEqual([false, true]);

    await app.press("i");
    expect(focusedBoxes()).toEqual([false, true]);

    await app.press(keys.escape);
    await app.press(keys.tab);
    expect(focusedBoxes()).toEqual([false, true]);

    await app.press(keys.tab);
    expect(focusedBoxes()).toEqual([true, false]);
  });

  test("the title is drawn in the same colour as its border", async () => {
    await start();
    await openGeneral();
    await app.press(keys.tab);

    const row = app.coloredScreen()[0]!;

    expect(foregroundAt(row, " #general ")).toBe(foregroundCode(theme.focus));
    expect(foregroundAt(row, " Acme ")).toBe(foregroundCode(theme.border));
  });

  test("the thread pane is focused while the thread or its input has focus", async () => {
    await start({ columns: 140 });
    await openGeneral();
    await app.press(keys.tab);
    await app.press("k");
    await app.press(keys.enter);
    await app.waitForScreen("first reply");

    expect(focusedBoxes()).toEqual([false, false, true]);

    await app.press("i");
    expect(focusedBoxes()).toEqual([false, false, true]);

    await app.press(keys.escape);
    await app.press(keys.escape);
    expect(focusedBoxes()).toEqual([false, true]);
  });

  test("a theme change recolours the borders and titles", async () => {
    await start();
    await openGeneral();

    const before = { focus: theme.focus, border: theme.border };

    await app.press("T");
    await app.press(keys.down);

    expect(theme.focus).not.toBe(before.focus);
    await waitFor(() => {
      const row = app.coloredScreen()[0]!;

      return foregroundAt(row, " Acme ") === foregroundCode(theme.focus);
    });

    const row = app.coloredScreen()[0]!;

    expect(foregroundAt(row, " #general ")).toBe(foregroundCode(theme.border));
    expect(row).not.toContain(foregroundCode(before.focus));
  });
});

describe("padding", () => {
  test("the messages have one space between them and the border on each side", async () => {
    await start();
    await openGeneral();

    const row = lines().find((line) => line.includes("plain text"))!;

    expect(row.slice(32, 36)).toMatch(/^│ {2,3}/);
    expect(row.slice(32).startsWith("│ ")).toBe(true);
    expect(row.endsWith(" │")).toBe(true);
    expect(row.slice(32).trimEnd().endsWith("│")).toBe(true);
  });

  test("long messages wrap before the padding on the right", async () => {
    await start({
      prepare: (slack) =>
        slack.respond("conversations.history", () => ({
          ok: true,
          messages: [
            {
              type: "message",
              user: "U222222222",
              text: Array.from({ length: 40 }, (_, i) => `word${i}`).join(" "),
              ts: newestTs,
            },
          ],
          has_more: false,
        })),
    });
    await app.press(keys.enter);
    await app.waitForScreen("word39");

    const wrapped = lines().filter((line) => /word\d+/.test(line.slice(32)));

    expect(wrapped.length).toBeGreaterThan(1);

    for (const line of wrapped) {
      expect(Bun.stringWidth(line)).toBe(120);
      expect(line.endsWith(" │")).toBe(true);
    }
  });
});

describe("the mouse lands on what is drawn", () => {
  test("a click on a sidebar row opens that conversation, and the border rows do nothing", async () => {
    await start();

    const row = lines().findIndex((line) => line.includes("#random"));

    await app.click(5, 0);
    expect(app.screen()).toContain("No conversation open");

    await app.click(5, row);
    await app.waitForScreen("╭─ #random");
    expect(paneTop()).toMatch(/^╭─ #random ─+╮$/);

    await app.click(5, 28);
    expect(paneTop()).toMatch(/^╭─ #random ─+╮$/);
  });

  test("a click on a message row selects that message", async () => {
    await start();
    await openGeneral();
    await app.press(keys.tab);

    const row = lines().findIndex((line) => line.includes("parent text"));

    await app.click(60, row);

    const selected = lines().find((line) => line.slice(32).startsWith("│ ▌"));

    expect(selected).toContain("parent text");
  });

  test("a click on the top border of the pane focuses it and selects nothing new", async () => {
    await start();
    await openGeneral();
    await app.click(60, 0);

    expect(focusedBoxes()).toEqual([false, true]);
  });

  test("hover lands on the row drawn under the pointer", async () => {
    await start();

    const row = lines().findIndex((line) => line.includes("#random"));

    await app.hover(5, row);
    expect(hoveredText()).toEqual(["#random"]);

    await app.hover(5, 0);
    expect(hoveredText()).toEqual([]);

    await app.hover(5, 28);
    expect(hoveredText()).toEqual([]);
  });

  test("the wheel over the pane scrolls its messages", async () => {
    await start();
    await openGeneral();
    await app.press(keys.tab);

    await app.wheel("up", 60, 5);

    const selected = lines().find((line) => line.slice(32).startsWith("│ ▌"));

    expect(selected).toContain("parent text");
  });
});

function hoveredText(): string[] {
  const hover = `\u001b[48;2;${[1, 3, 5]
    .map((at) =>
      Number.parseInt(theme.sidebarHoverBackground.slice(at, at + 2), 16),
    )
    .join(";")}m`;

  return app
    .coloredScreen()
    .filter((row) => row.includes(hover))
    .map((row) => Bun.stripANSI(row).slice(1, 31).trim());
}

describe("narrow terminals", () => {
  test("the right-hand label goes first, then the title is cut, and the corners stay", async () => {
    await start({ columns: 40, rows: 20, members: 120 });
    await app.press(keys.enter);
    await app.waitForScreen("plain text");

    expect(paneTop().length).toBeGreaterThan(0);

    const width = 40;

    for (const line of lines().slice(0, 18)) {
      expect(Bun.stringWidth(line)).toBeLessThanOrEqual(width);
    }

    const pane = topBorder().slice(13);

    expect(pane.startsWith("╭")).toBe(true);
    expect(pane.endsWith("╮")).toBe(true);
    expect(pane).toContain("#general");
    expect(pane).not.toContain("members");
  });

  test("a title too long for the box is cut with an ellipsis", async () => {
    await start({ columns: 36, rows: 20 });

    const top = topBorder();

    expect(top.startsWith("╭")).toBe(true);
    expect(top.endsWith("╮")).toBe(true);
    expect(top).toContain("…");
    expect(Bun.stringWidth(top)).toBe(36);
  });
});
