import { afterEach, expect, test } from "bun:test";
import { loadPayload } from "./support/fixtures";
import { waitFor } from "./support/fakeSlack";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import {
  foregroundAt,
  foregroundCode,
  useTerminalColour,
} from "./support/colours";
import { theme } from "../src/ui/theme";

useTerminalColour();

let app: AppHarness;

afterEach(() => app.stop());

const general = "C012AB3CD";

/** Message `n` of a conversation whose messages are numbered oldest (1) to newest. */
function numbered(n: number, text = `msg ${String(n).padStart(4, "0")}`) {
  return {
    type: "message",
    user: "U222222222",
    text,
    ts: `1600000000.${String(n).padStart(6, "0")}`,
  };
}

/** Slack's history pages for messages 1..count: newest first, `size` per page. */
function historyPages(
  count: number,
  size = 50,
  text?: (n: number) => string | undefined,
) {
  const pages: Record<string, unknown>[] = [];

  for (let high = count; high > 0; high -= size) {
    const low = Math.max(1, high - size + 1);
    const messages = [];

    for (let n = high; n >= low; n--) {
      messages.push(numbered(n, text?.(n)));
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

/** 16 rows: a 15-row body, a 13-row box inside its border, a 10-line message window and a 3-row input box. */
async function start(
  count: number,
  options: Parameters<typeof startAppHarness>[0] = {},
  pages = historyPages(count),
) {
  app = await startAppHarness({
    columns: 100,
    rows: 16,
    ...options,
    prepare: (slack) => {
      slack.respondPaged("conversations.history", pages);
      return options.prepare?.(slack);
    },
  });
  await app.waitForScreen("#general", 5000);
}

const lines = () => app.screen().split("\n");

/** The message pane's part of each line (the sidebar is 32 columns of 100). */
const paneLines = () =>
  lines().map((line) => line.slice(33).replace(/ *│$/, ""));

/** The boxes' bottom border row, where "new messages below" is shown. */
const bottomBorder = () => lines().find((line) => line.startsWith("╰")) ?? "";

/** Whether the message pane's box is drawn in the focus colour, read from its title on the top border. */
const paneFocused = () =>
  app
    .coloredScreen()
    .some(
      (row) => foregroundAt(row, " #general ") === foregroundCode(theme.focus),
    );
const num = (n: number) => `msg ${String(n).padStart(4, "0")}`;

/** The numbers of the messages on screen, top to bottom. */
function visible(): number[] {
  return paneLines().flatMap((line) => {
    const match = line.match(/msg (\d{4})/);

    return match ? [Number(match[1])] : [];
  });
}

const historyCalls = () =>
  app.slack.calls.filter((call) => call.method === "conversations.history");

async function openGeneral() {
  await app.press(keys.enter);
  await app.waitForScreen(/msg \d{4}/);
}

async function sendLive(n: number, overrides: Record<string, unknown> = {}) {
  const payload = await loadPayload("message");

  return app.sendEvents({
    ...payload,
    event: {
      ...payload.event,
      channel: general,
      ...numbered(n),
      ...overrides,
    },
  });
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

test("Tab moves focus between the sidebar and the message pane, and the focused pane is drawn in the focus colour", async () => {
  await start(30);
  await openGeneral();

  expect(paneFocused()).toBe(false);

  await app.press(keys.tab);
  expect(paneFocused()).toBe(true);

  await app.press(keys.tab);
  expect(paneFocused()).toBe(true);

  await app.press(keys.tab);
  expect(paneFocused()).toBe(false);
});

test("with the message pane focused the sidebar keys don't move the selection, and back in the sidebar they do", async () => {
  await start(30);
  await openGeneral();
  await app.press(keys.tab);
  await app.press("j");

  expect(lines().find((line) => line.includes("›"))).toContain("#general");

  await app.press(keys.tab);
  await app.press(keys.tab);
  await app.press("j");

  expect(lines().find((line) => line.includes("›"))).toContain("#random");
});

test("Tab does nothing while no conversation is open", async () => {
  await start(30);
  await app.press(keys.tab);
  await app.press("j");

  expect(lines().find((line) => line.includes("›"))).toContain("#random");
});

test("j/k and the arrow keys move the selection and scroll only once it would leave the view", async () => {
  await start(30);
  await openGeneral();

  expect(visible()).toEqual(range(21, 30));

  await app.press(keys.tab);

  for (let i = 0; i < 9; i++) {
    await app.press("k");
  }

  expect(visible()).toEqual(range(21, 30));

  await app.press("k");
  expect(visible()).toEqual(range(20, 29));

  await app.press(keys.up);
  expect(visible()).toEqual(range(19, 28));

  await app.press("j");
  expect(visible()).toEqual(range(19, 28));

  for (let i = 0; i < 10; i++) {
    await app.press(keys.down);
  }

  expect(visible()).toEqual(range(21, 30));
});

test("Page Up and Page Down scroll by a screen", async () => {
  await start(60);
  await openGeneral();
  await app.press(keys.tab);

  await app.press(keys.pageUp);
  expect(visible()).toEqual(range(42, 51));

  await app.press(keys.pageUp);
  expect(visible()).toEqual(range(33, 42));

  await app.press(keys.pageDown);
  expect(visible()).toEqual(range(42, 51));

  await app.press(keys.pageDown);
  await app.press(keys.pageDown);
  expect(visible()).toEqual(range(51, 60));
});

test("g jumps to the oldest loaded message and G back to the newest", async () => {
  await start(30);
  await openGeneral();
  await app.press(keys.tab);

  await app.press("g");
  expect(visible()).toEqual(range(1, 7));
  expect(paneLines()[1]).toMatch(/beginning of conversation/i);

  await app.press("G");
  expect(visible()).toEqual(range(21, 30));
});

test("a message taller than the view scrolls line by line", async () => {
  const long = Array.from({ length: 80 }, (_, i) => `w${i}`).join(" ");

  await start(
    5,
    { columns: 50, rows: 12 },
    historyPages(5, 50, (n) => (n === 5 ? long : undefined)),
  );
  await app.press(keys.enter);
  await app.waitForScreen("w79");
  await app.press(keys.tab);

  expect(app.screen()).not.toContain("w0 ");
  expect(lines()).toHaveLength(12);

  for (const line of lines()) {
    expect(Bun.stringWidth(line)).toBeLessThanOrEqual(50);
  }

  for (let i = 0; i < 11; i++) {
    await app.press("k");
  }

  expect(app.screen()).toContain("w0 ");
  expect(app.screen()).not.toContain("w79");
});

test("scrolling to the top loads the next older page and the visible lines stay where they are", async () => {
  await start(120);
  await openGeneral();
  await app.press(keys.tab);

  expect(historyCalls()).toHaveLength(1);

  await app.press("g");
  await waitFor(() => historyCalls().length === 2);
  await waitFor(() => visible()[0] === 69);

  // The day and author lines that sat above 71 now belong to the older page.
  expect(visible()).toEqual(range(69, 78));

  // The selection was on 71, the oldest message before the page arrived.
  await app.press("k");
  await app.press("k");
  expect(visible()).toEqual(range(69, 78));

  await app.press("k");
  expect(visible()).toEqual(range(68, 77));
});

test("the beginning of the conversation is shown, and no more pages are requested", async () => {
  await start(120);
  await openGeneral();
  await app.press(keys.tab);

  expect(app.screen()).not.toMatch(/beginning of conversation/i);

  await app.press("g");
  await waitFor(() => historyCalls().length === 2);
  await waitFor(() => visible()[0] === 69);
  await app.press("g");
  await waitFor(() => historyCalls().length === 3);
  await waitFor(() => visible()[0] === 19);

  expect(visible()).toEqual(range(19, 28));

  expect(app.screen()).not.toMatch(/beginning of conversation/i);

  await app.press("g");

  expect(visible()).toEqual(range(1, 7));
  expect(paneLines()[1]).toMatch(/beginning of conversation/i);

  await app.press("k");
  await app.press("g");
  await Bun.sleep(40);

  expect(historyCalls()).toHaveLength(3);
});

test("a short conversation with all history loaded says where it begins", async () => {
  await start(3);
  await openGeneral();

  expect(app.screen()).toMatch(/beginning of conversation/i);
});

test("a failed older page says so and scrolling up again retries", async () => {
  let failing = false;
  const pages = historyPages(120);

  await start(120, {
    columns: 120,
    prepare: (slack) =>
      slack.respond("conversations.history", (call) => {
        const cursor = call.params.cursor;

        if (!cursor) {
          return pages[0]!;
        }

        return failing ? { ok: false, error: "ratelimited" } : pages[1]!;
      }),
  });
  await openGeneral();
  await app.press(keys.tab);

  failing = true;
  await app.press("g");
  await app.waitForScreen("ratelimited");

  failing = false;
  await app.press("g");
  await waitFor(() => historyCalls().length === 3);
  await waitFor(() => visible()[0] === 69);
  await app.press("k");
  await app.press("k");
  await app.press("k");

  expect(app.screen()).not.toContain("ratelimited");
  expect(visible()).toEqual(range(68, 77));
});

test("while scrolled up new messages don't move the view, and a hint says they're below", async () => {
  await start(30);
  await openGeneral();
  await app.press(keys.tab);
  await app.press("k");
  await app.press("k");

  expect(bottomBorder()).not.toMatch(/new messages below/i);

  await sendLive(31);
  await app.waitForScreen("new messages below");

  expect(visible()).toEqual(range(21, 30));

  await sendLive(32);
  await Bun.sleep(40);

  expect(visible()).toEqual(range(21, 30));
  expect(bottomBorder()).toMatch(/new messages below/i);

  await app.press("G");

  expect(visible()).toEqual(range(23, 32));
  expect(app.screen()).not.toMatch(/new messages below/i);
});

test("scrolling back down to the newest message clears the hint and follows again", async () => {
  await start(30);
  await openGeneral();
  await app.press(keys.tab);
  await app.press("k");
  await sendLive(31);
  await app.waitForScreen("new messages below");

  await app.press("j");
  await app.press("j");

  expect(app.screen()).not.toMatch(/new messages below/i);
  expect(visible()).toEqual(range(22, 31));

  await sendLive(32);
  await app.waitForScreen(num(32));

  expect(visible()).toEqual(range(23, 32));
});

test("new messages while following keep the view at the bottom without a hint", async () => {
  await start(30);
  await openGeneral();
  await sendLive(31);
  await app.waitForScreen(num(31));

  expect(visible()).toEqual(range(22, 31));
  expect(app.screen()).not.toMatch(/new messages below/i);
});

test("opening a conversation again returns to its newest message", async () => {
  await start(30);
  await openGeneral();
  await app.press(keys.tab);
  await app.press("g");
  await app.press(keys.tab);
  await app.press(keys.tab);
  await app.press(keys.enter);
  await Bun.sleep(40);

  expect(visible()).toEqual(range(21, 30));
});

test("a 2,000 message conversation renders only its window and scrolls without lag", async () => {
  await start(2000, {}, [
    {
      ok: true,
      messages: range(1, 2000)
        .reverse()
        .map((n) => numbered(n)),
      has_more: false,
    },
  ]);
  await openGeneral();
  await app.waitForScreen(num(2000));
  await app.press(keys.tab);

  expect(lines()).toHaveLength(16);
  expect(visible()).toEqual(range(1991, 2000));

  const slowest = { ms: 0 };

  for (const key of [
    "k",
    "k",
    keys.pageUp,
    keys.pageUp,
    "g",
    keys.pageDown,
    "j",
    "G",
  ]) {
    const started = performance.now();

    await app.press(key);
    slowest.ms = Math.max(slowest.ms, performance.now() - started);
  }

  expect(visible()).toEqual(range(1991, 2000));
  expect(slowest.ms).toBeLessThan(150);
});
