import { afterEach, beforeEach, expect, test } from "bun:test";
import { waitFor } from "./support/fakeSlack";
import {
  type SessionHarness,
  startSessionHarness,
} from "./support/sessionHarness";

let harness: SessionHarness;

const me = "U123ABC456";
const other = "U222222222";
const general = "C012AB3CD";
const random = "C061EG9T2";
const directMessage = "D0C0F7S8Y";
const groupDm = "G0AKFJBEU";
const marketing = "S0615G0KT";
const admins = "S0614TZR7";

let counter = 0;

function userGroups(users: Record<string, string[]>) {
  return {
    ok: true,
    usergroups: Object.entries(users).map(([id, userIds]) => ({
      id,
      handle: `handle-${id.toLowerCase()}`,
      name: `Group ${id}`,
      users: userIds,
    })),
  };
}

async function start(groups: Record<string, string[]> = {}) {
  harness = await startSessionHarness({
    prepare: (slack) => {
      slack.respond("usergroups.list", () => userGroups(groups));
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [],
      }));
    },
  });
  await waitFor(() => harness.session.currentUserId);
}

afterEach(() => harness.stop());

/** Sends a message event and waits until the session has published it. */
function say(
  channel: string,
  overrides: Record<string, unknown> = {},
  channelType = "channel",
) {
  counter += 1;

  return harness.sendEvents({
    event: {
      type: "message",
      channel,
      channel_type: channelType,
      user: other,
      text: "hello there",
      ts: `1700000000.${String(counter).padStart(6, "0")}`,
      ...overrides,
    },
  });
}

const markers = (id: string) => harness.session.markers(id);

test("a message from someone else in a conversation that isn't open marks it unread", async () => {
  await start();

  await say(general);

  expect(markers(general)).toEqual({ isUnread: true, mentions: 0 });
  expect(markers(random)).toEqual({ isUnread: false, mentions: 0 });
});

test("the user's own messages never mark a conversation", async () => {
  await start();

  await say(general, { user: me, text: `<@${me}> note to self` });

  expect(markers(general)).toEqual({ isUnread: false, mentions: 0 });
});

test("messages in the open conversation never mark it", async () => {
  await start();

  harness.session.setOpenConversation(general);
  await say(general, { text: `<@${me}> hi` });
  await say(general, {}, "channel");

  expect(markers(general)).toEqual({ isUnread: false, mentions: 0 });

  harness.session.setOpenConversation(undefined);
  await say(general);

  expect(markers(general).isUnread).toBe(true);
});

test("opening a conversation clears its unread and mention markers", async () => {
  await start();

  await say(general, { text: "<!here> standup" });
  await say(random);

  await harness.session.loadHistory(general);
  harness.session.setOpenConversation(general);

  expect(markers(general)).toEqual({ isUnread: false, mentions: 0 });
  expect(markers(random).isUnread).toBe(true);
});

test("markers change the session's version so views redraw", async () => {
  await start();

  const before = harness.session.version();

  await say(general);

  expect(harness.session.version()).not.toBe(before);

  await harness.session.loadHistory(general);

  const opened = harness.session.version();

  harness.session.setOpenConversation(general);

  expect(harness.session.version()).not.toBe(opened);
});

test("a mention of the user counts, and each mentioning message adds one", async () => {
  await start();

  await say(general, { text: `hey <@${me}>` });
  await say(general, { text: "no mention" });
  await say(general, { text: `<@${me}> again, and <@${me}>` });

  expect(markers(general)).toEqual({ isUnread: true, mentions: 2 });
});

test("a mention of someone else is only unread", async () => {
  await start();

  await say(general, { text: "<@U333333333> look" });

  expect(markers(general)).toEqual({ isUnread: true, mentions: 0 });
});

test.each(["here", "channel", "everyone"])(
  "@%s counts as a mention",
  async (target) => {
    await start();

    await say(general, { text: `<!${target}> news` });

    expect(markers(general)).toEqual({ isUnread: true, mentions: 1 });
  },
);

test("a mention found only in the blocks text counts", async () => {
  await start();

  await say(general, {
    text: "",
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `<@${me}> from a block` },
      },
    ],
  });

  expect(markers(general).mentions).toBe(1);
});

test("a user group the user belongs to counts; one they don't doesn't", async () => {
  await start({ [marketing]: [me, other], [admins]: [other] });
  await waitFor(() => harness.session.isInUserGroup(marketing));

  await say(general, { text: `<!subteam^${marketing}|@marketing> ping` });
  await say(random, { text: `<!subteam^${admins}|@admins> ping` });

  expect(markers(general)).toEqual({ isUnread: true, mentions: 1 });
  expect(markers(random)).toEqual({ isUnread: true, mentions: 0 });
});

test("every message in a DM or group DM is a mention", async () => {
  await start();

  await say(directMessage, { text: "hi" }, "im");
  await say(directMessage, { text: "hi again" }, "im");
  await say(groupDm, { text: "hi all" }, "mpim");

  expect(markers(directMessage)).toEqual({ isUnread: true, mentions: 2 });
  expect(markers(groupDm)).toEqual({ isUnread: true, mentions: 1 });
});

test("a DM is recognised from the store when the event doesn't say", async () => {
  await start();
  harness.slack.respond("conversations.info", () => ({
    ok: true,
    channel: { id: directMessage, is_im: true, user: other },
  }));
  await harness.session.resolveConversationPeople(directMessage);

  await say(directMessage, { text: "hi" }, "");

  expect(markers(directMessage).mentions).toBe(1);
});

test("file shares, thread broadcasts and bot messages count", async () => {
  await start();

  await say(general, {
    subtype: "file_share",
    text: "",
    files: [{ name: "a.png" }],
  });
  await say(random, {
    subtype: "thread_broadcast",
    thread_ts: "1699999999.000001",
  });
  await say(
    directMessage,
    {
      subtype: "bot_message",
      user: undefined,
      bot_id: "B1",
      text: "build done",
    },
    "im",
  );

  expect(markers(general).isUnread).toBe(true);
  expect(markers(random).isUnread).toBe(true);
  expect(markers(directMessage).mentions).toBe(1);
});

test("a plain thread reply in a channel doesn't mark it", async () => {
  await start();

  await say(general, { thread_ts: "1699999999.000001", text: "just a reply" });

  expect(markers(general)).toEqual({ isUnread: false, mentions: 0 });
});

test("a thread reply that mentions the user marks a mention", async () => {
  await start();

  await say(general, {
    thread_ts: "1699999999.000001",
    text: `<@${me}> reply`,
  });

  expect(markers(general)).toEqual({ isUnread: true, mentions: 1 });
});

test("a thread reply mentioning someone else doesn't mark the channel", async () => {
  await start();

  await say(general, {
    thread_ts: "1699999999.000001",
    text: "<@U333333333> reply",
  });

  expect(markers(general)).toEqual({ isUnread: false, mentions: 0 });
});

test.each(["here", "channel", "everyone"])(
  "a thread reply with @%s marks a mention",
  async (target) => {
    await start();

    await say(general, {
      thread_ts: "1699999999.000001",
      text: `<!${target}> heads up`,
    });

    expect(markers(general)).toEqual({ isUnread: true, mentions: 1 });
  },
);

test("a thread reply mentioning the user's group marks a mention", async () => {
  await start({ [marketing]: [me], [admins]: [other] });
  await waitFor(() => harness.session.isInUserGroup(marketing));

  await say(general, {
    thread_ts: "1699999999.000001",
    text: `<!subteam^${marketing}|@marketing> ping`,
  });
  await say(random, {
    thread_ts: "1699999999.000001",
    text: `<!subteam^${admins}|@admins> ping`,
  });

  expect(markers(general)).toEqual({ isUnread: true, mentions: 1 });
  expect(markers(random)).toEqual({ isUnread: false, mentions: 0 });
});

test("any reply in a DM or group DM thread is a mention", async () => {
  await start();

  await say(
    directMessage,
    { thread_ts: "1699999999.000001", text: "reply" },
    "im",
  );
  await say(groupDm, { thread_ts: "1699999999.000001", text: "reply" }, "mpim");

  expect(markers(directMessage)).toEqual({ isUnread: true, mentions: 1 });
  expect(markers(groupDm)).toEqual({ isUnread: true, mentions: 1 });
});

test("your own thread reply never marks anything", async () => {
  await start();

  await say(
    directMessage,
    { thread_ts: "1699999999.000001", user: me, text: "reply" },
    "im",
  );

  expect(markers(directMessage)).toEqual({ isUnread: false, mentions: 0 });
});

test("an unknown subtype that mentions the user marks a mention", async () => {
  await start();

  await say(general, { subtype: "reminder_add", text: `<@${me}> stand up` });

  expect(markers(general)).toEqual({ isUnread: true, mentions: 1 });
});

test("an unknown subtype that mentions nobody is ignored in a channel", async () => {
  await start();

  await say(general, { subtype: "reminder_add", text: "stand up" });

  expect(markers(general)).toEqual({ isUnread: false, mentions: 0 });
});

test("an unknown subtype in a DM marks a mention", async () => {
  await start();

  await say(directMessage, { subtype: "reminder_add", text: "stand up" }, "im");

  expect(markers(directMessage)).toEqual({ isUnread: true, mentions: 1 });
});

test.each([
  "channel_join",
  "channel_leave",
  "group_join",
  "group_leave",
  "channel_topic",
  "channel_purpose",
  "channel_name",
  "channel_archive",
  "channel_unarchive",
  "group_topic",
  "group_purpose",
  "group_name",
  "group_archive",
  "group_unarchive",
  "pinned_item",
  "unpinned_item",
])(
  "%s never marks anything, even with a mention or in a DM",
  async (subtype) => {
    await start();

    await say(general, { subtype, text: `<@${me}> <!here> noise` });
    await say(directMessage, { subtype, text: `<@${me}> noise` }, "im");

    expect(markers(general)).toEqual({ isUnread: false, mentions: 0 });
    expect(markers(directMessage)).toEqual({ isUnread: false, mentions: 0 });
  },
);

test("edits, deletions, joins and unknown subtypes don't mark a conversation", async () => {
  await start();

  await say(general, {
    subtype: "channel_join",
    text: "<@U222222222> has joined",
  });
  await say(general, { subtype: "channel_topic", text: "new topic" });
  await harness.sendEvents({
    event: {
      type: "message",
      subtype: "message_changed",
      channel: general,
      channel_type: "channel",
      message: {
        type: "message",
        user: other,
        text: `<@${me}> edited`,
        ts: "1.1",
      },
      ts: "2.2",
    },
  });
  await harness.sendEvents({
    event: {
      type: "message",
      subtype: "message_deleted",
      channel: general,
      channel_type: "channel",
      deleted_ts: "1.1",
      ts: "3.3",
    },
  });

  expect(markers(general)).toEqual({ isUnread: false, mentions: 0 });
});

test("a message delivered twice counts once", async () => {
  await start();

  const ts = "1700000001.000001";

  await say(general, { ts, text: "<!here>" });
  await say(general, { ts, text: "<!here>" });

  expect(markers(general).mentions).toBe(1);
});

test("subteam_self_added and subteam_self_removed change membership", async () => {
  await start({ [marketing]: [other] });

  expect(harness.session.isInUserGroup(marketing)).toBe(false);

  await harness.sendEvents({
    event: {
      type: "subteam_self_added",
      subteam_id: marketing,
      event_ts: "1.1",
    },
  });
  expect(harness.session.isInUserGroup(marketing)).toBe(true);

  await say(general, { text: `<!subteam^${marketing}>` });
  expect(markers(general).mentions).toBe(1);

  await harness.sendEvents({
    event: {
      type: "subteam_self_removed",
      subteam_id: marketing,
      event_ts: "1.2",
    },
  });
  expect(harness.session.isInUserGroup(marketing)).toBe(false);
});

test("subteam_members_changed adds and removes the user", async () => {
  await start({ [marketing]: [me], [admins]: [other] });
  await waitFor(() => harness.session.isInUserGroup(marketing));

  await harness.sendEvents({
    event: {
      type: "subteam_members_changed",
      subteam_id: marketing,
      added_users: [other],
      removed_users: [me],
      event_ts: "1.1",
    },
  });
  expect(harness.session.isInUserGroup(marketing)).toBe(false);

  await harness.sendEvents({
    event: {
      type: "subteam_members_changed",
      subteam_id: admins,
      added_users: [me, other],
      removed_users: [],
      event_ts: "1.2",
    },
  });
  expect(harness.session.isInUserGroup(admins)).toBe(true);

  await harness.sendEvents({
    event: {
      type: "subteam_members_changed",
      subteam_id: admins,
      added_users: [],
      removed_users: [other],
      event_ts: "1.3",
    },
  });
  expect(harness.session.isInUserGroup(admins)).toBe(true);
});

test("a membership event isn't undone by a listing that was fetched before it", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));

  harness = await startSessionHarness({
    prepare: (slack) =>
      slack.respond("usergroups.list", async () => {
        await gate;

        return userGroups({ [marketing]: [other] });
      }),
  });
  await waitFor(() => harness.session.currentUserId);

  await harness.sendEvents({
    event: {
      type: "subteam_self_added",
      subteam_id: marketing,
      event_ts: "1.1",
    },
  });
  release();
  await waitFor(() => harness.session.userGroup(marketing));

  expect(harness.session.isInUserGroup(marketing)).toBe(true);
});

test("the listing asks Slack for each group's users", async () => {
  await start({ [marketing]: [me] });

  const call = await waitFor(() =>
    harness.slack.calls.find(
      (candidate) => candidate.method === "usergroups.list",
    ),
  );

  expect(String(call?.params.include_users)).toBe("true");
});
