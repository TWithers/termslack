import { afterEach, expect, test } from "bun:test";
import { loadFixture } from "./support/fixtures";
import { waitFor } from "./support/fakeSlack";
import {
  type SessionHarness,
  startSessionHarness,
} from "./support/sessionHarness";

let harness: SessionHarness;

afterEach(() => harness.stop());

const channel = "C012AB3CD";

async function start(options: Parameters<typeof startSessionHarness>[0] = {}) {
  const historyPages = await loadFixture("conversations-history");
  const replyPages = await loadFixture("conversations-replies");
  const channels = await loadFixture("users-conversations-channels");
  const dms = await loadFixture("users-conversations-dms");
  const people = await loadFixture("users-list");

  harness = await startSessionHarness({
    ...options,
    prepare: (slack) => {
      slack.respondPaged("users.conversations", [...channels, ...dms]);
      slack.respondPaged("users.list", people);
      slack.respondPaged("conversations.history", historyPages);
      slack.respondPaged("conversations.replies", replyPages);
      return options.prepare?.(slack);
    },
  });

  return { historyPages, replyPages };
}

const tsOf = (messages: { ts: string }[]) => messages.map((m) => m.ts);
const callsTo = (method: string) =>
  harness.slack.calls.filter((call) => call.method === method);

async function sendLive(overrides: Record<string, unknown>) {
  const [payload] = await loadFixture("message");

  return harness.sendEvents({
    ...payload,
    event: { ...payload?.event, channel, ...overrides },
  });
}

test("the first call loads the newest page, oldest first", async () => {
  await start();

  const page = await harness.session.loadHistory(channel);

  expect(tsOf(page.messages)).toEqual([
    "1512090000.000200",
    "1512100000.000300",
    "1512104434.000490",
  ]);
  expect(page.hasMore).toBe(true);
  expect(tsOf(harness.session.messages(channel))).toEqual(tsOf(page.messages));
  expect(callsTo("conversations.history")[0]?.params).toMatchObject({
    channel,
    limit: "50",
  });
});

test("history keeps what the message carried, including a thread parent's reply count", async () => {
  await start();
  await harness.session.loadHistory(channel);

  expect(harness.session.message(channel, "1512100000.000300")).toMatchObject({
    userId: "U123ABC456",
    threadTs: "1512100000.000300",
    replyCount: 2,
    isEdited: false,
    isDeleted: false,
  });
  expect(harness.session.message(channel, "1512090000.000200")).toMatchObject({
    botId: "B123ABC456",
    botName: "deploybot",
    subtype: "bot_message",
    text: "Deploy finished",
  });
});

test("further calls follow the cursor until history runs out", async () => {
  await start();

  await harness.session.loadHistory(channel);

  const second = await harness.session.loadHistory(channel);

  expect(tsOf(second.messages)).toEqual([
    "1512080000.000100",
    "1512085950.000216",
  ]);
  expect(second.hasMore).toBe(false);
  expect(harness.session.message(channel, "1512085950.000216")?.isEdited).toBe(
    true,
  );
  expect(tsOf(harness.session.messages(channel))).toEqual([
    "1512080000.000100",
    "1512085950.000216",
    "1512090000.000200",
    "1512100000.000300",
    "1512104434.000490",
  ]);

  const calls = callsTo("conversations.history").length;
  const third = await harness.session.loadHistory(channel);

  expect(third).toEqual({ messages: [], hasMore: false });
  expect(callsTo("conversations.history")).toHaveLength(calls);
});

test("a limit sets the page size", async () => {
  await start();
  await harness.session.loadHistory(channel, { limit: 10 });

  expect(callsTo("conversations.history")[0]?.params.limit).toBe("10");
});

test("thread replies load a page at a time, with the parent stored but not returned", async () => {
  await start();

  const parent = "1512100000.000300";
  const first = await harness.session.loadThreadReplies(channel, parent);

  expect(tsOf(first.messages)).toEqual(["1512100100.000400"]);
  expect(first.hasMore).toBe(true);
  expect(callsTo("conversations.replies")[0]?.params).toMatchObject({
    channel,
    ts: parent,
  });
  expect(harness.session.message(channel, parent)?.replyCount).toBe(2);

  const second = await harness.session.loadThreadReplies(channel, parent);

  expect(tsOf(second.messages)).toEqual(["1512100200.000500"]);
  expect(second.hasMore).toBe(false);
  expect(tsOf(harness.session.threadReplies(channel, parent))).toEqual([
    "1512100100.000400",
    "1512100200.000500",
  ]);
  expect(tsOf(harness.session.messages(channel))).toEqual([parent]);
});

test("a live message arriving while a page loads appears once, in order", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const { historyPages } = await start({
    prepare: (slack) =>
      slack.respond("conversations.history", async () => {
        await gate;

        return historyPages[0] ?? {};
      }),
  });

  const loading = harness.session.loadHistory(channel);

  await waitFor(() => callsTo("conversations.history").length > 0);

  await sendLive({ ts: "1512100500.000001", text: "arrived while loading" });
  await sendLive({ ts: "1512104434.000490", text: "same ts as the page" });

  release();

  const page = await loading;

  expect(tsOf(harness.session.messages(channel))).toEqual([
    "1512090000.000200",
    "1512100000.000300",
    "1512100500.000001",
    "1512104434.000490",
  ]);
  expect(tsOf(page.messages)).toEqual([
    "1512090000.000200",
    "1512100000.000300",
    "1512104434.000490",
  ]);
  expect(harness.session.message(channel, "1512100500.000001")?.text).toBe(
    "arrived while loading",
  );
});

test("a message that appears twice, within a page or across pages, is stored once", async () => {
  const message = { type: "message", user: "U1", text: "twice" };

  await start({
    prepare: (slack) =>
      slack.respondPaged("conversations.history", [
        {
          ok: true,
          messages: [
            { ...message, ts: "5.000002" },
            { ...message, ts: "5.000002" },
            { ...message, ts: "5.000001" },
          ],
          response_metadata: { next_cursor: "more" },
        },
        {
          ok: true,
          messages: [{ ...message, ts: "5.000001" }],
          response_metadata: { next_cursor: "" },
        },
      ]),
  });

  const first = await harness.session.loadHistory(channel);
  const second = await harness.session.loadHistory(channel);

  expect(tsOf(first.messages)).toEqual(["5.000001", "5.000002"]);
  expect(tsOf(second.messages)).toEqual(["5.000001"]);
  expect(tsOf(harness.session.messages(channel))).toEqual([
    "5.000001",
    "5.000002",
  ]);
});

test("edits and deletes of messages loaded from history update the store", async () => {
  await start();
  await harness.session.loadHistory(channel);

  const [changed] = await loadFixture("message-changed");

  await harness.sendEvents({
    ...changed,
    event: {
      ...changed?.event,
      channel,
      message: {
        ...changed?.event.message,
        ts: "1512104434.000490",
        text: "edited after the fact",
      },
    },
  });

  expect(harness.session.message(channel, "1512104434.000490")).toMatchObject({
    text: "edited after the fact",
    isEdited: true,
    userId: "U222222222",
  });

  const [deleted] = await loadFixture("message-deleted");

  await harness.sendEvents({
    ...deleted,
    event: { ...deleted?.event, channel, deleted_ts: "1512090000.000200" },
  });

  expect(harness.session.message(channel, "1512090000.000200")?.isDeleted).toBe(
    true,
  );
});

test("a message deleted before its page loads stays deleted", async () => {
  await start();

  const [deleted] = await loadFixture("message-deleted");

  await harness.sendEvents({
    ...deleted,
    event: { ...deleted?.event, channel, deleted_ts: "1512104434.000490" },
  });

  const page = await harness.session.loadHistory(channel);

  expect(
    page.messages.find((m) => m.ts === "1512104434.000490")?.isDeleted,
  ).toBe(true);
});

test("a live edit that lands before the page keeps its text", async () => {
  await start();

  const [changed] = await loadFixture("message-changed");

  await harness.sendEvents({
    ...changed,
    event: {
      ...changed?.event,
      channel,
      message: {
        ...changed?.event.message,
        ts: "1512104434.000490",
        text: "edited early",
      },
    },
  });

  await harness.session.loadHistory(channel);

  expect(harness.session.message(channel, "1512104434.000490")?.text).toBe(
    "edited early",
  );
});

test("loaded history is not evicted by the per-conversation limit", async () => {
  await start({ maxMessagesPerConversation: 2 });
  await harness.session.loadHistory(channel);
  await harness.session.loadHistory(channel);

  expect(harness.session.messages(channel)).toHaveLength(5);
});

test("a conversation nobody loaded history for still obeys the limit", async () => {
  await start({ maxMessagesPerConversation: 2 });

  for (const ts of ["1.000001", "2.000001", "3.000001"]) {
    await sendLive({ ts });
  }

  expect(tsOf(harness.session.messages(channel))).toEqual([
    "2.000001",
    "3.000001",
  ]);
});

test("a failed load rejects with Slack's error and can be retried", async () => {
  let failing = true;
  const { historyPages } = await start({
    prepare: (slack) =>
      slack.respond("conversations.history", () =>
        failing
          ? { ok: false, error: "channel_not_found" }
          : (historyPages[0] ?? {}),
      ),
  });

  await expect(harness.session.loadHistory(channel)).rejects.toMatchObject({
    data: { error: "channel_not_found" },
  });

  failing = false;

  expect((await harness.session.loadHistory(channel)).messages).toHaveLength(3);
});

test("authors and mentions in a page are named by the time it returns", async () => {
  await start({
    prepare: (slack) => {
      slack.respondPaged("conversations.history", [
        {
          ok: true,
          messages: [
            {
              type: "message",
              user: "U777777777",
              text: "hi <@U888888888>",
              ts: "9.000001",
            },
          ],
        },
      ]);
      slack.respond("users.info", (call) => ({
        ok: true,
        user: { id: call.params.user, name: `name-${call.params.user}` },
      }));
    },
  });
  await harness.session.loadHistory(channel);

  expect(harness.session.user("U777777777")?.name).toBe("name-U777777777");
  expect(harness.session.user("U888888888")?.name).toBe("name-U888888888");
});

test("findConversation matches names, #names, @people and IDs", async () => {
  await start();

  const find = (reference: string) =>
    harness.session.findConversation(reference);

  expect(await find("general")).toMatchObject({
    status: "found",
    conversation: { id: "C012AB3CD" },
  });
  expect(await find("#General")).toMatchObject({
    status: "found",
    conversation: { id: "C012AB3CD" },
  });
  expect(await find("@venkman")).toMatchObject({
    status: "found",
    conversation: { id: "D0C0F7S8Y" },
  });
  expect(await find("D0BSHH4AD")).toMatchObject({
    status: "found",
    conversation: { id: "D0BSHH4AD" },
  });
  expect(await find("C999999999")).toEqual({ status: "id", id: "C999999999" });
});

test("findConversation lists close matches for an unknown name", async () => {
  await start();

  const channelResult = await harness.session.findConversation("#gneral");

  expect(channelResult).toMatchObject({
    status: "notFound",
    suggestions: ["#general"],
  });

  const personResult = await harness.session.findConversation("@venkmn");

  expect(personResult).toMatchObject({
    status: "notFound",
    suggestions: ["@venkman"],
  });
});

test("findConversation says so when the person has no DM yet", async () => {
  await start();

  const result = await harness.session.findConversation("@egon");

  expect(result.status).toBe("notFound");
  expect(result.status === "notFound" && result.message).toContain(
    "no direct message",
  );
});
