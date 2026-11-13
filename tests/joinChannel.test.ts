import { afterEach, expect, test } from "bun:test";
import { loadFixture, loadPayload } from "./support/fixtures";
import { waitFor, type FakeSlack } from "./support/fakeSlack";
import {
  type SessionHarness,
  startSessionHarness,
} from "./support/sessionHarness";

let harness: SessionHarness;

afterEach(() => harness.stop());

const general = "C012AB3CD";
const design = "C0DES1GN7";
const devops = "C0DEV0P5X";

const everyScope = ["identify", "channels:read", "channels:write"];

async function start({
  scopes,
  join,
  list,
}: {
  scopes?: string[];
  join?: Parameters<FakeSlack["respond"]>[1];
  list?: Parameters<FakeSlack["respond"]>[1];
} = {}) {
  const [joined] = await loadFixture("conversations-join");

  harness = await startSessionHarness({
    prepare: async (slack) => {
      slack.respondPaged("users.conversations", [
        (await loadFixture("users-conversations-channels"))[0]!,
      ]);
      slack.respondPaged(
        "conversations.list",
        await loadFixture("conversations-list-public"),
      );

      if (list) {
        slack.respond("conversations.list", list);
      }

      if (scopes) {
        slack.grantScopes(scopes);
      }

      slack.respond("conversations.join", join ?? (() => joined!));
    },
  });
  await waitFor(() => harness.session.conversation(general));
  await waitFor(() => harness.session.currentUserId);
}

const calls = (method: string) =>
  harness.slack.calls.filter((call) => call.method === method);

const listed = (id: string) =>
  harness.session
    .conversations()
    .filter((conversation) => conversation.id === id);

/** An event of the fixtures, moved to another channel. */
async function eventFor(fixture: string, channel: string) {
  const payload = await loadPayload(fixture);
  const { event } = payload;

  return {
    ...payload,
    event: {
      ...event,
      channel:
        typeof event.channel === "string"
          ? channel
          : { ...event.channel, id: channel },
    },
  };
}

test("the public channels aren't listed until asked for", async () => {
  await start();

  expect(harness.session.publicChannelsStatus()).toBe("idle");
  expect(calls("conversations.list")).toHaveLength(0);
  expect(harness.session.conversation(design)).toBeUndefined();
});

test("listing pages through public channels only, without archived ones, and stores the ones the user isn't in", async () => {
  await start();

  await harness.session.loadPublicChannels();

  expect(calls("conversations.list").map((call) => call.params)).toEqual([
    {
      types: "public_channel",
      exclude_archived: "true",
      limit: "200",
    },
    {
      types: "public_channel",
      exclude_archived: "true",
      limit: "200",
      cursor: "dGVhbTpDMDYxRkE1UEI=",
    },
  ]);
  expect(harness.session.publicChannelsStatus()).toBe("loaded");
  expect(harness.session.conversation(design)).toMatchObject({
    kind: "channel",
    name: "design",
    isMember: false,
    isArchived: false,
    memberCount: 8,
  });
  expect(harness.session.conversation(devops)).toMatchObject({
    name: "devops",
    isMember: false,
    memberCount: 54,
  });
  expect(listed(general)).toHaveLength(1);
  expect(harness.session.conversation(general)?.isMember).toBe(true);
});

test("the status says loading while the pages come in, and a second call shares the listing and, once loaded, does nothing", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const [first, second] = await loadFixture("conversations-list-public");

  await start({
    list: async (call) => {
      if (call.params.cursor) {
        await gate;

        return second!;
      }

      return first!;
    },
  });

  const loading = harness.session.loadPublicChannels();

  void harness.session.loadPublicChannels();
  await waitFor(() => harness.session.conversation(design));

  expect(harness.session.publicChannelsStatus()).toBe("loading");
  expect(harness.session.conversation(devops)).toBeUndefined();

  release();
  await loading;

  expect(harness.session.publicChannelsStatus()).toBe("loaded");

  await harness.session.loadPublicChannels();

  expect(calls("conversations.list")).toHaveLength(2);
});

test("a channel the store already knows keeps what the store says", async () => {
  await start();
  await harness.sendEvents(await eventFor("channel-archive", general));

  await harness.session.loadPublicChannels();

  expect(harness.session.conversation(general)).toMatchObject({
    isMember: true,
    isArchived: true,
  });
});

test("an archived channel the listing returns anyway is left out", async () => {
  const [first] = await loadFixture("conversations-list-public");

  await start({
    list: () => ({
      ...first!,
      channels: [
        ...first!.channels,
        { ...first!.channels[1], id: "C0OLD0001", is_archived: true },
      ],
      response_metadata: { next_cursor: "" },
    }),
  });

  await harness.session.loadPublicChannels();

  expect(harness.session.conversation("C0OLD0001")).toBeUndefined();
});

test("a failed listing says so and the next call tries again, adding nothing twice", async () => {
  const [first, second] = await loadFixture("conversations-list-public");
  let attempts = 0;

  await start({
    list: (call) => {
      attempts += 1;

      if (attempts === 2) {
        return { ok: false, error: "internal_error" };
      }

      return call.params.cursor ? second! : first!;
    },
  });

  await harness.session.loadPublicChannels();

  expect(harness.session.publicChannelsStatus()).toBe("failed");
  expect(harness.session.conversation(design)).toBeDefined();
  expect(harness.session.conversation(devops)).toBeUndefined();

  await harness.session.loadPublicChannels();

  expect(harness.session.publicChannelsStatus()).toBe("loaded");
  expect(listed(design)).toHaveLength(1);
  expect(harness.session.conversation(devops)).toBeDefined();
});

test("channel events keep the listed channels current: created, renamed, archived, unarchived and deleted", async () => {
  await start();
  await harness.session.loadPublicChannels();

  await harness.sendEvents(await eventFor("channel-created", "C0NEW0001"));

  expect(harness.session.conversation("C0NEW0001")).toMatchObject({
    name: "fun",
    isMember: false,
  });

  await harness.sendEvents(await eventFor("channel-rename", design));

  expect(harness.session.conversation(design)?.name).toBe("renamed");

  await harness.sendEvents(await eventFor("channel-archive", design));

  expect(harness.session.conversation(design)?.isArchived).toBe(true);

  await harness.sendEvents(await eventFor("channel-unarchive", design));

  expect(harness.session.conversation(design)?.isArchived).toBe(false);

  await harness.sendEvents(await eventFor("channel-deleted", design));

  expect(harness.session.conversation(design)).toBeUndefined();
});

test("joining calls conversations.join and stores the channel as one the user is in, once", async () => {
  await start({ scopes: everyScope });
  await harness.session.loadPublicChannels();

  const result = await harness.session.joinChannel(design);

  expect(result).toEqual({ ok: true, conversationId: design });
  expect(calls("conversations.join").map((call) => call.params)).toEqual([
    { channel: design },
  ]);
  expect(harness.session.conversation(design)).toMatchObject({
    name: "design",
    isMember: true,
    isArchived: false,
  });
  expect(listed(design)).toHaveLength(1);
});

test("joining a channel the store hasn't listed adds it", async () => {
  await start({ scopes: everyScope });

  await harness.session.joinChannel(design);

  expect(listed(design)).toHaveLength(1);
  expect(harness.session.conversation(design)?.isMember).toBe(true);
});

test("the member_joined_channel echo for the user doesn't add the channel twice, whichever comes first", async () => {
  await start({ scopes: everyScope });
  await harness.session.loadPublicChannels();

  await harness.sendEvents(await eventFor("member-joined-channel", design));

  expect(listed(design)).toHaveLength(1);
  expect(harness.session.conversation(design)?.isMember).toBe(true);

  await harness.session.joinChannel(design);
  await harness.sendEvents(await eventFor("member-joined-channel", design));

  expect(listed(design)).toHaveLength(1);
  expect(calls("conversations.join")).toHaveLength(0);
});

test("the echo arriving before Slack's answer leaves one entry", async () => {
  let answer = () => {};
  const gate = new Promise<void>((resolve) => (answer = resolve));
  const [joined] = await loadFixture("conversations-join");

  await start({
    scopes: everyScope,
    join: async () => {
      await gate;

      return joined!;
    },
  });
  await harness.session.loadPublicChannels();

  const joining = harness.session.joinChannel(design);

  await waitFor(() => calls("conversations.join").length === 1);
  await harness.sendEvents(await eventFor("member-joined-channel", design));
  answer();

  expect(await joining).toEqual({ ok: true, conversationId: design });
  expect(listed(design)).toHaveLength(1);
});

test("Slack answering already_in_channel is a join like any other", async () => {
  const [, again] = await loadFixture("conversations-join");

  await start({ scopes: everyScope, join: () => again! });
  await harness.session.loadPublicChannels();

  const result = await harness.session.joinChannel(design);

  expect(result).toEqual({ ok: true, conversationId: design });
  expect(listed(design)).toHaveLength(1);
  expect(harness.session.conversation(design)?.isMember).toBe(true);
});

test("joining the same channel twice at once makes one call", async () => {
  await start({ scopes: everyScope });

  const [first, second] = await Promise.all([
    harness.session.joinChannel(design),
    harness.session.joinChannel(design),
  ]);

  expect(first).toEqual(second);
  expect(calls("conversations.join")).toHaveLength(1);
});

test("a channel the user is in isn't joined again", async () => {
  await start({ scopes: everyScope });

  const result = await harness.session.joinChannel(general);

  expect(result).toEqual({ ok: true, conversationId: general });
  expect(calls("conversations.join")).toHaveLength(0);
});

test.each([
  ["is_archived", "archived"],
  ["method_not_supported_for_channel_type", "kind of channel"],
  ["restricted_action", "settings"],
  ["channel_not_found", "can't find"],
  ["missing_scope", "channels:write"],
  ["something_new", "something_new"],
])(
  "Slack refusing with %s says why and changes nothing",
  async (error, words) => {
    await start({ scopes: everyScope, join: () => ({ ok: false, error }) });
    await harness.session.loadPublicChannels();
    const before = harness.session.conversations();

    const result = await harness.session.joinChannel(design);

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toContain(words);
    expect(harness.session.conversations()).toEqual(before);
  },
);

test("without channels:write nothing reaches Slack and the message says how to grant it", async () => {
  await start({ scopes: ["identify", "channels:read", "chat:write"] });
  await harness.session.loadPublicChannels();

  const result = await harness.session.joinChannel(design);

  expect(harness.session.scopeProblem("join")).toContain("channels:write");
  expect(result.ok).toBe(false);
  expect(result.ok ? "" : result.message).toContain("Joining channels is off");
  expect(result.ok ? "" : result.message).toContain("setup");
  expect(calls("conversations.join")).toHaveLength(0);
  expect(harness.session.conversation(design)?.isMember).toBe(false);
});

test("joining stays available when the granted scopes aren't known", async () => {
  await start();

  expect(harness.session.scopeProblem("join")).toBeUndefined();
  expect((await harness.session.joinChannel(design)).ok).toBe(true);
});
