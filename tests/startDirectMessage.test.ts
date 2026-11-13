import { afterEach, expect, test } from "bun:test";
import { loadFixture } from "./support/fixtures";
import { waitFor } from "./support/fakeSlack";
import {
  type SessionHarness,
  startSessionHarness,
} from "./support/sessionHarness";

let harness: SessionHarness;

afterEach(() => harness.stop());

const ray = "U555555555";
const newDm = "D069C7QFK";
const petersDm = "D0C0F7S8Y";

const everyScope = ["identify", "chat:write", "im:write"];

/** A session that has loaded the channels and the three DMs from the fixtures. */
async function start({
  scopes,
  open,
}: {
  scopes?: string[];
  open?: Parameters<SessionHarness["slack"]["respond"]>[1];
} = {}) {
  const [created] = await loadFixture("conversations-open");

  harness = await startSessionHarness({
    prepare: async (slack) => {
      slack.respondPaged("users.conversations", [
        ...(await loadFixture("users-conversations-channels")),
        ...(await loadFixture("users-conversations-dms")),
      ]);

      if (scopes) {
        slack.grantScopes(scopes);
      }

      slack.respond("conversations.open", open ?? (() => created!));
    },
  });
  await waitFor(() => harness.session.conversation("D0BSHH4AD"));
  await waitFor(() => harness.session.currentUserId);
}

const openCalls = () =>
  harness.slack.calls.filter((call) => call.method === "conversations.open");

const listed = (id: string) =>
  harness.session
    .conversations()
    .filter((conversation) => conversation.id === id);

test("starting a DM calls conversations.open with the person's ID and stores it as a DM with them", async () => {
  await start({ scopes: everyScope });
  const before = harness.session.conversations().length;

  const result = await harness.session.startDirectMessage(ray);

  expect(result).toEqual({ ok: true, conversationId: newDm });
  expect(openCalls().map((call) => call.params)).toEqual([{ users: ray }]);
  expect(harness.session.conversations()).toHaveLength(before + 1);
  expect(harness.session.conversation(newDm)).toMatchObject({
    kind: "im",
    userId: ray,
    isMember: true,
    isArchived: false,
  });
});

test("the new DM counts as recently active", async () => {
  await start({ scopes: everyScope });
  const startedAt = Date.now();

  await harness.session.startDirectMessage(ray);

  expect(harness.session.dmActivity(newDm)).toBeGreaterThanOrEqual(
    startedAt - 1000,
  );
  expect(harness.session.isDmHidden(newDm)).toBe(false);
});

test("a DM the store already has for the person is opened without calling Slack", async () => {
  await start({ scopes: everyScope });

  const result = await harness.session.startDirectMessage("U222222222");

  expect(result).toEqual({ ok: true, conversationId: petersDm });
  expect(openCalls()).toHaveLength(0);
});

test("Slack answering with a DM it already had (no_op) adds it once, and asking again doesn't call Slack", async () => {
  const [, existing] = await loadFixture("conversations-open");

  await start({ scopes: everyScope, open: () => existing! });

  const first = await harness.session.startDirectMessage(ray);
  const second = await harness.session.startDirectMessage(ray);

  expect(first).toEqual({ ok: true, conversationId: newDm });
  expect(second).toEqual({ ok: true, conversationId: newDm });
  expect(listed(newDm)).toHaveLength(1);
  expect(openCalls()).toHaveLength(1);
});

test("an ID the store already lists isn't added twice and keeps what the store knew", async () => {
  await start({
    scopes: everyScope,
    open: () => ({ ok: true, channel: { id: petersDm } }),
  });
  const known = harness.session.conversation(petersDm);

  const result = await harness.session.startDirectMessage(ray);

  expect(result).toEqual({ ok: true, conversationId: petersDm });
  expect(listed(petersDm)).toHaveLength(1);
  expect(harness.session.conversation(petersDm)).toEqual(known);
});

test("starting the same DM twice at once makes one call", async () => {
  await start({ scopes: everyScope });

  const [first, second] = await Promise.all([
    harness.session.startDirectMessage(ray),
    harness.session.startDirectMessage(ray),
  ]);

  expect(first).toEqual(second);
  expect(openCalls()).toHaveLength(1);
  expect(listed(newDm)).toHaveLength(1);
});

test.each([
  ["user_not_found", "can't find that person"],
  ["user_disabled", "deactivated"],
  ["cannot_dm_bot", "bot"],
  ["missing_scope", "im:write"],
  ["ratelimited_somehow", "ratelimited_somehow"],
])(
  "Slack refusing with %s says why and changes nothing",
  async (error, words) => {
    await start({
      scopes: everyScope,
      open: () => ({ ok: false, error }),
    });
    const before = harness.session.conversations();

    const result = await harness.session.startDirectMessage(ray);

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toContain(words);
    expect(harness.session.conversations()).toEqual(before);
  },
);

test("without im:write nothing reaches Slack and the message says how to grant it", async () => {
  await start({ scopes: ["identify", "chat:write"] });

  const result = await harness.session.startDirectMessage(ray);

  expect(harness.session.scopeProblem("dm")).toContain("im:write");
  expect(result.ok).toBe(false);
  expect(result.ok ? "" : result.message).toContain(
    "Starting direct messages is off",
  );
  expect(result.ok ? "" : result.message).toContain("setup");
  expect(openCalls()).toHaveLength(0);
});

test("starting DMs stays available when the granted scopes aren't known", async () => {
  await start();

  expect(harness.session.scopeProblem("dm")).toBeUndefined();
  expect((await harness.session.startDirectMessage(ray)).ok).toBe(true);
});
