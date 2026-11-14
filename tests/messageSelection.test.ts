import { afterEach, expect, test } from "bun:test";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import { waitFor } from "./support/fakeSlack";
import { loadPayload } from "./support/fixtures";

let app: AppHarness;

afterEach(() => app.stop());

const general = "C012AB3CD";

type Raw = Record<string, unknown>;

/** Message `n` of a conversation whose messages are numbered oldest (1) to newest. */
function numbered(n: number, extra: Raw = {}): Raw {
  return {
    type: "message",
    user: "U222222222",
    text: `msg ${String(n).padStart(4, "0")}`,
    ts: `1600000000.${String(n).padStart(6, "0")}`,
    ...extra,
  };
}

/** Slack's history pages for messages 1..count: newest first, `size` per page. */
function historyPages(
  count: number,
  size = 50,
  extra: (n: number) => Raw = () => ({}),
) {
  const pages: Raw[] = [];

  for (let high = count; high > 0; high -= size) {
    const low = Math.max(1, high - size + 1);
    const messages = [];

    for (let n = high; n >= low; n--) {
      messages.push(numbered(n, extra(n)));
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

/** 15 rows: a 14-row body, 12 rows inside the border, a 10-line message window, and a divider and a line of input. */
async function start(
  count: number,
  options: Parameters<typeof startAppHarness>[0] = {},
  pages = historyPages(count),
) {
  app = await startAppHarness({
    columns: 100,
    rows: 14,
    ...options,
    prepare: (slack) => {
      slack.respondPaged("conversations.history", pages);
      return options.prepare?.(slack);
    },
  });
  await app.waitForScreen("#general", 5000);
  await app.press(keys.enter);
  await app.waitForScreen(/msg \d{4}|w79/);
  await app.press(keys.tab);
}

/** The message pane's part of each line (the sidebar is 32 columns of 100). */
const paneLines = () =>
  app
    .screen()
    .split("\n")
    .map((line) => line.slice(33).replace(/ *│$/, ""));

/** The pane's lines that carry the selection bar (the top border has none). */
const barred = () =>
  paneLines()
    .slice(1)
    .filter((line) => line[1] === "▌");

const numberIn = (line: string) => Number(line.match(/msg (\d{4})/)?.[1]);

/** The numbers of the messages whose lines carry the selection bar. */
const selected = () => barred().map(numberIn);

/** The numbers of the messages on screen, top to bottom. */
function visible(): number[] {
  return paneLines().flatMap((line) => {
    const match = line.match(/msg (\d{4})/);

    return match ? [Number(match[1])] : [];
  });
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

async function sendLive(n: number) {
  const payload = await loadPayload("message");

  return app.sendEvents({
    ...payload,
    event: { ...payload.event, channel: general, ...numbered(n) },
  });
}

test("the newest message starts selected and j/k and the arrows move the selection by message", async () => {
  await start(30);

  expect(selected()).toEqual([30]);

  await app.press("k");
  expect(selected()).toEqual([29]);
  expect(visible()).toEqual(range(21, 30));

  await app.press(keys.up);
  expect(selected()).toEqual([28]);

  await app.press("j");
  expect(selected()).toEqual([29]);

  await app.press(keys.down);
  await app.press(keys.down);
  expect(selected()).toEqual([30]);
});

test("the view scrolls only as far as needed to keep the selection visible", async () => {
  await start(30);

  for (let i = 0; i < 9; i++) {
    await app.press("k");
  }

  expect(selected()).toEqual([21]);
  expect(visible()).toEqual(range(21, 30));

  await app.press("k");
  expect(selected()).toEqual([20]);
  expect(visible()).toEqual(range(20, 29));

  await app.press("j");
  expect(selected()).toEqual([21]);
  expect(visible()).toEqual(range(20, 29));
});

test("a wrapped message is selected as a whole", async () => {
  const long = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ");

  await start(
    3,
    { columns: 96, rows: 17 },
    historyPages(3, 50, (n) => (n === 2 ? { text: `msg 0002 ${long}` } : {})),
  );
  await app.press("k");

  expect(barred().length).toBeGreaterThan(1);
  expect(barred().every((line) => /msg 0002|w\d+/.test(line))).toBe(true);
});

test("a message's reactions and reply count are highlighted with it, and day separators are skipped", async () => {
  const day = 24 * 60 * 60;
  const pages = [
    {
      ok: true,
      messages: [
        numbered(3, { ts: `${1600000000 + day}.000003` }),
        numbered(2, {
          reactions: [{ name: "tada", count: 2, users: ["U1", "U2"] }],
          reply_count: 4,
        }),
        numbered(1, { ts: `${1600000000 - day}.000001` }),
      ],
      has_more: false,
    },
  ];

  await start(3, { rows: 24 }, pages);

  expect(selected()).toEqual([3]);

  await app.press("k");

  const lines = barred();

  expect(lines.map((line) => line.trim())).toEqual([
    expect.stringContaining("msg 0002"),
    expect.stringContaining("🎉"),
    expect.stringContaining("4 replies"),
  ]);

  await app.press("k");
  expect(selected()).toEqual([1]);
  expect(barred()).toHaveLength(1);

  await app.press("j");
  await app.press("j");
  expect(selected()).toEqual([3]);
});

test("Page Up and Page Down scroll by a screen and carry the selection", async () => {
  await start(60);

  await app.press(keys.pageUp);
  expect(visible()).toEqual(range(42, 51));
  expect(selected()).toEqual([51]);

  await app.press(keys.pageUp);
  expect(visible()).toEqual(range(33, 42));
  expect(selected()).toEqual([42]);

  await app.press(keys.pageDown);
  expect(visible()).toEqual(range(42, 51));
  expect(selected()).toEqual([51]);

  await app.press(keys.pageDown);
  await app.press(keys.pageDown);
  expect(visible()).toEqual(range(51, 60));
  expect(selected()).toEqual([60]);
});

test("g selects the oldest loaded message and G the newest", async () => {
  await start(30);

  await app.press("g");
  expect(selected()).toEqual([1]);
  expect(visible()).toEqual(range(1, 7));

  await app.press("G");
  expect(selected()).toEqual([30]);
  expect(visible()).toEqual(range(21, 30));
});

test("selecting the oldest loaded message loads older history and keeps the selection", async () => {
  await start(120);

  await app.press("g");
  await waitFor(
    () =>
      app.slack.calls.filter((call) => call.method === "conversations.history")
        .length === 2,
  );
  await waitFor(() => visible()[0] === 69);

  expect(selected()).toEqual([71]);

  await app.press("k");
  expect(selected()).toEqual([70]);
});

test("the selection stays on its message when new messages arrive, and the hint shows", async () => {
  await start(30);
  await app.press("k");
  await app.press("k");
  await sendLive(31);
  await app.waitForScreen("new messages below");

  expect(selected()).toEqual([28]);
  expect(visible()).toEqual(range(21, 30));

  await app.press("j");
  await app.press("j");
  await app.press("j");

  expect(selected()).toEqual([31]);
  expect(app.screen()).not.toMatch(/new messages below/i);
});

test("with the newest message selected the selection and view follow new messages", async () => {
  await start(30);
  await sendLive(31);
  await app.waitForScreen("msg 0031");

  expect(selected()).toEqual([31]);
  expect(visible()).toEqual(range(22, 31));
  expect(app.screen()).not.toMatch(/new messages below/i);
});

test("the hint shows when the view is at the bottom but the selection is not on the newest message", async () => {
  await start(30);
  await app.press("k");
  await sendLive(31);
  await app.waitForScreen("new messages below");

  expect(selected()).toEqual([29]);
});

test("an edited message stays selected", async () => {
  await start(30);
  await app.press("k");

  const changed = await loadPayload("message-changed");

  await app.sendEvents({
    ...changed,
    event: {
      ...changed.event,
      channel: general,
      message: {
        ...changed.event.message,
        user: "U222222222",
        ts: numbered(29).ts,
        text: "msg 0029 revised",
      },
    },
  });
  await app.waitForScreen("revised");

  expect(selected()).toEqual([29]);
});

async function deleteMessage(n: number) {
  const deleted = await loadPayload("message-deleted");

  await app.sendEvents({
    ...deleted,
    event: { ...deleted.event, channel: general, deleted_ts: numbered(n).ts },
  });
  await Bun.sleep(60);
}

test("deleting the selected message moves the selection to a neighbour", async () => {
  await start(30);
  await app.press("k");
  await app.press("k");
  await deleteMessage(28);

  expect(visible()).not.toContain(28);
  expect(selected()).toEqual([29]);

  await app.press("G");
  await app.press("k");
  await deleteMessage(29);
  expect(selected()).toEqual([30]);

  await deleteMessage(30);
  expect(selected()).toEqual([27]);
});

test("opening a conversation again starts with its newest message selected", async () => {
  await start(30);
  await app.press("g");
  await app.press(keys.tab);
  await app.press(keys.tab);
  await app.press(keys.enter);
  await Bun.sleep(40);
  await app.press(keys.tab);

  expect(selected()).toEqual([30]);
  expect(visible()).toEqual(range(21, 30));
});

test("a message taller than the view is scrolled through line by line before the selection moves on", async () => {
  const long = Array.from({ length: 80 }, (_, i) => `w${i}`).join(" ");

  await start(
    5,
    { columns: 50, rows: 11 },
    historyPages(5, 50, (n) => (n === 5 ? { text: long } : {})),
  );

  expect(app.screen()).not.toContain("w0 ");

  for (let i = 0; i < 11; i++) {
    await app.press("k");
  }

  expect(app.screen()).toContain("w0 ");
  expect(app.screen()).not.toContain("w79");

  await app.press("j");
  await app.press("j");
  expect(app.screen()).not.toContain("w0 ");
});

test("the status line shows message keys while the message pane has focus", async () => {
  await start(30);

  const bar = () => app.screen().split("\n").at(-1)!;

  expect(bar()).toContain("j/k select");

  await app.press(keys.tab);
  expect(bar()).not.toContain("j/k select");
});
