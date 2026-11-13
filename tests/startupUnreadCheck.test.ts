import { afterEach, expect, test } from "bun:test";
import type { MuteMemory } from "../src/config/state";
import { seedWorkspace } from "./support/appHarness";
import { waitFor, type FakeSlack } from "./support/fakeSlack";
import {
  type SessionHarness,
  startSessionHarness,
} from "./support/sessionHarness";

let harness: SessionHarness;

afterEach(() => harness.stop());

const other = "U222222222";
const general = "C012AB3CD";
const random = "C061EG9T2";
const peter = "D0C0F7S8Y";
const ray = "D0BSHH4AD";
const group = "G0AKFJBEU";

const ts = (seconds: number) => `${seconds}.000000`;

type Info = { last_read?: string; unread_count_display?: number };

function serve(
  slack: FakeSlack,
  info: Record<string, Info>,
  newest: Record<string, string> = {},
  delayMs = 0,
) {
  slack.respond("conversations.info", async ({ params }) => {
    const id = String(params.channel);

    await Bun.sleep(delayMs);

    return {
      ok: true,
      channel: {
        id,
        is_im: id.startsWith("D"),
        is_mpim: id.startsWith("G"),
        ...info[id],
      },
    };
  });

  slack.respond("conversations.history", ({ params }) => ({
    ok: true,
    messages: newest[String(params.channel)]
      ? [
          {
            type: "message",
            user: other,
            text: "hello",
            ts: newest[String(params.channel)],
          },
        ]
      : [],
  }));
}

async function start(
  info: Record<string, Info>,
  options: {
    newest?: Record<string, string>;
    delayMs?: number;
    prepare?: (slack: FakeSlack) => void;
    unreadCheck?: { concurrency?: number };
    muteMemory?: MuteMemory;
    dmActivity?: { passDelayMs?: number };
  } = {},
) {
  harness = await startSessionHarness({
    unreadCheck: { retryDelayMs: 10, ...options.unreadCheck },
    dmActivity: options.dmActivity,
    muteMemory: options.muteMemory,
    prepare: async (slack) => {
      await seedWorkspace(slack);
      serve(slack, info, options.newest, options.delayMs);
      options.prepare?.(slack);
    },
  });

  await waitFor(() => harness.session.conversation(group));

  return harness.session;
}

const calls = (method: string) =>
  harness.slack.calls.filter((call) => call.method === method);

test("several conversations are checked at once, without a fixed pause", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const startedAt = Date.now();

  await start(
    {},
    {
      prepare: (slack) => {
        const handler = slack.handler("conversations.info");

        slack.respond("conversations.info", async (call) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await Bun.sleep(60);
          inFlight -= 1;

          return handler(call);
        });
      },
    },
  );

  await waitFor(() => calls("conversations.info").length === 5);
  await waitFor(() => harness.session.unreadCheckProgress() === undefined);

  expect(maxInFlight).toBeGreaterThan(1);
  expect(maxInFlight).toBeLessThanOrEqual(4);
  expect(Date.now() - startedAt).toBeLessThan(1000);
});

test("a DM's unread count from conversations.info is used without reading its newest message", async () => {
  const session = await start({
    [peter]: { last_read: ts(100), unread_count_display: 3 },
    [ray]: { last_read: ts(100), unread_count_display: 0 },
    [group]: { last_read: ts(100), unread_count_display: 1 },
  });

  await waitFor(() => session.markers(group).isUnread);
  await waitFor(() => session.unreadCheckProgress() === undefined);

  expect(session.markers(peter)).toEqual({ isUnread: true, mentions: 3 });
  expect(session.markers(group)).toEqual({ isUnread: true, mentions: 1 });
  expect(session.markers(ray)).toEqual({ isUnread: false, mentions: 0 });
  expect(calls("conversations.history")).toEqual([]);
});

test("a DM without an unread count falls back to its newest message", async () => {
  const session = await start(
    { [peter]: { last_read: ts(100) } },
    { newest: { [peter]: ts(200) } },
  );

  await waitFor(() => session.markers(peter).isUnread);

  expect(session.markers(peter)).toEqual({ isUnread: true, mentions: 1 });
  expect(calls("conversations.history").map((c) => c.params.channel)).toEqual([
    peter,
  ]);
});

test("a rate-limited call is retried instead of losing the conversation", async () => {
  let limited = false;

  const session = await start(
    { [general]: { last_read: ts(100) } },
    {
      newest: { [general]: ts(200) },
      prepare: (slack) => {
        const handler = slack.handler("conversations.info");

        slack.respond("conversations.info", (call) => {
          if (call.params.channel === general && !limited) {
            limited = true;

            return new Response("", {
              status: 429,
              headers: { "retry-after": "0" },
            });
          }

          return handler(call);
        });
      },
    },
  );

  await waitFor(() => session.markers(general).isUnread);

  expect(limited).toBe(true);
});

test("channels are checked without waiting for the DM activity pass", async () => {
  await start(
    { [general]: { last_read: ts(100) } },
    {
      dmActivity: { passDelayMs: 2000 },
      prepare: (slack) => {
        slack.respond("search.messages", () => ({
          ok: false,
          error: "not_allowed_token_type",
        }));
      },
    },
  );

  await waitFor(() =>
    calls("conversations.info").some((call) => call.params.channel === general),
  );
});

test("progress counts the conversations checked while the check runs, and is gone afterwards", async () => {
  const session = await start({}, { delayMs: 40 });
  const seen: string[] = [];

  await waitFor(() => {
    const progress = session.unreadCheckProgress();

    if (progress) {
      seen.push(`${progress.done}/${progress.total}`);
    }

    return progress === undefined && calls("conversations.info").length >= 5;
  });

  expect(seen.length).toBeGreaterThan(0);
  expect(seen.at(-1)).toMatch(/^\d+\/5$/);
  expect(random).toBeDefined();
  expect(ray).toBeDefined();
});

test("stopping the session cancels the rest of the check", async () => {
  await start({}, { delayMs: 100, unreadCheck: { concurrency: 1 } });

  await waitFor(() => calls("conversations.info").length >= 1);
  await harness.session.stop();

  const seen = calls("conversations.info").length;

  await Bun.sleep(400);

  expect(calls("conversations.info").length).toBe(seen);
});

test("a muted channel is left out of the check, and the others are checked as usual", async () => {
  const session = await start(
    {
      [general]: { last_read: ts(100) },
      [random]: { last_read: ts(100) },
    },
    {
      newest: { [general]: ts(200), [random]: ts(200) },
      muteMemory: {
        recall: async () => [general],
        remember: () => undefined,
        flush: async () => undefined,
      },
    },
  );

  await waitFor(() => session.markers(random).isUnread);
  await waitFor(() => session.unreadCheckProgress() === undefined);

  expect(session.markers(general)).toEqual({ isUnread: false, mentions: 0 });
  expect(
    calls("conversations.info").map((call) => call.params.channel),
  ).not.toContain(general);
});
