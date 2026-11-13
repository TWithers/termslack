import { afterEach, expect, test } from "bun:test";
import { loadPayload } from "./support/fixtures";
import { waitFor, type FakeSlack } from "./support/fakeSlack";
import { seedWorkspace } from "./support/appHarness";
import { memoryDmActivityCache } from "./support/dmActivityCache";
import {
  type SessionHarness,
  startSessionHarness,
} from "./support/sessionHarness";

let harness: SessionHarness;

afterEach(() => harness.stop());

const peter = "D0C0F7S8Y";
const ray = "D0BSHH4AD";
const group = "G0AKFJBEU";
const now = () => new Date(2026, 10, 4, 12);

/** Seconds since the epoch as Slack's `ts`. */
const ts = (seconds: number) => `${seconds}.000000`;

/** The seeded DMs, with listing `updated` times in ms (the instant, rough order). */
function listDms(slack: FakeSlack, updated: Record<string, number>) {
  const handler = slack.handler("users.conversations");

  slack.respond("users.conversations", async (call) => {
    const page = (await handler(call)) as { channels?: any[] };

    return {
      ...page,
      channels: page.channels?.map((channel) =>
        channel.id in updated
          ? { ...channel, updated: updated[channel.id] }
          : channel,
      ),
    };
  });
}

/** Answers `conversations.history` with the given newest ts per DM (or an error). */
function newestMessages(
  slack: FakeSlack,
  newest: Record<string, string | { error: string }>,
) {
  slack.respond("conversations.history", ({ params }) => {
    const answer = newest[String(params.channel)];

    if (answer === undefined || typeof answer === "object") {
      return { ok: false, error: answer?.error ?? "channel_not_found" };
    }

    return {
      ok: true,
      messages: [
        { type: "message", user: "U222222222", text: "hi", ts: answer },
      ],
    };
  });
}

type StartOptions = {
  updated?: Record<string, number>;
  newest?: Record<string, string | { error: string }>;
  cache?: ReturnType<typeof memoryDmActivityCache>;
  passDelayMs?: number;
  prepare?: (slack: FakeSlack) => void;
};

async function start({
  updated = {},
  newest = {},
  cache = memoryDmActivityCache(),
  passDelayMs = 0,
  prepare,
}: StartOptions = {}) {
  harness = await startSessionHarness({
    dmActivity: { cache, passDelayMs, now },
    prepare: async (slack) => {
      await seedWorkspace(slack);
      listDms(slack, updated);
      newestMessages(slack, newest);
      prepare?.(slack);
    },
  });

  await waitFor(() => harness.session.conversation(group));

  return { cache, session: harness.session, slack: harness.slack };
}

/** The DM's activity rounded to whole ms (float math on ts drifts below that). */
const activity = (session: SessionHarness["session"], id: string) => {
  const value = session.dmActivity(id);

  return value === undefined ? undefined : Math.round(value);
};

const historyCalls = () =>
  harness.slack.calls.filter((call) => call.method === "conversations.history");

test("until a DM's newest message is known, the listing's updated time stands in", async () => {
  const { session } = await start({
    updated: { [peter]: 5_000_000, [ray]: 9_000_000 },
    newest: {},
    prepare: (slack) =>
      slack.respond("conversations.history", async () => {
        await Bun.sleep(300);

        return { ok: true, messages: [] };
      }),
  });

  expect(activity(session, peter)).toBe(5_000_000);
  expect(activity(session, ray)).toBe(9_000_000);
  expect(session.dmActivity("C012AB3CD")).toBeUndefined();
});

test("the first run asks each DM for its newest message and the answers replace updated", async () => {
  const { session, cache } = await start({
    updated: { [peter]: 9_000_000, [ray]: 1_000_000, [group]: 2_000_000 },
    newest: {
      [peter]: ts(1_700_000_000),
      [ray]: ts(1_700_500_000),
      [group]: ts(1_700_250_000),
    },
  });

  await waitFor(() => cache.saved?.latest[peter] && cache.saved.latest[ray]);
  await waitFor(() => cache.saved?.latest[group]);

  expect(activity(session, ray)).toBe(1_700_500_000_000);
  expect(activity(session, peter)).toBe(1_700_000_000_000);
  expect(historyCalls().every((call) => call.params.limit === "1")).toBe(true);
  expect(cache.saved?.lastRun).toBe("2026-11-04");
});

test("the pass waits between calls to stay within Slack's rate limit", async () => {
  const times: number[] = [];

  const { cache } = await start({
    passDelayMs: 120,
    newest: {
      [peter]: ts(1_700_000_000),
      [ray]: ts(1_700_000_001),
      [group]: ts(1_700_000_002),
    },
    prepare: (slack) => {
      const handler = slack.handler("conversations.history");

      slack.respond("conversations.history", (call) => {
        times.push(Date.now());

        return handler(call);
      });
    },
  });

  await waitFor(() => times.length === 3 && cache.saved?.latest[group]);

  expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(100);
  expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(100);
});

test("a DM whose history is channel_not_found is hidden and remembered as hidden", async () => {
  const { session, cache } = await start({
    newest: {
      [peter]: { error: "channel_not_found" },
      [ray]: ts(1_700_000_000),
      [group]: ts(1_700_000_001),
    },
  });

  await waitFor(() => session.isDmHidden(peter));
  await waitFor(() => cache.saved?.hidden.includes(peter));

  expect(session.isDmHidden(ray)).toBe(false);
});

test("other failures leave a DM alone, to be checked again next start", async () => {
  const { session, cache } = await start({
    newest: {
      [peter]: { error: "internal_error" },
      [ray]: ts(1_700_000_000),
      [group]: ts(1_700_000_001),
    },
  });

  await waitFor(() => cache.saved?.latest[group] && cache.saved.latest[ray]);

  expect(session.isDmHidden(peter)).toBe(false);
  expect(cache.saved?.latest[peter]).toBeUndefined();
});

test("a later start sorts from the cache and searches for what changed instead of asking every DM", async () => {
  const cache = memoryDmActivityCache({
    latest: { [peter]: ts(1_700_000_000), [ray]: ts(1_700_000_500) },
    hidden: [group],
    lastRun: "2026-11-01",
  });

  const { session, slack } = await start({
    cache,
    prepare: (slack) =>
      slack.respond("search.messages", () => ({
        ok: true,
        messages: {
          matches: [
            { ts: ts(1_700_900_000), channel: { id: peter, is_im: true } },
            { ts: ts(1_700_800_000), channel: { id: "C012AB3CD" } },
          ],
          paging: { page: 1, pages: 1 },
        },
      })),
  });

  expect(activity(session, ray)).toBe(1_700_000_500_000);

  await waitFor(() => activity(session, peter) === 1_700_900_000_000);

  const search = slack.calls.find((call) => call.method === "search.messages");

  expect(search?.params).toMatchObject({
    query: "is:dm after:2026-10-31",
    sort: "timestamp",
    sort_dir: "desc",
    count: "100",
  });
  expect(session.isDmHidden(group)).toBe(true);
  expect(historyCalls()).toHaveLength(0);
  await waitFor(() => cache.saved?.lastRun === "2026-11-04");
});

test("search results are followed page by page", async () => {
  const cache = memoryDmActivityCache({
    latest: { [peter]: ts(1), [ray]: ts(1), [group]: ts(1) },
    hidden: [],
    lastRun: "2026-11-03",
  });

  const { session } = await start({
    cache,
    prepare: (slack) =>
      slack.respond("search.messages", ({ params }) =>
        params.page === "1"
          ? {
              ok: true,
              messages: {
                matches: [
                  { ts: ts(1_700_000_900), channel: { id: ray, is_im: true } },
                ],
                paging: { page: 1, pages: 2 },
              },
            }
          : {
              ok: true,
              messages: {
                matches: [
                  {
                    ts: ts(1_700_000_800),
                    channel: { id: group, is_mpim: true },
                  },
                ],
                paging: { page: 2, pages: 2 },
              },
            },
      ),
  });

  await waitFor(() => activity(session, group) === 1_700_000_800_000);

  expect(activity(session, ray)).toBe(1_700_000_900_000);
});

test("when search fails, every DM is checked again", async () => {
  const cache = memoryDmActivityCache({
    latest: { [peter]: ts(1), [ray]: ts(1), [group]: ts(1) },
    hidden: [],
    lastRun: "2026-11-03",
  });

  const { session } = await start({
    cache,
    newest: {
      [peter]: ts(1_700_000_100),
      [ray]: ts(1_700_000_200),
      [group]: ts(1_700_000_300),
    },
    prepare: (slack) =>
      slack.respond("search.messages", () => ({
        ok: false,
        error: "missing_scope",
      })),
  });

  await waitFor(() => activity(session, group) === 1_700_000_300_000);
  await waitFor(() => cache.saved?.lastRun === "2026-11-04");

  expect(historyCalls()).toHaveLength(3);
  expect(activity(session, peter)).toBe(1_700_000_100_000);
});

test("only DMs without a known newest message are asked about on a later start", async () => {
  const cache = memoryDmActivityCache({
    latest: { [peter]: ts(1_700_000_000), [ray]: ts(1_700_000_500) },
    hidden: [],
    lastRun: "2026-11-03",
  });

  const { session } = await start({
    cache,
    newest: { [group]: ts(1_700_000_700) },
    prepare: (slack) =>
      slack.respond("search.messages", () => ({
        ok: true,
        messages: { matches: [], paging: { page: 1, pages: 1 } },
      })),
  });

  await waitFor(() => activity(session, group) === 1_700_000_700_000);

  expect(historyCalls().map((call) => call.params.channel)).toEqual([group]);
});

test("a live message bumps its DM, saves it, and shows a hidden DM again", async () => {
  const cache = memoryDmActivityCache({
    latest: { [peter]: ts(1_700_000_000), [ray]: ts(1_700_000_500) },
    hidden: [group],
    lastRun: "2026-11-04",
  });
  const { session } = await start({
    cache,
    prepare: (slack) =>
      slack.respond("search.messages", () => ({
        ok: true,
        messages: { matches: [], paging: { page: 1, pages: 1 } },
      })),
  });
  const payload = await loadPayload("message");
  const versionBefore = session.version();

  await harness.sendEvents({
    ...payload,
    event: {
      ...payload.event,
      channel: peter,
      channel_type: "im",
      ts: "1700999999.000200",
    },
  });
  await harness.sendEvents({
    ...payload,
    event: {
      ...payload.event,
      channel: group,
      channel_type: "mpim",
      ts: "1700999000.000200",
    },
  });

  expect(activity(session, peter)).toBe(1_700_999_999_000);
  expect(session.version()).not.toBe(versionBefore);
  expect(session.isDmHidden(group)).toBe(false);
  expect(cache.saved?.latest[peter]).toBe("1700999999.000200");
  expect(cache.saved?.hidden).toEqual([]);
});

test("messages loaded from history count too, and older ones never move a DM back", async () => {
  const { session } = await start({
    newest: {
      [peter]: ts(1_700_000_000),
      [ray]: ts(1_700_000_001),
      [group]: ts(1_700_000_002),
    },
  });

  await waitFor(() => activity(session, group) === 1_700_000_002_000);

  harness.slack.respond("conversations.history", () => ({
    ok: true,
    messages: [
      {
        type: "message",
        user: "U222222222",
        text: "newer",
        ts: "1700100000.000000",
      },
      {
        type: "message",
        user: "U222222222",
        text: "older",
        ts: "1600000000.000000",
      },
    ],
  }));

  await session.loadHistory(peter);

  expect(activity(session, peter)).toBe(1_700_100_000_000);
});

test("without a cache (tokens from the environment) the pass still runs in memory", async () => {
  harness = await startSessionHarness({
    dmActivity: { passDelayMs: 0 },
    prepare: async (slack) => {
      await seedWorkspace(slack);
      newestMessages(slack, { [peter]: ts(1_700_000_000) });
    },
  });

  await waitFor(() => activity(harness.session, peter) === 1_700_000_000_000);
  await waitFor(() => harness.session.isDmHidden(ray));
});

test("channels are never tracked as DM activity", async () => {
  const { session, cache } = await start({
    cache: memoryDmActivityCache({
      latest: {},
      hidden: [],
      lastRun: "2026-11-04",
    }),
    prepare: (slack) =>
      slack.respond("search.messages", () => ({
        ok: true,
        messages: { matches: [], paging: { page: 1, pages: 1 } },
      })),
  });
  const payload = await loadPayload("message");

  await harness.sendEvents({
    ...payload,
    event: { ...payload.event, channel: "C012AB3CD", channel_type: "channel" },
  });

  expect(session.dmActivity("C012AB3CD")).toBeUndefined();
  expect(cache.saved?.latest["C012AB3CD"]).toBeUndefined();
});
