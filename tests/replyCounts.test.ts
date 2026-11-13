import { afterEach, beforeEach, expect, test } from "bun:test";
import { loadFixture } from "./support/fixtures";
import {
  type SessionHarness,
  startSessionHarness,
} from "./support/sessionHarness";

let harness: SessionHarness;

beforeEach(async () => {
  harness = await startSessionHarness();
});

afterEach(() => harness.stop());

const channel = "C123ABC456";
const parentTs = "1673464730.703009";

const replyCount = () => harness.session.message(channel, parentTs)?.replyCount;

async function sendParent() {
  const [parent] = await loadFixture("thread-reply");

  await harness.sendEvents(parent!);
}

async function sendReply() {
  const [, reply] = await loadFixture("thread-reply");

  await harness.sendEvents(reply!);
}

test("a live reply gives its stored parent a reply count", async () => {
  await sendParent();

  expect(replyCount()).toBeUndefined();

  await sendReply();

  expect(replyCount()).toBe(1);
});

test("a live reply adds to the count history gave the parent", async () => {
  harness.slack.respond("conversations.history", () => ({
    ok: true,
    messages: [
      {
        type: "message",
        user: "U123ABC456",
        text: "parent",
        ts: parentTs,
        thread_ts: parentTs,
        reply_count: 4,
      },
    ],
    has_more: false,
  }));
  await harness.session.loadHistory(channel);

  expect(replyCount()).toBe(4);

  await sendReply();

  expect(replyCount()).toBe(5);
});

test("the same reply delivered twice is counted once", async () => {
  await sendParent();
  await sendReply();
  await sendReply();

  expect(replyCount()).toBe(1);
});

test("a reply whose parent isn't stored changes nothing, and the parent arriving later has no count", async () => {
  await sendReply();

  expect(replyCount()).toBeUndefined();

  await sendParent();

  expect(replyCount()).toBeUndefined();
});

test("editing the parent keeps its reply count", async () => {
  await sendParent();
  await sendReply();
  await harness.sendEvents({
    event: {
      type: "message",
      subtype: "message_changed",
      channel,
      ts: "5.5",
      message: {
        user: "U123ABC456",
        text: "edited parent",
        ts: parentTs,
        thread_ts: parentTs,
      },
    },
  });

  expect(harness.session.message(channel, parentTs)).toMatchObject({
    text: "edited parent",
    replyCount: 1,
  });
});
