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
const other = "U222222222";
const ts = "1600000100.000001";
const request = { conversationId: channel, ts };

async function start(
  reactions: Record<string, unknown>[] | null = [
    { name: "tada", users: [other], count: 1 },
  ],
) {
  harness = await startSessionHarness({
    prepare: (slack) =>
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [
          {
            type: "message",
            user: other,
            text: "party",
            ts,
            reactions: reactions ?? undefined,
          },
        ],
        has_more: false,
      })),
  });
  await waitFor(() => harness.session.currentUserId);
  await harness.session.loadHistory(channel);
}

const calls = (method: string) =>
  harness.slack.calls.filter((call) => call.method === method);

const reactions = () => harness.session.message(channel, ts)?.reactions;

function echo(action: "added" | "removed", name: string, user = me) {
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

/** Makes a method wait until the returned function is called. */
function hold(method: string): () => void {
  const normal = harness.slack.handler(method);
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));

  harness.slack.respond(method, async (call) => {
    await gate;

    return normal(call);
  });

  return release;
}

test("adding shows at once, calls reactions.add by name, and the echo doesn't count again", async () => {
  await start();

  const release = hold("reactions.add");
  const result = harness.session.addReaction({ ...request, name: "tada" });

  expect(reactions()).toEqual([
    { name: "tada", userIds: [other, me], count: 2 },
  ]);

  release();

  expect(await result).toEqual({ ok: true });
  expect(calls("reactions.add")[0]?.params).toMatchObject({
    channel,
    timestamp: ts,
    name: "tada",
  });

  await echo("added", "tada");

  expect(reactions()).toEqual([
    { name: "tada", userIds: [other, me], count: 2 },
  ]);
});

test("a new reaction on a message termslack was never told the reactions of is added to an empty list", async () => {
  await start(null);

  await harness.session.addReaction({ ...request, name: "+1::skin-tone-2" });

  expect(reactions()).toEqual([
    { name: "+1::skin-tone-2", userIds: [me], count: 1 },
  ]);
  expect(calls("reactions.add")[0]?.params).toMatchObject({
    name: "+1::skin-tone-2",
  });
});

test("removing shows at once, calls reactions.remove, and the echo doesn't lower the count twice", async () => {
  await start([{ name: "tada", users: [me, other], count: 3 }]);

  const release = hold("reactions.remove");
  const result = harness.session.removeReaction({ ...request, name: "tada" });

  expect(reactions()).toEqual([{ name: "tada", userIds: [other], count: 2 }]);

  release();

  expect(await result).toEqual({ ok: true });
  expect(calls("reactions.remove")[0]?.params).toMatchObject({
    channel,
    timestamp: ts,
    name: "tada",
  });

  await echo("removed", "tada");

  expect(reactions()).toEqual([{ name: "tada", userIds: [other], count: 2 }]);
});

test("removing your only reaction takes the line away", async () => {
  await start([{ name: "tada", users: [me], count: 1 }]);
  await harness.session.removeReaction({ ...request, name: "tada" });

  expect(reactions()).toEqual([]);
});

test("hasReacted tells whether the current user is among a reaction's users", async () => {
  await start([
    { name: "tada", users: [me], count: 1 },
    { name: "heart", users: [other], count: 1 },
  ]);

  expect(
    harness.session.hasReacted({ conversationId: channel, ts }, "tada"),
  ).toBe(true);
  expect(
    harness.session.hasReacted({ conversationId: channel, ts }, "heart"),
  ).toBe(false);
  expect(
    harness.session.hasReacted({ conversationId: channel, ts }, "eyes"),
  ).toBe(false);
});

test("a refused add is taken back with the reason in words", async () => {
  await start();
  harness.slack.respond("reactions.add", () => ({
    ok: false,
    error: "too_many_reactions",
  }));

  const before = reactions();
  const result = await harness.session.addReaction({
    ...request,
    name: "eyes",
  });

  expect(result.ok).toBe(false);
  expect(result.ok === false && result.message).toContain("most reactions");
  expect(reactions()).toEqual(before!);
});

test("a refused remove puts your reaction back", async () => {
  await start([{ name: "tada", users: [me, other], count: 2 }]);
  harness.slack.respond("reactions.remove", () => ({
    ok: false,
    error: "invalid_name",
  }));

  const result = await harness.session.removeReaction({
    ...request,
    name: "tada",
  });

  expect(result.ok === false && result.message).toContain("doesn't know");
  expect(reactions()).toEqual([
    { name: "tada", userIds: [other, me], count: 2 },
  ]);
});

test("already_reacted leaves the reaction there and is not a failure", async () => {
  await start();
  harness.slack.respond("reactions.add", () => ({
    ok: false,
    error: "already_reacted",
  }));

  const result = await harness.session.addReaction({
    ...request,
    name: "tada",
  });

  expect(result).toEqual({ ok: true });
  expect(reactions()).toEqual([
    { name: "tada", userIds: [other, me], count: 2 },
  ]);
});

test("no_reaction leaves the reaction gone and is not a failure", async () => {
  await start([{ name: "tada", users: [me], count: 1 }]);
  harness.slack.respond("reactions.remove", () => ({
    ok: false,
    error: "no_reaction",
  }));

  const result = await harness.session.removeReaction({
    ...request,
    name: "tada",
  });

  expect(result).toEqual({ ok: true });
  expect(reactions()).toEqual([]);
});

test("missing_scope says which permission to grant", async () => {
  await start();
  harness.slack.respond("reactions.add", () => ({
    ok: false,
    error: "missing_scope",
  }));

  const result = await harness.session.addReaction({
    ...request,
    name: "eyes",
  });

  expect(result.ok === false && result.message).toContain("reactions:write");
});

test("a failed add doesn't undo a removal that arrived meanwhile", async () => {
  await start();
  harness.slack.respond("reactions.add", async () => {
    await echo("removed", "eyes");

    return { ok: false, error: "invalid_name" };
  });

  await harness.session.addReaction({ ...request, name: "eyes" });

  expect(reactions()).toEqual([{ name: "tada", userIds: [other], count: 1 }]);
});

test("a message that isn't stored (still sending) can't be reacted to", async () => {
  await start();

  expect(
    harness.session.reactionProblem({ conversationId: channel, ts: "1.1" }),
  ).toContain("hasn't been sent");
  expect(
    harness.session.reactionProblem({ conversationId: channel, ts }),
  ).toBeUndefined();

  const result = await harness.session.addReaction({
    conversationId: channel,
    ts: "1.1",
    name: "tada",
  });

  expect(result.ok).toBe(false);
  expect(calls("reactions.add")).toHaveLength(0);
});

test("removing when the list is incomplete isn't lowered again by the echo", async () => {
  await start([{ name: "tada", users: [me], count: 4 }]);
  await harness.session.removeReaction({ ...request, name: "tada" });
  await echo("removed", "tada");

  expect(reactions()).toEqual([{ name: "tada", userIds: [], count: 3 }]);
});

test("the session lists the workspace's custom emoji names", async () => {
  harness = await startSessionHarness({
    prepare: (slack) =>
      slack.respond("emoji.list", () => ({
        ok: true,
        emoji: { partyparrot: "https://x/y.gif", parrot: "alias:partyparrot" },
      })),
  });

  await waitFor(() => harness.session.customEmojiNames().length > 0);

  expect(harness.session.customEmojiNames().sort()).toEqual([
    "parrot",
    "partyparrot",
  ]);
});
