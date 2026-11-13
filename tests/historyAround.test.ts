import { afterEach, expect, test } from "bun:test";
import {
  type SessionHarness,
  startSessionHarness,
} from "./support/sessionHarness";

let harness: SessionHarness;

afterEach(() => harness.stop());

const channel = "C012AB3CD";

const tsOf = (n: number) => `1600000000.${String(n).padStart(6, "0")}`;
const message = (n: number) => ({
  type: "message",
  user: "U222222222",
  text: `msg ${n}`,
  ts: tsOf(n),
});

/** Slack's history pages for messages 1..count, newest first, `size` per page, missing the numbers in `without`. */
function pagesOf(count: number, size: number, without: number[] = []) {
  const numbers = Array.from({ length: count }, (_, i) => count - i).filter(
    (n) => !without.includes(n),
  );
  const pages: Record<string, unknown>[] = [];

  for (let at = 0; at < numbers.length; at += size) {
    const chunk = numbers.slice(at, at + size);
    const hasMore = at + size < numbers.length;

    pages.push({
      ok: true,
      messages: chunk.map(message),
      has_more: hasMore,
      response_metadata: { next_cursor: hasMore ? `after-${at + size}` : "" },
    });
  }

  return pages;
}

async function start(pages: Record<string, unknown>[]) {
  harness = await startSessionHarness({
    prepare: (slack) => slack.respondPaged("conversations.history", pages),
  });
}

const stored = () => harness.session.messages(channel).map((m) => m.ts);
const calls = () =>
  harness.slack.calls.filter((call) => call.method === "conversations.history");

test("a message in the newest page is found with one call", async () => {
  await start(pagesOf(300, 100));

  const result = await harness.session.loadHistoryAround(channel, tsOf(295));

  expect(result).toEqual({ found: true, hasMore: true, isFurtherBack: false });
  expect(calls()).toHaveLength(1);
  expect(stored()).toHaveLength(100);
});

test("an older message loads one page of 200 back from the newest, without gaps", async () => {
  await start(pagesOf(500, 200));

  const result = await harness.session.loadHistoryAround(channel, tsOf(350));

  expect(result).toEqual({ found: true, hasMore: true, isFurtherBack: false });
  expect(calls()).toHaveLength(1);
  expect(calls()[0]!.params.limit).toBe("200");
  expect(stored()).toEqual(
    Array.from({ length: 200 }, (_, i) => tsOf(301 + i)),
  );
});

test("a message further back than that page isn't loaded: one page only, and it says so", async () => {
  await start(pagesOf(500, 200));

  const result = await harness.session.loadHistoryAround(channel, tsOf(150));

  expect(result).toEqual({ found: false, hasMore: true, isFurtherBack: true });
  expect(calls()).toHaveLength(1);
  expect(stored()).toHaveLength(200);
  expect(stored()[0]).toBe(tsOf(301));
});

test("a message at the top of the one page loaded is still opened, without a second page", async () => {
  await start(pagesOf(500, 200));

  const result = await harness.session.loadHistoryAround(channel, tsOf(301));

  expect(result).toEqual({ found: true, hasMore: true, isFurtherBack: false });
  expect(stored()[0]).toBe(tsOf(301));
  expect(calls()).toHaveLength(1);
});

test("with history already loaded, a message near its top loads one more page for the messages before it", async () => {
  await start(pagesOf(500, 200));
  await harness.session.loadHistory(channel);

  const result = await harness.session.loadHistoryAround(channel, tsOf(305));

  expect(result).toEqual({ found: true, hasMore: true, isFurtherBack: false });
  expect(stored()[0]).toBe(tsOf(101));
  expect(calls()).toHaveLength(2);
});

test("scrolling back after loading around continues from the same cursor, without duplicates", async () => {
  await start(pagesOf(500, 200));
  await harness.session.loadHistoryAround(channel, tsOf(150));

  const older = await harness.session.loadHistory(channel);

  expect(older.messages).toHaveLength(200);
  expect(older.hasMore).toBe(true);
  expect(stored()).toEqual(
    Array.from({ length: 400 }, (_, i) => tsOf(101 + i)),
  );
  expect(calls().map((call) => call.params.cursor)).toEqual([
    undefined,
    "after-200",
  ]);
});

test("it merges with history that was already loaded, and doesn't ask for it again", async () => {
  await start(pagesOf(300, 150));
  await harness.session.loadHistory(channel);

  const result = await harness.session.loadHistoryAround(channel, tsOf(50));

  expect(result).toEqual({ found: true, hasMore: false, isFurtherBack: false });
  expect(calls()).toHaveLength(2);
  expect(stored()).toHaveLength(300);
  expect(new Set(stored()).size).toBe(300);
});

test("a message already loaded needs no call at all", async () => {
  await start(pagesOf(500, 200));
  await harness.session.loadHistoryAround(channel, tsOf(350));

  const result = await harness.session.loadHistoryAround(channel, tsOf(380));

  expect(result.found).toBe(true);
  expect(calls()).toHaveLength(1);
});

test("a message that isn't in the history is reported missing, with the history loaded to where it would be", async () => {
  await start(pagesOf(300, 300, [150]));

  const result = await harness.session.loadHistoryAround(channel, tsOf(150));

  expect(result).toEqual({
    found: false,
    hasMore: false,
    isFurtherBack: false,
  });
  expect(stored()).not.toContain(tsOf(150));
  expect(stored()).toContain(tsOf(140));
});

test("a message deleted live while loaded is reported missing", async () => {
  await start(pagesOf(300, 100));
  await harness.session.loadHistoryAround(channel, tsOf(295));
  await harness.sendEvents({
    type: "event_callback",
    event: {
      type: "message",
      subtype: "message_deleted",
      channel,
      ts: "1600000500.000001",
      deleted_ts: tsOf(295),
      previous_message: message(295),
    },
  });

  const result = await harness.session.loadHistoryAround(channel, tsOf(295));

  expect(result.found).toBe(false);
});

test("a message in a conversation shorter than a page is found, with nothing left to load", async () => {
  await start(pagesOf(120, 120));

  const result = await harness.session.loadHistoryAround(channel, tsOf(1));

  expect(result).toEqual({ found: true, hasMore: false, isFurtherBack: false });
  expect(stored()).toHaveLength(120);
});

test("a refusal rejects and keeps what was loaded, and trying again continues", async () => {
  const pages = pagesOf(300, 300);
  let failNext = true;

  harness = await startSessionHarness({
    prepare: (slack) => {
      slack.respondPaged("conversations.history", pages);

      const paged = slack.handler("conversations.history");

      slack.respond("conversations.history", async (call) => {
        if (failNext) {
          failNext = false;

          return { ok: false, error: "not_in_channel" };
        }

        return paged(call);
      });
    },
  });

  await expect(
    harness.session.loadHistoryAround(channel, tsOf(20)),
  ).rejects.toThrow("not_in_channel");
  expect(stored()).toHaveLength(0);

  const result = await harness.session.loadHistoryAround(channel, tsOf(20));

  expect(result.found).toBe(true);
  expect(stored()).toHaveLength(300);
});
