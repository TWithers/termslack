import { afterEach, expect, test } from "bun:test";
import { waitFor } from "./support/fakeSlack";
import {
  type SessionHarness,
  startSessionHarness,
} from "./support/sessionHarness";

let harness: SessionHarness;

afterEach(() => harness.stop());

const channel = "C123ABC456";
const me = "U123ABC456";

async function start() {
  harness = await startSessionHarness();
  await waitFor(() => harness.session.currentUserId);
}

const postCalls = () =>
  harness.slack.calls.filter((call) => call.method === "chat.postMessage");

/** Makes `chat.postMessage` wait until the returned function is called. */
function holdResponses(): () => void {
  const normal = harness.slack.handler("chat.postMessage");
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));

  harness.slack.respond("chat.postMessage", async (call) => {
    await gate;

    return normal(call);
  });

  return release;
}

/** Sends the socket echo of a message the current user (or someone) wrote. */
function echo(ts: string, extra: Record<string, unknown> = {}) {
  return harness.sendEvents({
    type: "event_callback",
    event: {
      type: "message",
      channel,
      channel_type: "channel",
      user: me,
      text: "hello",
      ts,
      ...extra,
    },
  });
}

const shown = (threadTs?: string) =>
  (threadTs === undefined
    ? harness.session.messages(channel)
    : harness.session.threadReplies(channel, threadTs)
  ).map(({ text, delivery }) => `${text}${delivery ? ` [${delivery}]` : ""}`);

test("sending posts the escaped text with a client message ID", async () => {
  await start();

  const result = await harness.session.sendMessage({
    conversationId: channel,
    text: "a & b < c > d",
  });

  expect(result).toMatchObject({ ok: true });

  const [call] = postCalls();

  expect(call?.params).toMatchObject({
    channel,
    text: "a &amp; b &lt; c &gt; d",
  });
  expect(call?.params.client_msg_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(call?.params.thread_ts).toBeUndefined();
});

test("blank text isn't sent", async () => {
  await start();

  const result = await harness.session.sendMessage({
    conversationId: channel,
    text: " \n ",
  });

  expect(result).toEqual({ ok: false, message: "There is nothing to send." });
  expect(postCalls()).toHaveLength(0);
});

test("the message shows at once as pending, then as a normal message", async () => {
  await start();

  const release = holdResponses();
  const sending = harness.session.sendMessage({
    conversationId: channel,
    text: "hello",
  });

  await waitFor(() => postCalls().length > 0);
  expect(shown()).toEqual(["hello [pending]"]);
  expect(harness.session.messages(channel)[0]?.userId).toBe(me);

  release();
  await sending;

  expect(shown()).toEqual(["hello"]);
});

test("the response first, then the echo with the same ts, shows the message once", async () => {
  await start();

  const result = await harness.session.sendMessage({
    conversationId: channel,
    text: "hello",
  });

  await echo(result.ok ? result.ts : "");

  expect(shown()).toEqual(["hello"]);
});

test("the echo first, carrying the client message ID, replaces the pending message; the response then adds nothing", async () => {
  await start();

  const release = holdResponses();
  const sending = harness.session.sendMessage({
    conversationId: channel,
    text: "hello",
  });

  await waitFor(() => postCalls().length > 0);

  await echo("1700000000.000900", {
    client_msg_id: postCalls()[0]?.params.client_msg_id,
  });

  expect(shown()).toEqual(["hello"]);
  expect(harness.session.messages(channel)[0]?.ts).toBe("1700000000.000900");

  release();
  await sending;

  expect(harness.session.messages(channel)).toHaveLength(1);
});

test("an echo without the client message ID is held until the response gives the ts, then not shown twice", async () => {
  await start();

  const release = holdResponses();
  const sending = harness.session.sendMessage({
    conversationId: channel,
    text: "hello",
  });

  await waitFor(() => postCalls().length > 0);

  await echo("1700000000.000001");

  // Held back: only the pending message is there, not a second one.
  expect(shown()).toEqual(["hello [pending]"]);

  release();

  expect((await sending).ok).toBe(true);
  expect(shown()).toEqual(["hello"]);
  expect(harness.session.messages(channel)[0]?.ts).toBe("1700000000.000001");
});

test("a held echo that isn't ours is shown once the response arrives", async () => {
  await start();

  const release = holdResponses();
  const sending = harness.session.sendMessage({
    conversationId: channel,
    text: "mine",
  });

  await waitFor(() => postCalls().length > 0);
  await echo("1700000000.000500", { text: "from my phone" });

  expect(shown()).toEqual(["mine [pending]"]);

  release();
  await sending;

  expect(shown()).toEqual(["mine", "from my phone"]);
});

test("echoes from other people, and from other conversations, are never held", async () => {
  await start();

  const release = holdResponses();
  const sending = harness.session.sendMessage({
    conversationId: channel,
    text: "mine",
  });

  await waitFor(() => postCalls().length > 0);
  await echo("1700000000.000600", { user: "U222222222", text: "theirs" });
  await harness.sendEvents({
    type: "event_callback",
    event: {
      type: "message",
      channel: "C999",
      channel_type: "channel",
      user: me,
      text: "elsewhere",
      ts: "1700000000.000700",
    },
  });

  expect(shown()).toEqual(["theirs", "mine [pending]"]);
  expect(harness.session.messages("C999")).toHaveLength(1);

  release();
  await sending;
});

test("a failed send is marked failed, reports why and still shows held echoes", async () => {
  await start();

  let fail = () => {};
  const failing = new Promise<void>((resolve) => (fail = resolve));

  harness.slack.respond("chat.postMessage", async () => {
    await failing;

    return { ok: false, error: "not_in_channel" };
  });

  const sending = harness.session.sendMessage({
    conversationId: channel,
    text: "hello",
  });

  await waitFor(() => postCalls().length > 0);
  await echo("1700000000.000800", { text: "from my phone" });
  expect(shown()).toEqual(["hello [pending]"]);

  fail();

  expect(await sending).toEqual({
    ok: false,
    message: "You aren't in this conversation, so you can't write to it.",
  });
  expect(shown()).toEqual(["from my phone", "hello [failed]"]);
});

test("a missing scope is explained in plain words", async () => {
  await start();

  harness.slack.respond("chat.postMessage", () => ({
    ok: false,
    error: "missing_scope",
    needed: "chat:write",
  }));

  const result = await harness.session.sendMessage({
    conversationId: channel,
    text: "hello",
  });

  expect(result).toMatchObject({ ok: false });
  expect(result.ok ? "" : result.message).toContain("chat:write");
  expect(result.ok ? "" : result.message).toContain("setup");
});

test("a new send replaces the failed one in the same conversation", async () => {
  await start();

  harness.slack.respond("chat.postMessage", () => ({
    ok: false,
    error: "msg_too_long",
  }));
  await harness.session.sendMessage({ conversationId: channel, text: "one" });

  harness.slack.respond("chat.postMessage", () => ({
    ok: false,
    error: "msg_too_long",
  }));
  await harness.session.sendMessage({ conversationId: channel, text: "two" });

  expect(shown()).toEqual(["two [failed]"]);
});

test("a reply carries thread_ts and the broadcast flag", async () => {
  await start();

  const result = await harness.session.sendMessage({
    conversationId: channel,
    text: "in thread",
    threadTs: "1700000000.000100",
    broadcast: true,
  });

  expect(result.ok).toBe(true);
  expect(postCalls()[0]?.params).toMatchObject({
    thread_ts: "1700000000.000100",
    reply_broadcast: "true",
  });
  expect(shown("1700000000.000100")).toEqual(["in thread"]);
});

test("a held echo in the channel isn't confused with a send in a thread", async () => {
  await start();

  const release = holdResponses();
  const sending = harness.session.sendMessage({
    conversationId: channel,
    text: "reply",
    threadTs: "1700000000.000100",
  });

  await waitFor(() => postCalls().length > 0);
  await echo("1700000000.000300", { text: "top level, from my phone" });

  expect(shown()).toEqual(["top level, from my phone"]);

  release();
  await sending;
});

const parentTs = "1700000000.000100";

/** Stores a parent message (with the reply count history would give it). */
async function storeParent(replyCount?: number) {
  harness.slack.respond("conversations.history", () => ({
    ok: true,
    messages: [
      {
        type: "message",
        user: "U222222222",
        text: "parent",
        ts: parentTs,
        ...(replyCount === undefined
          ? {}
          : { thread_ts: parentTs, reply_count: replyCount }),
      },
    ],
    has_more: false,
  }));
  await harness.session.loadHistory(channel);
}

const replyCount = () => harness.session.message(channel, parentTs)?.replyCount;

test("a broadcast reply shows in the thread and the channel at once, once each, through to confirmation", async () => {
  await start();

  const release = holdResponses();
  const sending = harness.session.sendMessage({
    conversationId: channel,
    text: "loud",
    threadTs: parentTs,
    broadcast: true,
  });

  await waitFor(() => postCalls().length > 0);
  expect(shown(parentTs)).toEqual(["loud [pending]"]);
  expect(shown()).toEqual(["loud [pending]"]);

  release();
  await sending;

  expect(shown(parentTs)).toEqual(["loud"]);
  expect(shown()).toEqual(["loud"]);
});

test("a reply that isn't broadcast stays out of the channel", async () => {
  await start();
  await harness.session.sendMessage({
    conversationId: channel,
    text: "quiet",
    threadTs: parentTs,
  });

  expect(shown()).toEqual([]);
});

test("a confirmed reply raises the parent's reply count", async () => {
  await start();
  await storeParent();

  expect(replyCount()).toBeUndefined();

  await harness.session.sendMessage({
    conversationId: channel,
    text: "first",
    threadTs: parentTs,
  });

  expect(replyCount()).toBe(1);
});

test("the reply's echo, in either order, doesn't count it twice", async () => {
  await start();
  await storeParent(2);

  const result = await harness.session.sendMessage({
    conversationId: channel,
    text: "response first",
    threadTs: parentTs,
  });

  await echo(result.ok ? result.ts : "", {
    thread_ts: parentTs,
    text: "response first",
  });
  expect(replyCount()).toBe(3);

  const release = holdResponses();
  const sending = harness.session.sendMessage({
    conversationId: channel,
    text: "echo first",
    threadTs: parentTs,
  });

  await waitFor(() => postCalls().length > 1);
  await echo("1700000000.000950", {
    thread_ts: parentTs,
    text: "echo first",
    client_msg_id: postCalls()[1]?.params.client_msg_id,
  });
  release();
  await sending;

  expect(replyCount()).toBe(4);
  expect(shown(parentTs)).toEqual(["response first", "echo first"]);
});

test("a held echo is counted once when the response gives its ts", async () => {
  await start();
  await storeParent(0);

  const release = holdResponses();
  const sending = harness.session.sendMessage({
    conversationId: channel,
    text: "reply",
    threadTs: parentTs,
  });

  await waitFor(() => postCalls().length > 0);
  await echo("1700000000.000960", { thread_ts: parentTs, text: "from phone" });
  expect(replyCount()).toBe(0);

  release();
  await sending;

  expect(replyCount()).toBe(2);
});

/** Makes `chat.postMessage` fail like a dropped connection after the message went through. */
function failAfterPosting(gate: Promise<void>) {
  harness.slack.respond("chat.postMessage", async () => {
    await gate;

    return new Response("Bad gateway", { status: 502 });
  });
}

test("a send that fails in transit but was posted shows once, as delivered", async () => {
  await start();

  let drop = () => {};
  failAfterPosting(new Promise<void>((resolve) => (drop = resolve)));

  const sending = harness.session.sendMessage({
    conversationId: channel,
    text: "hello",
  });

  await waitFor(() => postCalls().length > 0);
  await echo("1700000000.000010");
  expect(shown()).toEqual(["hello [pending]"]);

  drop();

  expect(await sending).toEqual({ ok: true, ts: "1700000000.000010" });
  expect(shown()).toEqual(["hello"]);
});

test("a transit failure leaves the send failed when no echo of it was held", async () => {
  await start();

  failAfterPosting(Promise.resolve());

  const result = await harness.session.sendMessage({
    conversationId: channel,
    text: "hello",
  });

  expect(result.ok).toBe(false);
  expect(shown()).toEqual(["hello [failed]"]);
});

test("a Slack refusal never claims a held echo with the same text", async () => {
  await start();

  let fail = () => {};
  const failing = new Promise<void>((resolve) => (fail = resolve));

  harness.slack.respond("chat.postMessage", async () => {
    await failing;

    return { ok: false, error: "msg_too_long" };
  });

  const sending = harness.session.sendMessage({
    conversationId: channel,
    text: "hello",
  });

  await waitFor(() => postCalls().length > 0);
  await echo("1700000000.000011");
  fail();

  expect((await sending).ok).toBe(false);
  expect(shown()).toEqual(["hello", "hello [failed]"]);
});

test("a broadcast reply that fails shows as failed in the thread and the channel", async () => {
  await start();

  harness.slack.respond("chat.postMessage", () => ({
    ok: false,
    error: "msg_too_long",
  }));
  await harness.session.sendMessage({
    conversationId: channel,
    text: "loud",
    threadTs: parentTs,
    broadcast: true,
  });

  expect(shown(parentTs)).toEqual(["loud [failed]"]);
  expect(shown()).toEqual(["loud [failed]"]);
});

test("a pending reply that isn't broadcast stays out of the channel", async () => {
  await start();

  const release = holdResponses();
  const sending = harness.session.sendMessage({
    conversationId: channel,
    text: "quiet",
    threadTs: parentTs,
  });

  await waitFor(() => postCalls().length > 0);
  expect(shown()).toEqual([]);

  release();
  await sending;
});
