import { afterEach, beforeEach, expect, test } from "bun:test";
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
const ts = "1360782400.498405";

type Raw = Record<string, unknown>;

function historyWith(reactions?: Raw[]) {
  harness.slack.respond("conversations.history", () => ({
    ok: true,
    messages: [
      { type: "message", user: "U222222222", text: "hi", ts, reactions },
    ],
    has_more: false,
  }));

  return harness.session.loadHistory(channel);
}

/** The parent arriving again on a thread page, as it does when a thread is opened. */
function parentOnThreadPage(reactions?: Raw[]) {
  harness.slack.respond("conversations.replies", () => ({
    ok: true,
    messages: [
      {
        type: "message",
        user: "U222222222",
        text: "hi",
        ts,
        thread_ts: ts,
        reactions,
      },
    ],
    has_more: false,
  }));

  return harness.session.loadThreadReplies(channel, ts);
}

function react(action: "added" | "removed", user: string, name: string) {
  return harness.sendEvents({
    event: {
      type: `reaction_${action}`,
      user,
      reaction: name,
      item: { type: "message", channel, ts },
      event_ts: "1.1",
    },
  });
}

const reactions = () => harness.session.message(channel, ts)?.reactions;

test("history reactions are stored in Slack's order, count authoritative over a truncated user list", async () => {
  await historyWith([
    { name: "tada", users: ["U1"], count: 1 },
    { name: "+1::skin-tone-2", users: ["U1", "U2"], count: 40 },
    { name: "", users: ["U1"], count: 1 },
  ]);

  expect(reactions()).toEqual([
    { name: "tada", userIds: ["U1"], count: 1 },
    { name: "+1::skin-tone-2", userIds: ["U1", "U2"], count: 40 },
  ]);
});

test("a history message without reactions has an empty list", async () => {
  await historyWith(undefined);

  expect(reactions()).toEqual([]);
});

test("live reactions add new ones after existing, bump counts, and drop the last one", async () => {
  await historyWith([{ name: "tada", users: ["U1"], count: 1 }]);
  await react("added", "U2", "tada");
  await react("added", "U2", "thumbsup");

  expect(reactions()).toEqual([
    { name: "tada", userIds: ["U1", "U2"], count: 2 },
    { name: "thumbsup", userIds: ["U2"], count: 1 },
  ]);

  await react("removed", "U1", "tada");
  await react("removed", "U2", "tada");

  expect(reactions()).toEqual([
    { name: "thumbsup", userIds: ["U2"], count: 1 },
  ]);
});

test("the same user adding twice counts once", async () => {
  await historyWith([]);
  await react("added", "U2", "tada");
  await react("added", "U2", "tada");

  expect(reactions()).toEqual([{ name: "tada", userIds: ["U2"], count: 1 }]);
});

test("removing someone who isn't listed doesn't lower a complete count or go negative", async () => {
  await historyWith([{ name: "tada", users: ["U1"], count: 1 }]);
  await react("removed", "U9", "tada");
  await react("removed", "U9", "nope");

  expect(reactions()).toEqual([{ name: "tada", userIds: ["U1"], count: 1 }]);
});

test("removing someone who isn't listed lowers a truncated count", async () => {
  await historyWith([{ name: "tada", users: ["U1"], count: 3 }]);
  await react("removed", "U9", "tada");

  expect(reactions()).toEqual([{ name: "tada", userIds: ["U1"], count: 2 }]);
});

test("a reaction on a message the store doesn't hold is ignored and still published", async () => {
  const event = await react("added", "U2", "tada");

  expect(event).toMatchObject({ kind: "reaction", reaction: "tada" });
  expect(harness.session.message(channel, ts)).toBeUndefined();
});

test("a live message arriving again keeps the reactions it had", async () => {
  await historyWith([{ name: "tada", users: ["U1"], count: 1 }]);
  await harness.sendEvents({
    event: { type: "message", user: "U222222222", text: "hi", ts, channel },
  });

  expect(reactions()).toEqual([{ name: "tada", userIds: ["U1"], count: 1 }]);
});

test("a later history page replaces reactions no live event has touched", async () => {
  await historyWith([{ name: "tada", users: ["U1"], count: 1 }]);
  await parentOnThreadPage([{ name: "heart", users: ["U1"], count: 1 }]);

  expect(reactions()).toEqual([{ name: "heart", userIds: ["U1"], count: 1 }]);
});

test("a history page arriving after a live reaction doesn't undo it", async () => {
  await historyWith([{ name: "tada", users: ["U1"], count: 1 }]);
  await react("added", "U2", "tada");
  await parentOnThreadPage([{ name: "tada", users: ["U1"], count: 1 }]);

  expect(reactions()).toEqual([
    { name: "tada", userIds: ["U1", "U2"], count: 2 },
  ]);
});

test("an edited message keeps its reactions through edits and history", async () => {
  await historyWith([{ name: "tada", users: ["U1"], count: 1 }]);
  await harness.sendEvents({
    event: {
      type: "message",
      subtype: "message_changed",
      channel,
      ts: "5.5",
      message: { user: "U222222222", text: "edited", ts },
    },
  });

  expect(reactions()).toEqual([{ name: "tada", userIds: ["U1"], count: 1 }]);

  await parentOnThreadPage([{ name: "heart", users: ["U1"], count: 1 }]);

  expect(harness.session.message(channel, ts)).toMatchObject({
    text: "edited",
    reactions: [{ name: "heart", userIds: ["U1"], count: 1 }],
  });
});
