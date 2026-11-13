import { afterEach, expect, test } from "bun:test";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import { theme } from "../src/ui/theme";
import {
  foregroundAt,
  foregroundCode,
  useTerminalColour,
} from "./support/colours";
import { loadPayload } from "./support/fixtures";

useTerminalColour();

let app: AppHarness;

afterEach(() => app.stop());

const general = "C012AB3CD";
const egon = "U123ABC456";
const venkman = "U222222222";

const parentTs = "1600000000.000001";
const plainTs = "1600000100.000001";

type Raw = Record<string, unknown>;

const parent: Raw = {
  type: "message",
  user: egon,
  text: "parent text",
  ts: parentTs,
  thread_ts: parentTs,
  reply_count: 3,
};

const plain: Raw = {
  type: "message",
  user: venkman,
  text: "plain text",
  ts: plainTs,
};

const reply = (n: number): Raw => ({
  type: "message",
  user: venkman,
  text: `reply ${n}`,
  ts: `1600000000.00001${n}`,
  thread_ts: parentTs,
});

/** The thread in two pages, as Slack gives it: the parent opens the first. */
const threadPages = [
  {
    ok: true,
    messages: [parent, reply(1), reply(2)],
    has_more: true,
    response_metadata: { next_cursor: "more" },
  },
  {
    ok: true,
    messages: [reply(3)],
    has_more: false,
    response_metadata: { next_cursor: "" },
  },
];

async function start(
  options: Parameters<typeof startAppHarness>[0] & {
    replies?: (call: { params: Record<string, any> }) => Raw;
  } = {},
) {
  const { replies, ...rest } = options;

  app = await startAppHarness({
    columns: 160,
    rows: 30,
    ...rest,
    prepare: (slack) => {
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [plain, parent],
        has_more: false,
      }));

      if (replies) {
        slack.respond("conversations.replies", replies);
      } else {
        slack.respondPaged("conversations.replies", threadPages);
      }

      return rest.prepare?.(slack);
    },
  });
  await app.waitForScreen("#general", 5000);
  await app.press(keys.enter);
  await app.waitForScreen("plain text");
  await app.press(keys.tab);
}

/** Selects the parent (the message above the newest) and opens its thread. */
async function openThread(key: string = keys.enter) {
  await app.press("k");
  await app.press(key);
}

const messageLines = () =>
  app
    .screen()
    .split("\n")
    .map((line) => line.slice(32, 96).trimEnd());

const threadLines = () =>
  app
    .screen()
    .split("\n")
    .map((line) => line.slice(96).trimEnd());

const text = (lines: string[]) => lines.join("\n");

const barred = (lines: string[]) =>
  lines.slice(1).filter((line) => line[2] === "▌");

/** Which box titles are drawn in the focus colour: a pane stays focused while its input has focus. */
function focusedTitles(): string[] {
  const row = app.coloredScreen()[0]!;

  return ["Acme", "#general", "Thread"].filter(
    (title) => foregroundAt(row, ` ${title} `) === foregroundCode(theme.focus),
  );
}

async function sendLive(overrides: Raw) {
  const payload = await loadPayload("message");

  return app.sendEvents({
    ...payload,
    event: { ...payload.event, channel: general, ...overrides },
  });
}

test("Enter on a message with replies opens its thread beside the conversation, parent first, every page loaded", async () => {
  await start();
  await openThread();
  await app.waitForScreen("reply 3");

  const lines = threadLines();
  const shown = text(lines);

  expect(lines[0]).toContain("Thread");
  expect(shown.indexOf("parent text")).toBeGreaterThan(-1);
  expect(shown.indexOf("parent text")).toBeLessThan(shown.indexOf("reply 1"));
  expect(shown.indexOf("reply 1")).toBeLessThan(shown.indexOf("reply 3"));
  expect(shown).toContain("reply 2");
  expect(lines[0]).toContain("3 replies");
  expect(text(lines.slice(1))).not.toContain("3 replies");
  expect(text(messageLines())).toContain("plain text");
  expect(text(messageLines())).toContain("3 replies");
  expect(
    app.slack.calls.filter((call) => call.method === "conversations.replies"),
  ).toHaveLength(2);
});

test("t opens the thread too", async () => {
  await start();
  await openThread("t");
  await app.waitForScreen("reply 3");
});

test("a message without replies opens an empty thread", async () => {
  await start();
  await app.press(keys.enter);
  await app.waitForScreen("No replies yet");

  expect(text(threadLines())).toContain("Thread");
});

test("the thread pane has its own selection, starting on the newest reply", async () => {
  await start();
  await openThread();
  await app.waitForScreen("reply 3");

  expect(barred(threadLines())).toHaveLength(1);
  expect(barred(threadLines())[0]).toContain("reply 3");

  await app.press("k");
  expect(barred(threadLines())[0]).toContain("reply 2");

  await app.press("g");
  expect(barred(threadLines())[0]).toContain("parent text");
  expect(barred(messageLines())).toHaveLength(0);

  await app.press("G");
  expect(barred(threadLines())[0]).toContain("reply 3");
});

test("live replies appear in the open thread and a broadcast also stays in the channel", async () => {
  await start();
  await openThread();
  await app.waitForScreen("reply 3");

  await sendLive({
    user: venkman,
    text: "live one",
    ts: "1600000200.000001",
    thread_ts: parentTs,
  });
  await app.waitForScreen("live one");

  expect(text(threadLines())).toContain("live one");
  expect(text(messageLines())).not.toContain("live one");

  await sendLive({
    user: venkman,
    text: "loud one",
    ts: "1600000300.000001",
    thread_ts: parentTs,
    subtype: "thread_broadcast",
  });
  await app.waitForScreen("loud one");

  expect(text(threadLines())).toContain("loud one");
  expect(text(messageLines())).toContain("loud one");
});

test("Tab cycles sidebar, messages, input, thread, thread input; Esc closes the thread and returns to the messages", async () => {
  await start();
  await openThread();
  await app.waitForScreen("reply 3");
  expect(focusedTitles()).toEqual(["Thread"]);

  await app.press(keys.tab);
  expect(focusedTitles()).toEqual(["Thread"]);
  expect(app.screen()).toContain("Ctrl+T also send to channel");

  await app.press(keys.tab);
  expect(focusedTitles()).toEqual(["Acme"]);
  expect(app.screen()).not.toContain("Esc close thread");

  await app.press(keys.tab);
  expect(focusedTitles()).toEqual(["#general"]);

  await app.press(keys.tab);
  await app.press(keys.tab);
  expect(focusedTitles()).toEqual(["Thread"]);

  await app.press(keys.escape);
  await Bun.sleep(50);

  expect(app.screen()).not.toContain("Thread");
  expect(focusedTitles()).toEqual(["#general"]);
});

test("the status bar shows thread keys while the thread has focus", async () => {
  await start();
  await openThread();
  await app.waitForScreen("reply 3");

  expect(app.screen()).toContain("Esc close thread");

  await app.press(keys.tab);
  expect(app.screen()).not.toContain("Esc close thread");
});

test("switching conversations closes the thread", async () => {
  await start();
  await openThread();
  await app.waitForScreen("reply 3");

  await app.press(keys.tab);
  await app.press(keys.tab);
  await app.press("j");
  await app.press(keys.enter);
  await Bun.sleep(50);

  expect(app.screen()).not.toContain("Thread");
});

test("on a narrow terminal the thread takes the conversation's place", async () => {
  await start({ columns: 100 });
  await openThread();
  await app.waitForScreen("reply 3");

  const pane = app
    .screen()
    .split("\n")
    .map((line) => line.slice(32));

  expect(text(pane)).toContain("Thread");
  expect(text(pane)).toContain("reply 1");
  expect(text(pane)).not.toContain("plain text");

  await app.press(keys.escape);
  await Bun.sleep(50);

  expect(app.screen()).toContain("plain text");
  expect(app.screen()).not.toContain("Thread");
});

test("a thread that fails to load says why", async () => {
  // The error line is cut at the pane's width, so this terminal is wide enough for all of it.
  await start({
    columns: 170,
    replies: () => ({ ok: false, error: "thread_not_found" }),
  });
  await openThread();
  await app.waitForScreen("thread_not_found");

  expect(text(threadLines())).toContain("parent text");
});
