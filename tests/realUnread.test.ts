import { afterEach, expect, test } from "bun:test";
import { seedWorkspace } from "./support/appHarness";
import { waitFor, type FakeSlack } from "./support/fakeSlack";
import { memoryDmActivityCache } from "./support/dmActivityCache";
import {
  type SessionHarness,
  startSessionHarness,
} from "./support/sessionHarness";

let harness: SessionHarness;

afterEach(() => harness.stop());

const me = "U123ABC456";
const other = "U222222222";
const general = "C012AB3CD";
const random = "C061EG9T2";
const peter = "D0C0F7S8Y";
const ray = "D0BSHH4AD";
const group = "G0AKFJBEU";

const ts = (seconds: number) => `${seconds}.000000`;

type Newest = { ts: string; user?: string; text?: string };

type World = {
  /** `last_read` per conversation (missing: the conversation never reports one). */
  lastRead: Record<string, string>;
  /** The newest message per conversation (missing: empty history). */
  newest: Record<string, Newest>;
  /** Extra delay per conversation before `conversations.info` answers. */
  infoDelayMs?: Record<string, number>;
};

function serve(slack: FakeSlack, world: World) {
  slack.respond("conversations.info", async ({ params }) => {
    const id = String(params.channel);

    await Bun.sleep(world.infoDelayMs?.[id] ?? 0);

    return {
      ok: true,
      channel: {
        id,
        is_im: id.startsWith("D"),
        is_mpim: id.startsWith("G"),
        last_read: world.lastRead[id],
      },
    };
  });

  slack.respond("conversations.history", ({ params }) => {
    const newest = world.newest[String(params.channel)];

    return {
      ok: true,
      messages: newest
        ? [
            {
              type: "message",
              user: newest.user ?? other,
              text: newest.text ?? "hello",
              ts: newest.ts,
            },
          ]
        : [],
    };
  });
}

async function start(
  world: World,
  options: {
    concurrency?: number;
    prepare?: (slack: FakeSlack) => void;
    readMarkDebounceMs?: number;
  } = {},
) {
  harness = await startSessionHarness({
    unreadCheck: { concurrency: options.concurrency, retryDelayMs: 10 },
    readMarkDebounceMs: options.readMarkDebounceMs ?? 20,
    prepare: async (slack) => {
      await seedWorkspace(slack);
      serve(slack, world);
      options.prepare?.(slack);
    },
  });

  await waitFor(() => harness.session.conversation(group));

  return harness.session;
}

const calls = (method: string) =>
  harness.slack.calls.filter((call) => call.method === method);

const checked = (ids: string[]) =>
  calls("conversations.info")
    .map((call) => String(call.params.channel))
    .filter((id) => ids.includes(id));

test("channels with messages after last_read are marked unread, never as mentions", async () => {
  const session = await start({
    lastRead: { [general]: ts(100), [random]: ts(100) },
    newest: {
      [general]: { ts: ts(200), text: `<@${me}> look` },
      [random]: { ts: ts(100) },
    },
  });

  await waitFor(() => session.markers(general).isUnread);

  expect(session.markers(general)).toEqual({ isUnread: true, mentions: 0 });
  expect(session.markers(random)).toEqual({ isUnread: false, mentions: 0 });
});

test("a newest message from the user themselves does not mark a conversation", async () => {
  const session = await start({
    lastRead: { [general]: ts(100), [random]: ts(100) },
    newest: {
      [general]: { ts: ts(200), user: me },
      [random]: { ts: ts(200) },
    },
  });

  await waitFor(() => session.markers(random).isUnread);

  expect(session.markers(general).isUnread).toBe(false);
});

test("unread DMs and group DMs count as mentions; read ones are left alone", async () => {
  const session = await start({
    lastRead: { [peter]: ts(100), [ray]: ts(100), [group]: ts(100) },
    newest: {
      [peter]: { ts: ts(300) },
      [ray]: { ts: ts(100) },
      [group]: { ts: ts(150) },
    },
  });

  await waitFor(() => session.markers(group).isUnread);

  expect(session.markers(peter)).toEqual({ isUnread: true, mentions: 1 });
  expect(session.markers(group)).toEqual({ isUnread: true, mentions: 1 });
  expect(session.markers(ray)).toEqual({ isUnread: false, mentions: 0 });
});

test("a conversation without a last_read or without messages is not marked", async () => {
  const session = await start({
    lastRead: { [general]: ts(100) },
    newest: { [random]: { ts: ts(500) } },
  });

  await waitFor(() => calls("conversations.history").length >= 1);
  await Bun.sleep(50);

  expect(session.markers(general).isUnread).toBe(false);
  expect(session.markers(random).isUnread).toBe(false);
});

test("the check doesn't mark a conversation that was opened before its result came back", async () => {
  const session = await start({
    lastRead: { [general]: ts(100), [random]: ts(100) },
    newest: { [general]: { ts: ts(200) }, [random]: { ts: ts(200) } },
    infoDelayMs: { [general]: 150 },
  });

  session.setOpenConversation(general);

  await waitFor(() => session.markers(random).isUnread);
  await Bun.sleep(250);

  expect(session.markers(general)).toEqual({ isUnread: false, mentions: 0 });

  session.setOpenConversation(random);
  session.setOpenConversation(undefined);

  expect(session.markers(general).isUnread).toBe(false);
});

test("a live message still marks, and the check doesn't count it twice", async () => {
  const session = await start({
    lastRead: { [peter]: ts(100) },
    newest: { [peter]: { ts: "1700000000.000001" } },
    infoDelayMs: { [peter]: 200 },
  });

  await harness.sendEvents({
    event: {
      type: "message",
      channel: peter,
      channel_type: "im",
      user: other,
      text: "hi",
      ts: "1700000000.000001",
    },
  });

  expect(session.markers(peter)).toEqual({ isUnread: true, mentions: 1 });

  await waitFor(() => calls("conversations.history").length >= 1);
  await Bun.sleep(50);

  expect(session.markers(peter)).toEqual({ isUnread: true, mentions: 1 });
});

test("a live message after the check adds to the pre-existing unread", async () => {
  const session = await start({
    lastRead: { [peter]: ts(100) },
    newest: { [peter]: { ts: ts(200) } },
  });

  await waitFor(() => session.markers(peter).isUnread);

  await harness.sendEvents({
    event: {
      type: "message",
      channel: peter,
      channel_type: "im",
      user: other,
      text: "again",
      ts: "1700000000.000009",
    },
  });

  expect(session.markers(peter).mentions).toBe(2);
});

test("every member conversation is checked", async () => {
  await start({ lastRead: {}, newest: {} });

  await waitFor(() => calls("conversations.info").length === 5);

  expect(checked([general, random, peter, ray, group]).sort()).toEqual(
    [general, random, peter, ray, group].sort(),
  );
});

test("a DM whose newest message is known from DM activity costs no history call unless it is newer than last_read", async () => {
  const cache = memoryDmActivityCache({
    latest: { [peter]: ts(100), [ray]: ts(300), [group]: ts(100) },
    hidden: [],
    lastRun: "2026-11-03",
  });

  harness = await startSessionHarness({
    dmActivity: { cache, passDelayMs: 0, now: () => new Date(2026, 10, 4) },
    unreadCheck: {},
    prepare: async (slack) => {
      await seedWorkspace(slack);
      serve(slack, {
        lastRead: { [peter]: ts(100), [ray]: ts(200), [group]: ts(100) },
        newest: { [ray]: { ts: ts(300) } },
      });
      slack.respond("search.messages", () => ({
        ok: true,
        messages: { matches: [], paging: { page: 1, pages: 1 } },
      }));
    },
  });

  await waitFor(() => harness.session.markers(ray).isUnread);
  await waitFor(() => calls("conversations.info").length >= 5);

  const historyChannels = calls("conversations.history").map((call) =>
    String(call.params.channel),
  );

  expect(harness.session.markers(ray).mentions).toBe(1);
  expect(historyChannels).not.toContain(peter);
  expect(historyChannels).not.toContain(group);
});

test("opening a conversation marks it read in Slack up to its newest message", async () => {
  const session = await start({
    lastRead: { [general]: ts(100) },
    newest: { [general]: { ts: ts(200) } },
  });

  await waitFor(() => session.markers(general).isUnread);

  await session.loadHistory(general);
  session.setOpenConversation(general);

  await waitFor(() => calls("conversations.mark").length === 1);

  expect(calls("conversations.mark")[0]!.params).toMatchObject({
    channel: general,
    ts: ts(200),
  });
  expect(session.markers(general).isUnread).toBe(false);
});

test("nothing is marked while the newest message is unknown, until history brings it", async () => {
  const session = await start({
    lastRead: {},
    newest: { [random]: { ts: ts(700) } },
  });

  session.setOpenConversation(random);
  await Bun.sleep(80);

  expect(calls("conversations.mark")).toHaveLength(0);

  await session.loadHistory(random);

  await waitFor(() => calls("conversations.mark").length === 1);

  expect(calls("conversations.mark")[0]!.params.ts).toBe(ts(700));
});

test("opening a conversation sends no read mark while its history is still loading", async () => {
  const session = await start(
    {
      lastRead: { [general]: ts(100) },
      newest: { [general]: { ts: ts(200) } },
    },
    {
      prepare: (slack) =>
        slack.respond("conversations.history", async () => {
          await Bun.sleep(250);

          return {
            ok: true,
            messages: [
              { type: "message", user: other, text: "hi", ts: ts(150) },
            ],
          };
        }),
    },
  );

  await waitFor(() => session.markers(general).isUnread);

  session.setOpenConversation(general);

  const loading = session.loadHistory(general);

  await Bun.sleep(100);

  expect(calls("conversations.mark")).toHaveLength(0);
  expect(session.markers(general).isUnread).toBe(true);

  await loading;
  await waitFor(() => calls("conversations.mark").length === 1);

  expect(session.markers(general).isUnread).toBe(false);
});

test("the mark covers the newest loaded message, not a newer one found by the unread check", async () => {
  const session = await start(
    {
      lastRead: { [general]: ts(100) },
      newest: { [general]: { ts: ts(300) } },
    },
    {
      prepare: (slack) =>
        slack.respond("conversations.history", ({ params }) =>
          Number(params.limit) === 1
            ? {
                ok: true,
                messages: [
                  { type: "message", user: other, text: "new", ts: ts(300) },
                ],
              }
            : {
                ok: true,
                messages: [
                  { type: "message", user: other, text: "old", ts: ts(200) },
                ],
              },
        ),
    },
  );

  await waitFor(() => session.markers(general).isUnread);

  session.setOpenConversation(general);
  await session.loadHistory(general);
  await waitFor(() => calls("conversations.mark").length === 1);

  expect(calls("conversations.mark")[0]!.params.ts).toBe(ts(200));
});

test("a failed history load marks nothing and keeps the unread marker", async () => {
  const session = await start(
    {
      lastRead: { [general]: ts(100) },
      newest: { [general]: { ts: ts(200) } },
    },
    {
      prepare: (slack) =>
        slack.respond("conversations.history", ({ params }) =>
          Number(params.limit) === 1
            ? {
                ok: true,
                messages: [
                  { type: "message", user: other, text: "new", ts: ts(200) },
                ],
              }
            : { ok: false, error: "internal_error" },
        ),
    },
  );

  await waitFor(() => session.markers(general).isUnread);

  session.setOpenConversation(general);

  await expect(session.loadHistory(general)).rejects.toThrow();
  await Bun.sleep(100);

  expect(calls("conversations.mark")).toHaveLength(0);
  expect(session.markers(general).isUnread).toBe(true);
});

test("switching away before the history loads marks nothing and keeps the unread marker", async () => {
  const session = await start(
    {
      lastRead: { [general]: ts(100) },
      newest: { [general]: { ts: ts(200) } },
    },
    {
      prepare: (slack) =>
        slack.respond("conversations.history", async ({ params }) => {
          if (Number(params.limit) !== 1) {
            await Bun.sleep(200);
          }

          return {
            ok: true,
            messages: [
              { type: "message", user: other, text: "hi", ts: ts(200) },
            ],
          };
        }),
    },
  );

  await waitFor(() => session.markers(general).isUnread);

  session.setOpenConversation(general);

  const loading = session.loadHistory(general);

  session.setOpenConversation(random);
  await loading;
  await Bun.sleep(100);

  expect(calls("conversations.mark")).toHaveLength(0);
  expect(session.markers(general).isUnread).toBe(true);
});

test("a live message in an open conversation still loading is marked once the history arrives", async () => {
  const session = await start({ lastRead: {}, newest: {} });

  session.setOpenConversation(general);

  await harness.sendEvents({
    event: {
      type: "message",
      channel: general,
      channel_type: "channel",
      user: other,
      text: "early",
      ts: "1700000000.000001",
    },
  });
  await Bun.sleep(80);

  expect(calls("conversations.mark")).toHaveLength(0);

  await session.loadHistory(general);
  await waitFor(() => calls("conversations.mark").length === 1);

  expect(calls("conversations.mark")[0]!.params.ts).toBe("1700000000.000001");
});

test("reopening a conversation whose history is already loaded marks it at once", async () => {
  const session = await start({
    lastRead: {},
    newest: { [general]: { ts: ts(200) } },
  });

  await session.loadHistory(general);

  session.setOpenConversation(general);
  await waitFor(() => calls("conversations.mark").length === 1);

  harness.slack.calls.length = 0;

  await harness.sendEvents({
    event: {
      type: "message",
      channel: general,
      channel_type: "channel",
      user: other,
      text: "later",
      ts: ts(300),
    },
  });
  session.setOpenConversation(random);
  session.setOpenConversation(general);
  await waitFor(() => calls("conversations.mark").length === 1);

  expect(calls("conversations.mark")[0]!.params.ts).toBe(ts(300));
});

test("messages arriving in the open conversation are marked read, coalesced", async () => {
  const session = await start(
    { lastRead: {}, newest: {} },
    { readMarkDebounceMs: 100 },
  );

  await session.loadHistory(general);
  session.setOpenConversation(general);

  const say = (n: number) =>
    harness.sendEvents({
      event: {
        type: "message",
        channel: general,
        channel_type: "channel",
        user: other,
        text: `msg ${n}`,
        ts: `1700000000.00000${n}`,
      },
    });

  await say(1);
  await say(2);
  await say(3);

  await waitFor(() => calls("conversations.mark").length >= 1);
  await Bun.sleep(250);

  expect(calls("conversations.mark")).toHaveLength(1);
  expect(calls("conversations.mark")[0]!.params.ts).toBe("1700000000.000003");

  await say(4);

  await waitFor(() => calls("conversations.mark").length === 2);

  expect(calls("conversations.mark")[1]!.params.ts).toBe("1700000000.000004");
});

test("a ts already marked isn't sent again", async () => {
  const session = await start({ lastRead: {}, newest: {} });

  await session.loadHistory(general);
  session.setOpenConversation(general);
  await harness.sendEvents({
    event: {
      type: "message",
      channel: general,
      channel_type: "channel",
      user: other,
      text: "x",
      ts: "1700000000.000001",
    },
  });
  await waitFor(() => calls("conversations.mark").length === 1);

  session.setOpenConversation(random);
  session.setOpenConversation(general);
  await Bun.sleep(100);

  expect(calls("conversations.mark")).toHaveLength(1);
});

test("when Slack refuses to mark read, local clearing still works and marking stops", async () => {
  const session = await start(
    { lastRead: {}, newest: {} },
    {
      prepare: (slack) =>
        slack.respond("conversations.mark", () => ({
          ok: false,
          error: "missing_scope",
        })),
    },
  );

  await harness.sendEvents({
    event: {
      type: "message",
      channel: general,
      channel_type: "channel",
      user: other,
      text: "unread",
      ts: "1700000000.000001",
    },
  });

  expect(session.markers(general).isUnread).toBe(true);

  await session.loadHistory(general);
  session.setOpenConversation(general);

  expect(session.markers(general).isUnread).toBe(false);

  await waitFor(() => calls("conversations.mark").length === 1);

  await harness.sendEvents({
    event: {
      type: "message",
      channel: general,
      channel_type: "channel",
      user: other,
      text: "more",
      ts: "1700000000.000002",
    },
  });
  await Bun.sleep(100);

  expect(calls("conversations.mark")).toHaveLength(1);
  expect(session.markers(general).isUnread).toBe(false);
});

test("a transient mark failure is retried by the next message", async () => {
  let failures = 1;
  const session = await start(
    { lastRead: {}, newest: {} },
    {
      prepare: (slack) =>
        slack.respond("conversations.mark", () =>
          failures-- > 0
            ? { ok: false, error: "internal_error" }
            : { ok: true },
        ),
    },
  );

  await session.loadHistory(general);
  session.setOpenConversation(general);

  const say = (n: number) =>
    harness.sendEvents({
      event: {
        type: "message",
        channel: general,
        channel_type: "channel",
        user: other,
        text: "x",
        ts: `1700000000.00000${n}`,
      },
    });

  await say(1);
  await waitFor(() => calls("conversations.mark").length === 1);
  await say(2);
  await waitFor(() => calls("conversations.mark").length === 2);

  expect(calls("conversations.mark")[1]!.params.ts).toBe("1700000000.000002");
});

const pagedHistory = [
  {
    ok: true,
    messages: [
      { type: "message", user: other, text: "newest", ts: ts(300) },
      { type: "message", user: other, text: "newer", ts: ts(250) },
    ],
    response_metadata: { next_cursor: "older" },
  },
  {
    ok: true,
    messages: [{ type: "message", user: other, text: "old hit", ts: ts(100) }],
    response_metadata: { next_cursor: "" },
  },
];

test("opening a search result marks the conversation read up to its newest message, since history always loads from the newest end", async () => {
  const session = await start(
    {
      lastRead: { [general]: ts(50) },
      newest: { [general]: { ts: ts(300) } },
    },
    {
      prepare: (slack) => slack.respondPaged("conversations.history", pagedHistory),
    },
  );

  await waitFor(() => session.markers(general).isUnread);

  session.setOpenConversation(general);
  await session.loadHistoryAround(general, ts(100));

  await waitFor(() => calls("conversations.mark").length === 1);

  expect(calls("conversations.mark")[0]!.params).toMatchObject({
    channel: general,
    ts: ts(300),
  });
  expect(session.markers(general).isUnread).toBe(false);
});

test("a failed search-result load marks nothing and keeps the unread marker", async () => {
  const session = await start(
    {
      lastRead: { [general]: ts(50) },
      newest: { [general]: { ts: ts(300) } },
    },
    {
      prepare: (slack) =>
        slack.respond("conversations.history", ({ params }) =>
          Number(params.limit) === 1
            ? {
                ok: true,
                messages: [
                  { type: "message", user: other, text: "n", ts: ts(300) },
                ],
              }
            : { ok: false, error: "fatal_error" },
        ),
    },
  );

  await waitFor(() => session.markers(general).isUnread);

  session.setOpenConversation(general);
  await session.loadHistoryAround(general, ts(100)).catch(() => undefined);
  await Bun.sleep(80);

  expect(calls("conversations.mark")).toHaveLength(0);
  expect(session.markers(general).isUnread).toBe(true);
});
