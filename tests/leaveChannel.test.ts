import { afterEach, expect, test } from "bun:test";
import { loadFixture, loadPayload } from "./support/fixtures";
import { seedWorkspace } from "./support/appHarness";
import { waitFor, type FakeSlack } from "./support/fakeSlack";
import {
  type SessionHarness,
  startSessionHarness,
} from "./support/sessionHarness";

let harness: SessionHarness;

afterEach(() => harness.stop());

const general = "C012AB3CD";
const random = "C061EG9T2";
const secret = "G012AB3CD";
const dm = "D0C0F7S8Y";

const everyScope = [
  "identify",
  "channels:read",
  "channels:write",
  "groups:write",
];

async function start({
  scopes,
  leave,
}: {
  scopes?: string[];
  leave?: Parameters<FakeSlack["respond"]>[1];
} = {}) {
  const [info] = await loadFixture("conversations-info-private");
  const [channels, directs] = [
    ...(await loadFixture("users-conversations-channels")),
    ...(await loadFixture("users-conversations-dms")),
  ];

  harness = await startSessionHarness({
    prepare: async (slack) => {
      await seedWorkspace(slack);
      slack.respondPaged("users.conversations", [
        {
          ...channels!,
          channels: [...channels!.channels, info!.channel],
          response_metadata: { next_cursor: "dGVhbTpEMDYxRkE1UEI=" },
        },
        directs!,
      ]);

      if (scopes) {
        slack.grantScopes(scopes);
      }

      if (leave) {
        slack.respond("conversations.leave", leave);
      }
    },
  });
  await waitFor(() => harness.session.conversation(secret));
  await waitFor(() => harness.session.currentUserId);
}

const calls = () =>
  harness.slack.calls.filter((call) => call.method === "conversations.leave");

const isMember = (id: string) => harness.session.conversation(id)?.isMember;

test("leaving a public channel calls conversations.leave and the store says the user is out", async () => {
  await start({ scopes: everyScope });

  expect(await harness.session.leaveChannel(random)).toEqual({ ok: true });

  expect(calls().map((call) => call.params)).toEqual([{ channel: random }]);
  expect(isMember(random)).toBe(false);
  expect(isMember(general)).toBe(true);
});

test("a private channel is left the same way, with groups:write", async () => {
  await start({ scopes: ["identify", "groups:write"] });

  expect(await harness.session.leaveChannel(secret)).toEqual({ ok: true });

  expect(calls().map((call) => call.params)).toEqual([{ channel: secret }]);
  expect(isMember(secret)).toBe(false);
});

test("without channels:write a public channel isn't left, and Slack isn't asked", async () => {
  await start({ scopes: ["identify", "groups:write"] });

  const message = harness.session.conversationProblem("leave", random);
  const result = await harness.session.leaveChannel(random);

  expect(message).toContain("channels:write");
  expect(result).toEqual({ ok: false, message: message! });
  expect(calls()).toHaveLength(0);
  expect(isMember(random)).toBe(true);
});

test("without groups:write a private channel isn't left, and Slack isn't asked", async () => {
  await start({ scopes: ["identify", "channels:write"] });

  const result = await harness.session.leaveChannel(secret);

  expect(result).toMatchObject({ ok: false });
  expect(JSON.stringify(result)).toContain("groups:write");
  expect(harness.session.conversationProblem("leave", random)).toBeUndefined();
  expect(calls()).toHaveLength(0);
  expect(isMember(secret)).toBe(true);
});

test("when the granted scopes aren't known Slack decides", async () => {
  await start();

  expect(harness.session.conversationProblem("leave", random)).toBeUndefined();
  expect(await harness.session.leaveChannel(random)).toEqual({ ok: true });
});

test("a DM can't be left, and Slack isn't asked", async () => {
  await start({ scopes: everyScope });

  const result = await harness.session.leaveChannel(dm);

  expect(result).toMatchObject({ ok: false });
  expect(harness.session.conversationProblem("leave", dm)).toContain(
    "Only channels",
  );
  expect(calls()).toHaveLength(0);
  expect(isMember(dm)).toBe(true);
});

test("an unknown conversation can't be left", async () => {
  await start({ scopes: everyScope });

  expect(await harness.session.leaveChannel("C0NOSUCH1")).toMatchObject({
    ok: false,
  });
  expect(calls()).toHaveLength(0);
});

test.each([
  ["cant_leave_general", "#general"],
  ["last_member", "last member"],
  ["restricted_action", "settings"],
  ["missing_scope", "channels:write"],
  ["channel_not_found", "can't find"],
  ["something_new", "something_new"],
])(
  "Slack's %p refusal is explained and the channel stays",
  async (error, text) => {
    await start({ leave: () => ({ ok: false, error }) });

    const result = await harness.session.leaveChannel(random);

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain(text);
    expect(isMember(random)).toBe(true);
  },
);

test("a missing scope Slack reports for a private channel names groups:write", async () => {
  await start({ leave: () => ({ ok: false, error: "missing_scope" }) });

  expect(await harness.session.leaveChannel(secret)).toMatchObject({
    ok: false,
    message: expect.stringContaining("groups:write"),
  });
});

test("a failure that isn't Slack's is explained too", async () => {
  await start({ leave: () => new Response("down", { status: 500 }) });

  const result = await harness.session.leaveChannel(random);

  expect(result).toMatchObject({ ok: false });
  expect(isMember(random)).toBe(true);
});

test("leaving a channel the user was already out of is fine", async () => {
  await start({ leave: () => ({ ok: true, not_in_channel: true }) });

  expect(await harness.session.leaveChannel(random)).toEqual({ ok: true });
  expect(isMember(random)).toBe(false);
});

test("a channel the store knows the user is out of isn't left again", async () => {
  await start();

  await harness.session.leaveChannel(random);
  await harness.session.leaveChannel(random);

  expect(calls()).toHaveLength(1);
});

test("leaving twice at once asks Slack once", async () => {
  await start();

  const results = await Promise.all([
    harness.session.leaveChannel(random),
    harness.session.leaveChannel(random),
  ]);

  expect(results).toEqual([{ ok: true }, { ok: true }]);
  expect(calls()).toHaveLength(1);
});

test("a left channel stays listed once, as one the user isn't in", async () => {
  await start();

  await harness.session.leaveChannel(random);

  expect(
    harness.session.conversations().filter(({ id }) => id === random),
  ).toHaveLength(1);
  expect(harness.session.conversation(random)).toMatchObject({
    name: "random",
    isMember: false,
  });
});

test("the channel_left echo of the user's own leave changes nothing more", async () => {
  await start();

  await harness.session.leaveChannel(random);

  const event = await loadPayload("channel-left");

  event.event.channel = random;
  await harness.sendEvents(event);

  expect(isMember(random)).toBe(false);
  expect(
    harness.session.conversations().filter(({ id }) => id === random),
  ).toHaveLength(1);
});

test("channel_left, group_left and the user's own member_left_channel take the channel out", async () => {
  await start();

  await harness.sendEvents(await loadPayload("channel-left"));
  expect(isMember(general)).toBe(false);

  await harness.sendEvents(await loadPayload("group-left"));
  expect(isMember(secret)).toBe(false);

  const left = await loadPayload("member-left-channel");

  left.event.channel = random;
  expect(await harness.sendEvents(left)).toMatchObject({
    kind: "conversation",
    action: "memberLeft",
    channelId: random,
    userId: "U123ABC456",
  });
  expect(isMember(random)).toBe(false);
});

test("someone else leaving a channel doesn't change the user's membership", async () => {
  await start();

  const left = await loadPayload("member-left-channel");

  left.event.user = "U999999999";
  await harness.sendEvents(left);

  expect(isMember(general)).toBe(true);
});

test("a left public channel can be joined again", async () => {
  await start({ scopes: everyScope });
  harness.slack.respond("conversations.join", () => ({
    ok: true,
    channel: {
      id: random,
      name: "random",
      is_channel: true,
      is_private: false,
      is_member: true,
    },
  }));

  await harness.session.leaveChannel(random);
  await harness.session.joinChannel(random);

  expect(isMember(random)).toBe(true);
});
