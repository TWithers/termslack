import { afterEach, expect, test } from "bun:test";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import { waitFor } from "./support/fakeSlack";
import { paneInputLines } from "./support/panes";

let app: AppHarness;

afterEach(() => app.stop());

const general = "C012AB3CD";
const ctrlT = "\x14";

const parentTs = "1600000000.000001";
const plainTs = "1600000100.000001";

type Raw = Record<string, unknown>;

const parent: Raw = {
  type: "message",
  user: "U123ABC456",
  text: "parent text",
  ts: parentTs,
  thread_ts: parentTs,
  reply_count: 1,
};

const plain: Raw = {
  type: "message",
  user: "U222222222",
  text: "plain text",
  ts: plainTs,
};

async function start(options: Parameters<typeof startAppHarness>[0] = {}) {
  app = await startAppHarness({
    columns: 160,
    rows: 30,
    ...options,
    prepare: (slack) => {
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [plain, parent],
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

      return options.prepare?.(slack);
    },
  });
  await app.waitForScreen("#general", 5000);
  await app.press(keys.enter);
  await app.waitForScreen("plain text");
  await waitFor(() => app.session.currentUserId);
  await app.press(keys.tab);
}

/** Opens the thread of the message with replies (above the newest). */
async function openParentThread() {
  await app.press("k");
  await app.press(keys.enter);
  await app.waitForScreen("first reply");
}

const postCalls = () =>
  app.slack.calls.filter((call) => call.method === "chat.postMessage");

const replyCalls = () =>
  app.slack.calls.filter((call) => call.method === "conversations.replies");

const column = (from: number, to?: number) =>
  app
    .screen()
    .split("\n")
    .map((line) => line.slice(from, to).trimEnd())
    .join("\n");

const messagePane = () => column(32, 96);
const threadPane = () => column(96);

/** The thread's input lines: the rows under its divider. */
const threadInputLines = () => paneInputLines(app.screen(), 96);

test("i in the thread pane jumps to the thread input; Esc goes back to the thread, Esc again closes it", async () => {
  await start();
  await openParentThread();

  expect(threadInputLines()).toEqual(["Reply…"]);

  await app.press("i");
  await app.press("jq");

  expect(threadInputLines()).toEqual(["jq"]);
  expect(messagePane()).not.toContain("jq");

  await app.press(keys.escape);
  expect(app.screen()).toContain("Esc close thread");
  expect(app.screen()).toContain("Thread");

  await app.press(keys.escape);
  await Bun.sleep(50);
  expect(app.screen()).not.toContain("Esc close thread");
  expect(app.screen()).not.toContain("Reply…");
});

test("Tab cycles through the thread input after the thread", async () => {
  await start();
  await openParentThread();

  await app.press(keys.tab);
  await app.press("x");

  expect(threadInputLines()).toEqual(["x"]);
});

test("a reply is sent with thread_ts, shows pending then confirmed once, and raises the reply count", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));

  await start({
    prepare: (slack) => {
      const normal = slack.handler("chat.postMessage");

      slack.respond("chat.postMessage", async (call) => {
        await gate;

        return normal(call);
      });
    },
  });
  await openParentThread();
  expect(messagePane()).toContain("1 reply");

  await app.press("i");
  await app.press("my reply");
  await app.press(keys.enter);
  await app.waitForScreen("my reply");

  expect(postCalls()[0]?.params).toMatchObject({
    channel: general,
    text: "my reply",
    thread_ts: parentTs,
  });
  expect(postCalls()[0]?.params.reply_broadcast).toBeUndefined();
  expect(threadInputLines()).toEqual([""]);
  expect(app.session.threadReplies(general, parentTs).at(-1)?.delivery).toBe(
    "pending",
  );

  release();
  await waitFor(
    () =>
      app.session.threadReplies(general, parentTs).at(-1)?.delivery ===
      undefined,
  );

  const ts = app.session.threadReplies(general, parentTs).at(-1)!.ts;

  await app.sendEvents({
    type: "event_callback",
    event: {
      type: "message",
      channel: general,
      channel_type: "channel",
      user: "U123ABC456",
      text: "my reply",
      ts,
      thread_ts: parentTs,
    },
  });

  expect(threadPane().match(/my reply/g)).toHaveLength(1);
  expect(messagePane()).not.toContain("my reply");
  expect(messagePane()).toContain("2 replies");
});

test("Ctrl+T sends the reply to the channel too, and the toggle resets after the send", async () => {
  await start();
  await openParentThread();
  await app.press("i");

  expect(app.screen()).not.toContain("also send to #general");

  await app.press(ctrlT);
  expect(app.screen()).toContain("also send to #general");

  await app.press("loud reply");
  await app.press(keys.enter);
  await waitFor(() => postCalls().length === 1);

  expect(postCalls()[0]?.params).toMatchObject({
    thread_ts: parentTs,
    reply_broadcast: "true",
  });
  await app.waitForScreen("loud reply");
  expect(messagePane()).toContain("loud reply");
  expect(threadPane()).toContain("loud reply");
  expect(app.screen()).not.toContain("also send to #general");

  await app.press("quiet reply");
  await app.press(keys.enter);
  await waitFor(() => postCalls().length === 2);

  expect(postCalls()[1]?.params.reply_broadcast).toBeUndefined();
  await app.waitForScreen("quiet reply");
  expect(messagePane()).not.toContain("quiet reply");
});

test("Ctrl+T toggles off again and does nothing in the conversation's own input", async () => {
  await start();
  await openParentThread();
  await app.press("i");
  await app.press(ctrlT);
  await app.press(ctrlT);

  expect(app.screen()).not.toContain("also send to #general");

  await app.press(keys.escape);
  await app.press(keys.tab);
  await app.press(keys.tab);
  await app.press(ctrlT);

  expect(app.screen()).not.toContain("also send to #general");
});

test("a failed reply says why and puts the text and the broadcast choice back", async () => {
  await start({
    prepare: (slack) =>
      slack.respond("chat.postMessage", () => ({
        ok: false,
        error: "channel_not_found",
      })),
  });
  await openParentThread();
  await app.press("i");
  await app.press(ctrlT);
  await app.press("oops");
  await app.press(keys.enter);
  await waitFor(() => threadInputLines()[0] === "oops");

  expect(app.screen()).toContain("also send to #general");
  expect(app.screen()).toContain("(not sent)");
});

test("a thread can be started on a message with no replies: empty pane, input focused, no replies fetched", async () => {
  await start();
  await app.press(keys.enter);
  await app.waitForScreen("No replies yet");

  expect(threadPane()).toContain("plain text");
  expect(replyCalls()).toHaveLength(0);

  await app.press("hello thread");
  await app.press(keys.enter);
  await waitFor(() => postCalls().length === 1);

  expect(postCalls()[0]?.params).toMatchObject({
    text: "hello thread",
    thread_ts: plainTs,
  });
  await app.waitForScreen("hello thread");
  expect(threadPane()).not.toContain("No replies yet");
  expect(messagePane()).toContain("1 reply");
});

test("t starts a thread too", async () => {
  await start();
  await app.press("t");
  await app.waitForScreen("No replies yet");
});

test("thread drafts are kept per thread, apart from the conversation's draft", async () => {
  await start();
  await openParentThread();
  await app.press("i");
  await app.press("thread draft");
  await app.press(keys.escape);
  await app.press(keys.escape);
  await Bun.sleep(50);

  // The conversation's own input is untouched.
  await app.press("i");
  await app.press("channel draft");
  await app.press(keys.escape);

  // Another thread has its own, empty, draft.
  await app.press("j");
  await app.press(keys.enter);
  await app.waitForScreen("No replies yet");
  expect(threadInputLines()).toEqual([""]);
  await app.press("other draft");
  await app.press(keys.escape);
  await app.press(keys.escape);
  await Bun.sleep(50);

  await app.press("k");
  await app.press(keys.enter);
  await app.waitForScreen("first reply");
  await app.press("i");
  expect(threadInputLines()).toEqual(["thread draft"]);
  expect(messagePane()).toContain("channel draft");
});

test("the thread input completes mentions", async () => {
  await start();
  await openParentThread();
  await app.press("i");
  await app.press("@");

  expect(app.screen()).toContain("@here");
});

test("a broadcast reply shows in the channel while it is still sending, and once after it is confirmed", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));

  await start({
    prepare: (slack) => {
      const normal = slack.handler("chat.postMessage");

      slack.respond("chat.postMessage", async (call) => {
        await gate;

        return normal(call);
      });
    },
  });
  await openParentThread();
  await app.press("i");
  await app.press(ctrlT);
  await app.press("loud reply");
  await app.press(keys.enter);
  await waitFor(() => postCalls().length === 1);
  await app.waitForScreen(/loud reply/);

  expect(messagePane().match(/loud reply/g)).toHaveLength(1);
  expect(threadPane().match(/loud reply/g)).toHaveLength(1);

  release();
  await waitFor(
    () =>
      app.session.threadReplies(general, parentTs).at(-1)?.delivery ===
      undefined,
  );

  expect(messagePane().match(/loud reply/g)).toHaveLength(1);
  expect(threadPane().match(/loud reply/g)).toHaveLength(1);
});
