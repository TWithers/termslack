import { afterEach, describe, expect, test } from "bun:test";
import { fitBorderLabels } from "../src/ui/borderLabels";
import {
  keysFitBorder,
  sidebarStatusLabel,
  threadKeyHints,
} from "../src/ui/app/statusLine";
import { applyTheme, defaultThemeName, theme } from "../src/ui/theme";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import {
  foregroundAt,
  foregroundCode,
  useTerminalColour,
} from "./support/colours";
import { reconnectPingTimeoutMs, waitFor } from "./support/fakeSlack";
import { sidebarStatus, statusLine } from "./support/panes";

useTerminalColour();

let app: AppHarness;

afterEach(async () => {
  await app.stop();
  applyTheme(defaultThemeName);
});

const parentTs = "1600000000.000001";
const newestTs = "1600000100.000001";

type Raw = Record<string, unknown>;

const parent: Raw = {
  type: "message",
  user: "U123ABC456",
  text: "parent text",
  ts: parentTs,
  thread_ts: parentTs,
  reply_count: 1,
};

const history: Raw[] = [
  { type: "message", user: "U222222222", text: "plain text", ts: newestTs },
  parent,
];

const dndFailure = "couldn't read Do Not Disturb";

async function start(
  options: Parameters<typeof startAppHarness>[0] & {
    dndFails?: boolean;
  } = {},
) {
  const { dndFails, ...rest } = options;

  app = await startAppHarness({
    columns: 160,
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
          parent,
          {
            type: "message",
            user: "U222222222",
            text: "first reply",
            ts: "1600000010.000001",
            thread_ts: parentTs,
          },
        ],
        has_more: false,
      }));

      if (dndFails) {
        slack.respond("dnd.info", () => ({ ok: false, error: "fatal_error" }));
      }

      await rest.prepare?.(slack);
    },
  });
  await waitFor(
    () => app.session.conversations().length > 0 && app.session.currentUserId,
    5000,
  );
}

async function openGeneral() {
  await app.press(keys.enter);
  await app.waitForScreen("plain text");
}

const line = () => statusLine(app.screen());

/** The sidebar is a third of the terminal, between 12 and 32 columns; the message pane starts after it. */
const sidebarColumns = (columns: number) =>
  Math.min(32, Math.max(12, Math.floor(columns / 3)));
const paneStatus = (columns: number) =>
  statusLine(app.screen(), sidebarColumns(columns));
/** The bottom border row of the message pane, coloured: the last row that has a `╰` at column 32. */
const coloredLine = () =>
  app
    .coloredScreen()
    .findLast((row) => Bun.stripANSI(row).slice(32).startsWith("╰"))!;

describe("keys for what has focus", () => {
  test("the sidebar's keys show while the sidebar has focus", async () => {
    await start();

    expect(line()).toContain("j/k move · Enter open");
    expect(line()).toContain("M hide muted");
  });

  test("the message keys show while the messages have focus, including i to write", async () => {
    await start();
    await openGeneral();
    await app.press(keys.tab);

    expect(line()).toContain("j/k select · i write");
    expect(line()).not.toContain("j/k move");
  });

  test("the input's keys show while the input has focus, and the placeholder no longer mentions i", async () => {
    await start();
    await openGeneral();
    await app.press(keys.tab);
    await app.press("i");

    expect(line()).toContain("Enter send");
    expect(line()).toContain("Esc back");
    expect(app.screen()).not.toContain("press i to write");
  });

  test("keys are drawn in the key hint colour, what they do in the secondary text colour", async () => {
    await start();

    expect(foregroundAt(coloredLine(), "j/k")).toBe(
      foregroundCode(theme.keyHintText),
    );
    expect(foregroundAt(coloredLine(), " move")).toBe(
      foregroundCode(theme.secondaryText),
    );
    expect(foregroundAt(coloredLine(), "?")).toBe(
      foregroundCode(theme.keyHintText),
    );
    expect(foregroundAt(coloredLine(), " help")).toBe(
      foregroundCode(theme.secondaryText),
    );
  });

  test("the thread pane shows its keys on its own bottom border while it has focus, and the message pane's line does not repeat them", async () => {
    await start();
    await openGeneral();
    await app.press(keys.tab);
    await app.press("k");
    await app.press(keys.enter);
    await app.waitForScreen("first reply");

    expect(statusLine(app.screen(), 96)).toContain("j/k select · i reply");
    expect(statusLine(app.screen(), 96)).toContain("Esc close thread");
    expect(statusLine(app.screen(), 32, 96)).not.toContain("j/k");
    expect(statusLine(app.screen(), 32, 96)).not.toContain("Esc");

    await app.press(keys.tab);
    await app.press(keys.tab);
    await app.press(keys.tab);

    expect(statusLine(app.screen(), 32, 96)).toContain("j/k select");
    expect(statusLine(app.screen(), 96)).not.toContain("j/k");
  });
});

describe("notices beat keys", () => {
  test("a notice shows in the warning colour in place of the keys", async () => {
    await start({ dndFails: true });
    await app.waitForScreen(dndFailure);

    expect(line()).toContain(dndFailure);
    expect(line()).not.toContain("j/k move");
    expect(foregroundAt(coloredLine(), dndFailure)).toBe(
      foregroundCode(theme.warning),
    );
  });

  test("a listing warning is a notice", async () => {
    await start({
      listingRetryDelaysMs: [60_000],
      prepare: (slack) =>
        slack.respond("users.list", () => ({
          ok: false,
          error: "ratelimited",
        })),
    });
    await waitFor(() => line().includes("couldn't load people"));

    expect(foregroundAt(coloredLine(), "couldn't load people")).toBe(
      foregroundCode(theme.warning),
    );
  });

  test("a notice that is too long is cut with an ellipsis and the border stays as wide as the pane", async () => {
    await start({ columns: 60, dndFails: true });
    await app.waitForScreen(/couldn't read/);

    const bottom = paneStatus(60);

    expect(bottom).toMatch(/^╰─ couldn't read .*… ─*╯$/);
    expect(bottom).not.toContain("so it is ignored");
    expect(Bun.stringWidth(bottom)).toBe(60 - sidebarColumns(60));
  });

  test("a notice shows on the status line, with the whole text in the session", async () => {
    await start({ dndFails: true });
    await app.waitForScreen(dndFailure);

    expect(app.session.dndNote()).toBe(
      "couldn't read Do Not Disturb, so it is ignored",
    );
    expect(line()).toContain("couldn't read Do Not Disturb, so it is ignored");
  });
});

describe("questions beat notices", () => {
  test("a y/n question shows in the prompt colour in place of a notice", async () => {
    await start({ dndFails: true });
    await app.waitForScreen(dndFailure);

    await app.press("x");

    expect(line()).toContain("Leave #general? y/n");
    expect(line()).not.toContain(dndFailure);
    expect(foregroundAt(coloredLine(), "Leave #general? y/n")).toBe(
      foregroundCode(theme.prompt),
    );

    await app.press("n");

    expect(line()).not.toContain("y/n");
  });

  test("a y/n question beats the keys too", async () => {
    await start();
    await app.press("x");

    expect(line()).toContain("Leave #general? y/n");
    expect(line()).not.toContain("j/k move");

    await app.press("n");

    expect(line()).toContain("j/k move");
  });
});

describe("the sidebar's bottom border", () => {
  test("shows the connection in the connection colour, and no user name", async () => {
    await start();

    expect(sidebarStatus(app.screen())).toContain("● connected");

    const row = app
      .coloredScreen()
      .findLast((each) => Bun.stripANSI(each).startsWith("╰"))!;

    expect(foregroundAt(row, "● connected")).toBe(
      foregroundCode(theme.connected),
    );
    expect(app.screen()).not.toContain("egon");
  });

  test("says reconnecting in the connecting colour while the socket is down", async () => {
    await start({ clientPingTimeout: reconnectPingTimeoutMs });

    app.slack.send({ type: "disconnect", reason: "refresh_requested" });

    await waitFor(() =>
      app.frames().some((frame) => frame.includes("● reconnecting")),
    );

    const frame = app
      .coloredFrames()
      .findLast((each) => Bun.stripANSI(each).includes("● reconnecting"))!;
    const row = frame
      .split("\n")
      .findLast((each) => Bun.stripANSI(each).startsWith("╰"))!;

    expect(foregroundAt(row, "● reconnecting")).toBe(
      foregroundCode(theme.connecting),
    );

    await waitFor(() => /\bconnected\b/.test(sidebarStatus(app.screen())));
  });

  test("adds 'muted hidden' while M hides muted channels", async () => {
    await start();
    await waitFor(() => app.session.unreadCheckProgress() === undefined);

    expect(sidebarStatus(app.screen())).not.toContain("muted hidden");

    await app.press("M");

    expect(sidebarStatus(app.screen())).toContain("● connected · muted hidden");

    await app.press("M");

    expect(sidebarStatus(app.screen())).not.toContain("muted hidden");
  });

  test("shows the unread check's progress after the connection while it runs", async () => {
    await start({
      unreadCheck: { concurrency: 1 },
      prepare: (slack) => {
        slack.respond("conversations.info", async ({ params }) => {
          await Bun.sleep(100);

          return {
            ok: true,
            channel: { id: params.channel, last_read: "1600000000.000000" },
          };
        });
      },
    });

    await app.waitForScreen(/● connected · Unreads \d+\/\d+/);
    await waitFor(() => app.session.unreadCheckProgress() === undefined);
    await waitFor(() => !sidebarStatus(app.screen()).includes("Unreads"));
  });

  test("while the check runs, 'muted hidden' still shows and the progress gives way", async () => {
    await start({
      unreadCheck: { concurrency: 1 },
      prepare: (slack) => {
        slack.respond("conversations.info", async ({ params }) => {
          await Bun.sleep(300);

          return {
            ok: true,
            channel: { id: params.channel, last_read: "1600000000.000000" },
          };
        });
      },
    });

    await app.press("M");

    expect(app.session.unreadCheckProgress()).toBeDefined();
    expect(sidebarStatus(app.screen())).toContain("● connected · muted hidden");
    expect(sidebarStatus(app.screen())).not.toContain("Unreads");
  });
});

describe("the sidebar's bottom border priority", () => {
  const sidebarInner = 30;
  const fitted = (
    width: number,
    options: { hideMuted: boolean; progress?: boolean },
  ) =>
    fitBorderLabels(width, {
      bottomLeft: sidebarStatusLabel({
        status: "connected",
        hideMuted: options.hideMuted,
        unreadProgress: options.progress ? { done: 12, total: 44 } : undefined,
      }).text,
    }).bottomLeft;

  test("'muted hidden' beats the unread progress at the sidebar's width", () => {
    expect(fitted(sidebarInner, { hideMuted: true, progress: true })).toBe(
      "● connected · muted hidden",
    );
  });

  test("the progress follows 'muted hidden' when there is room, in its longest form", () => {
    const hidden = { hideMuted: true, progress: true };

    expect(fitted(60, hidden)).toBe(
      "● connected · muted hidden · Checking unreads 12/44",
    );
    expect(fitted(50, hidden)).toBe(
      "● connected · muted hidden · Unreads 12/44",
    );
    expect(fitted(44, hidden)).toBe("● connected · muted hidden · 12/44");
  });

  test("without 'muted hidden' the progress shows in the longest form that fits", () => {
    const shown = { hideMuted: false, progress: true };

    expect(fitted(sidebarInner, shown)).toBe("● connected · 12/44");
    expect(fitted(31, shown)).toBe("● connected · Unreads 12/44");
    expect(fitted(40, shown)).toBe("● connected · Checking unreads 12/44");
  });
});

describe("the extra row", () => {
  test("there is no row under the boxes: both bottom borders are on the last row", async () => {
    await start();
    await openGeneral();

    const rows = app.screen().split("\n");

    expect(rows).toHaveLength(30);
    expect(rows.at(-1)).toMatch(/^╰.*╯╰.*╯$/);
  });
});

describe("narrow terminals", () => {
  test("the keys shorten and keep the last one, with the corners intact", async () => {
    await start({ columns: 70 });

    const bottom = paneStatus(70);

    expect(bottom).toMatch(/^╰─ j\/k move .*\? help ─*╯$/);
    expect(bottom).not.toContain("a all DMs");
    expect(Bun.stringWidth(bottom)).toBe(70 - sidebarColumns(70));
  });

  test("a very narrow pane keeps just its last key", async () => {
    await start({ columns: 50 });

    const bottom = paneStatus(50);

    expect(bottom).toMatch(/^╰─ (\? help|j\/k move · \? help) ─*╯$/);
    expect(Bun.stringWidth(bottom)).toBe(50 - sidebarColumns(50));
  });

  test("a y/n question too long for the line is cut in the middle and keeps its '? y/n'", async () => {
    await start({ columns: 33 });
    await app.press("x");

    const bottom = paneStatus(33);

    expect(bottom).toMatch(/^╰─ Leave #g\S*…\? y\/n ─*╯$/);
  });

  test("the thread's keys move to the message pane's border when not even the shortest form fits the thread's", () => {
    expect(keysFitBorder(threadKeyHints, 50)).toBe(true);
    expect(keysFitBorder(threadKeyHints, 20)).toBe(false);
    expect(keysFitBorder("j/k select · Esc", 8)).toBe(false);
  });

  test("with a thread covering the conversation on a narrow terminal, the thread's border carries the status line", async () => {
    await start({ columns: 90 });
    await openGeneral();
    await app.press(keys.tab);
    await app.press("k");
    await app.press(keys.enter);
    await app.waitForScreen("first reply");

    expect(paneStatus(90)).toContain("j/k select");

    await app.press("e");

    expect(paneStatus(90)).toContain("You can only edit your own");
    expect(paneStatus(90)).not.toContain("j/k");
  });

  test("the sidebar's border keeps the connection in the narrowest sidebar", async () => {
    await start({ columns: 30 });

    expect(sidebarStatus(app.screen(), 12)).toMatch(/^╰.*(●|…).*╯/);
  });
});

describe("theme changes", () => {
  test("the status line takes the new theme's colours", async () => {
    await start({ dndFails: true });
    await app.waitForScreen(dndFailure);

    applyTheme("catppuccin");
    await app.press(keys.down);
    await app.press(keys.up);

    expect(foregroundAt(coloredLine(), dndFailure)).toBe(
      foregroundCode(theme.warning),
    );
  });
});
