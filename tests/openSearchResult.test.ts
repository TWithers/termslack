import { afterEach, expect, test } from "bun:test";
import type { ConversationMemory } from "../src/config/state";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import { type FakeSlack, waitFor } from "./support/fakeSlack";
import { findPopup } from "./support/popup";

let app: AppHarness;

afterEach(() => app.stop());

const general = "C012AB3CD";
const random = "C061EG9T2";
const design = "C0DES1GN7";

const tsOf = (n: number) => `1600000000.${String(n).padStart(6, "0")}`;
const num = (n: number) => `msg ${String(n).padStart(4, "0")}`;
const replyTs = "1600009999.000001";

function post(n: number, extra: Record<string, unknown> = {}) {
  return {
    type: "message",
    user: "U222222222",
    text: num(n),
    ts: tsOf(n),
    ...extra,
  };
}

/** Slack's history pages for messages 1..count (minus `without`), newest first, 200 per page. */
function pagesOf(count: number, without: number[] = []) {
  const numbers = Array.from({ length: count }, (_, i) => count - i).filter(
    (n) => !without.includes(n),
  );
  const pages: Record<string, unknown>[] = [];

  for (let at = 0; at < numbers.length; at += 200) {
    const hasMore = at + 200 < numbers.length;

    pages.push({
      ok: true,
      messages: numbers
        .slice(at, at + 200)
        .map((n) =>
          n === 60
            ? post(n, { thread_ts: tsOf(60), reply_count: 1 })
            : n === 100
              ? post(n, { thread_ts: tsOf(100), reply_count: 1 })
              : post(n),
        ),
      has_more: hasMore,
      response_metadata: { next_cursor: hasMore ? `after-${at + 200}` : "" },
    });
  }

  return pages;
}

type Hit = {
  channel?: string;
  ts: string;
  text: string;
  threadTs?: string;
  name?: string;
};

function match({ channel = general, ts, text, threadTs, name }: Hit) {
  const base = `https://acme.slack.com/archives/${channel}/p${ts.replace(".", "")}`;

  return {
    channel: {
      id: channel,
      name: name ?? (channel === general ? "general" : "random"),
      is_channel: true,
      is_im: false,
      is_mpim: false,
    },
    type: "message",
    user: "U222222222",
    ts,
    text,
    permalink: threadTs ? `${base}?thread_ts=${threadTs}&cid=${channel}` : base,
  };
}

async function start(
  hits: Hit[],
  options: {
    history?: Record<string, unknown>[];
    prepare?: (slack: FakeSlack) => void;
    rows?: number;
    memory?: ConversationMemory;
  } = {},
) {
  app = await startAppHarness({
    columns: 120,
    rows: options.rows ?? 30,
    conversationMemory: options.memory,
    prepare: (slack) => {
      slack.respond("search.messages", () => ({
        ok: true,
        query: "needle",
        messages: {
          total: hits.length,
          paging: { count: hits.length, total: hits.length, page: 1, pages: 1 },
          matches: hits.map(match),
        },
      }));
      slack.respondPaged(
        "conversations.history",
        options.history ?? pagesOf(120, [65]),
      );
      slack.respond("conversations.replies", () => ({
        ok: true,
        messages: [
          post(60, { thread_ts: tsOf(60), reply_count: 1 }),
          post(0, {
            text: "the reply",
            ts: replyTs,
            thread_ts: tsOf(60),
          }),
        ],
        has_more: false,
      }));

      return options.prepare?.(slack);
    },
  });
  await app.waitForScreen("#general", 5000);
  await waitFor(() => app.session.currentUserId);
}

async function searchFor(query = "needle") {
  await app.press("/");

  for (const character of query) {
    await app.press(character);
  }

  await app.press(keys.enter);
  await app.waitForScreen(/\d+ match/);
}

const searchOpen = () =>
  findPopup(app.screen(), "Search messages") !== undefined;
const statusBar = () => app.screen().trimEnd().split("\n").at(-1)!;
/** The selected message's line in the panes (the bar in the pane's title row only marks focus). */
const selectedLine = () =>
  app
    .screen()
    .split("\n")
    .slice(1)
    .map((line) => line.slice(32))
    .find((line) => line.includes("▌")) ?? "";
const historyCalls = () =>
  app.slack.calls.filter((call) => call.method === "conversations.history");
const paneText = () =>
  app
    .screen()
    .split("\n")
    .map((line) => line.slice(32))
    .join("\n");
const visible = () =>
  [...paneText().matchAll(/msg (\d{4})/g)].map((found) => Number(found[1]));

async function openSelectedResult() {
  await app.press(keys.enter);
}

test("Enter on a result already in the loaded history closes the search and selects it, with no more history loaded", async () => {
  await start([{ ts: tsOf(110), text: "needle 110" }]);
  await app.press(keys.enter);
  await app.waitForScreen(num(120));

  await searchFor();
  await openSelectedResult();
  await app.waitForScreen("▌");

  expect(searchOpen()).toBe(false);
  expect(selectedLine()).toContain(num(110));
  expect(historyCalls()).toHaveLength(1);
});

test("an old result loads one page, selects it in view, and scrolling goes both ways afterwards", async () => {
  await start([{ ts: tsOf(350), text: "needle 350" }], {
    history: pagesOf(500),
  });
  await searchFor();
  await openSelectedResult();
  await app.waitForScreen(num(350));

  expect(searchOpen()).toBe(false);
  expect(selectedLine()).toContain(num(350));
  expect(visible()).toContain(349);
  expect(visible()).toContain(351);
  expect(historyCalls().map((call) => call.params.cursor)).toEqual([undefined]);

  // Up to the oldest loaded message (301), then wait for the older page, so
  // no press lands while there's nothing above to move to.
  for (let i = 0; i < 49; i++) {
    await app.press("k");
  }

  await waitFor(() => historyCalls().length === 2);

  while (!selectedLine().includes(num(300))) {
    await app.press("k");
  }

  for (let i = 0; i < 10; i++) {
    await app.press("k");
  }

  await waitFor(() => selectedLine().includes(num(290)));
  expect(historyCalls().map((call) => call.params.cursor)).toEqual([
    undefined,
    "after-200",
  ]);

  await app.press("G");
  await app.waitForScreen(num(500));
  expect(selectedLine()).toContain(num(500));
});

test("a result further back than the last 200 messages opens at the oldest one loaded and says to scroll up", async () => {
  await start([{ ts: tsOf(100), text: "needle 100" }], {
    history: pagesOf(500),
  });
  await searchFor();
  await openSelectedResult();
  await app.waitForScreen("further back");

  expect(statusBar()).toContain(
    "That result is further back than the last 200 messages. Scroll up to load more.",
  );
  expect(searchOpen()).toBe(false);
  await waitFor(() => selectedLine().includes(num(301)));
  expect(historyCalls()[0]!.params.cursor).toBeUndefined();

  // The oldest message loaded is at the top of the view, so scrolling's own
  // "reached the top" loads the next page, from the same cursor.
  await waitFor(() => historyCalls().length === 2);
  await Bun.sleep(100);

  expect(historyCalls().map((call) => call.params.cursor)).toEqual([
    undefined,
    "after-200",
  ]);
  expect(selectedLine()).toContain(num(301));
});

test("opening a result opens its conversation as the sidebar would: unread clears, it is remembered", async () => {
  const remembered: (string | undefined)[] = [];

  await start([{ ts: tsOf(30), text: "needle 30" }], {
    memory: {
      recall: async () => undefined,
      remember: (id) => {
        remembered.push(id);
      },
      flush: async () => {},
    },
  });
  await app.sendEvents({
    event: {
      ...post(121),
      channel: general,
      channel_type: "channel",
      user: "U333333333",
    },
  });
  await waitFor(() => app.session.markers(general).isUnread);

  await searchFor();
  await openSelectedResult();
  await app.waitForScreen(num(30));

  expect(app.session.markers(general).isUnread).toBe(false);
  expect(remembered).toEqual([general]);
});

test("a thread reply opens the thread pane on the reply, with the parent selected in the conversation", async () => {
  await start([{ ts: replyTs, text: "needle reply", threadTs: tsOf(60) }]);
  await searchFor();
  await openSelectedResult();
  await app.waitForScreen("the reply");

  const lines = app.screen().split("\n");

  expect(searchOpen()).toBe(false);
  expect(lines.some((line) => line.includes("Thread"))).toBe(true);
  expect(selectedLine()).toContain("the reply");
  expect(visible()).toContain(60);
  expect(
    app.slack.calls.some((call) => call.method === "conversations.replies"),
  ).toBe(true);

  await app.press("q");
  expect(statusBar()).not.toContain("deleted");
});

test("a thread parent found by search opens in its conversation like any message, without a thread pane", async () => {
  await start([{ ts: tsOf(100), text: "needle parent", threadTs: tsOf(100) }]);
  await app.press(keys.enter);
  await app.waitForScreen(num(120));
  await searchFor();
  await openSelectedResult();
  await app.waitForScreen(num(100));

  expect(selectedLine()).toContain(num(100));
  expect(app.screen()).not.toContain("Thread");
  expect(
    app.slack.calls.some((call) => call.method === "conversations.replies"),
  ).toBe(false);
});

test("a message that has been deleted opens the conversation at that point and says so", async () => {
  await start([{ ts: tsOf(65), text: "needle 65" }]);
  await searchFor();
  await openSelectedResult();
  await app.waitForScreen("deleted");

  expect(statusBar()).toContain("That message has been deleted.");
  expect(searchOpen()).toBe(false);
  await waitFor(() => selectedLine().includes(num(64)));
});

test("a thread reply that has been deleted opens the thread and says so", async () => {
  await start([
    { ts: "1600009998.000001", text: "needle gone", threadTs: tsOf(60) },
  ]);
  await searchFor();
  await openSelectedResult();
  await app.waitForScreen("deleted");

  expect(statusBar()).toContain("That message has been deleted.");
  expect(app.screen()).toContain("the reply");
});

test("/ brings back the same results with the highlight where it was", async () => {
  await start([
    { ts: tsOf(110), text: "needle 110" },
    { ts: tsOf(30), text: "needle 30" },
  ]);
  await searchFor();
  await app.press(keys.down);
  await openSelectedResult();
  await app.waitForScreen(num(30));
  await app.press(keys.escape);
  await app.press("/");

  const popup = findPopup(app.screen(), "Search messages");

  expect(popup?.rows[1]).toContain("> needle");
  expect(popup?.rows.join("\n")).toContain("needle 110");
  expect(popup?.rows.join("\n")).toContain("needle 30");
  expect(app.session.searchState().results).toHaveLength(2);

  await app.press(keys.up);
  await openSelectedResult();
  await waitFor(() => selectedLine().includes(num(110)));
});

test("Enter on a changed query searches again instead of opening", async () => {
  await start([{ ts: tsOf(110), text: "needle 110" }]);
  await searchFor();
  await app.press("x");
  await app.press(keys.enter);
  await app.waitForScreen(/\d+ match/);

  expect(searchOpen()).toBe(true);
  expect(
    app.slack.calls.filter((call) => call.method === "search.messages"),
  ).toHaveLength(2);
});

test("a public channel the user isn't in opens read-only: its history shows and the input explains", async () => {
  await start(
    [{ channel: design, ts: tsOf(7), text: "needle design", name: "design" }],
    {
      prepare: (slack) => {
        slack.respond("conversations.info", (call) =>
          call.params.channel === design
            ? {
                ok: true,
                channel: {
                  id: design,
                  name: "design",
                  is_channel: true,
                  is_member: false,
                },
              }
            : { ok: false, error: "channel_not_found" },
        );

        const paged = slack.handler("conversations.history");

        slack.respond("conversations.history", (call) =>
          call.params.channel === design
            ? {
                ok: true,
                messages: [
                  {
                    type: "message",
                    user: "U222222222",
                    text: "design talk",
                    ts: tsOf(7),
                  },
                ],
                has_more: false,
              }
            : paged(call),
        );
      },
    },
  );
  await searchFor();
  await openSelectedResult();
  await app.waitForScreen("design talk");

  expect(app.screen()).toContain("#design");
  expect(app.screen()).toContain("You're not a member of #design");
  expect(selectedLine()).toContain("design talk");

  await app.press("i");
  await app.press("a");
  expect(statusBar()).toContain("not a member");
  expect(app.session.conversation(design)?.isMember).toBe(false);
  expect(
    app.slack.calls.filter((call) => call.method === "conversations.mark"),
  ).toHaveLength(0);
});

test("a channel Slack won't let the user read shows the reason in the status bar", async () => {
  await start(
    [{ channel: design, ts: tsOf(7), text: "needle design", name: "design" }],
    {
      prepare: (slack) => {
        slack.respond("conversations.info", (call) =>
          call.params.channel === design
            ? {
                ok: true,
                channel: {
                  id: design,
                  name: "design",
                  is_channel: true,
                  is_member: false,
                },
              }
            : { ok: false, error: "channel_not_found" },
        );

        const paged = slack.handler("conversations.history");

        slack.respond("conversations.history", (call) =>
          call.params.channel === design
            ? { ok: false, error: "not_in_channel" }
            : paged(call),
        );
      },
    },
  );
  await searchFor();
  await openSelectedResult();
  await app.waitForScreen("without joining it");

  expect(statusBar()).toContain(
    "Slack doesn't let you read this channel without joining it",
  );
  expect(searchOpen()).toBe(false);
});

test("a result in a conversation termslack can't look up says so and leaves the search open", async () => {
  await start([
    { channel: "C0UNKNOWN1", ts: tsOf(7), text: "needle ?", name: "secret" },
  ]);
  await searchFor();
  await openSelectedResult();
  await app.waitForScreen("Slack won't let termslack open that conversation");

  expect(searchOpen()).toBe(false);
  expect(app.session.searchState().results).toHaveLength(1);
});

test("a result in a conversation in another sidebar section's channel opens it", async () => {
  await start([{ channel: random, ts: tsOf(5), text: "needle random" }], {
    history: pagesOf(20),
  });
  await searchFor();
  await openSelectedResult();
  await app.waitForScreen(num(5));

  expect(selectedLine()).toContain(num(5));
  expect(app.screen()).toContain("#random");
});
