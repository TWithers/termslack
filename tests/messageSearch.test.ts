import { afterEach, expect, test } from "bun:test";
import { loadFixture } from "./support/fixtures";
import { type FakeSlack, waitFor } from "./support/fakeSlack";
import { seedWorkspace } from "./support/appHarness";
import {
  type SessionHarness,
  startSessionHarness,
} from "./support/sessionHarness";

let harness: SessionHarness;

afterEach(() => harness.stop());

const general = "C012AB3CD";
const random = "C061EG9T2";
const design = "C0DES1GN7";
const ray = "U888888888";

/** Answers `search.messages` with the fixture's page number asked for. */
async function respondWithPages(slack: FakeSlack) {
  const pages = await loadFixture("search-messages");

  slack.respond("search.messages", ({ params }) => {
    return pages[Number(params.page) - 1] ?? { ok: false, error: "no_page" };
  });
}

async function start({
  scopes,
  prepare,
}: {
  scopes?: string[];
  prepare?: (slack: FakeSlack) => void | Promise<void>;
} = {}) {
  harness = await startSessionHarness({
    prepare: async (slack) => {
      await seedWorkspace(slack);
      await respondWithPages(slack);

      if (scopes) {
        slack.grantScopes(scopes);
      }

      await prepare?.(slack);
    },
  });
  await waitFor(() => harness.session.conversation(general));
  await waitFor(() => harness.session.currentUserId);
}

const searchCalls = () =>
  harness.slack.calls.filter((call) => call.method === "search.messages");

test("a search asks Slack for the newest 20 matches and lists them with where and who", async () => {
  await start();

  expect(harness.session.searchState().status).toBe("idle");

  await harness.session.search("  proton  ");

  const state = harness.session.searchState();

  expect(searchCalls()).toHaveLength(1);
  expect(searchCalls()[0]?.params).toMatchObject({
    query: "proton",
    sort: "timestamp",
    sort_dir: "desc",
    count: "20",
    page: "1",
  });
  expect(state).toMatchObject({
    query: "proton",
    status: "loaded",
    total: 4,
    hasMore: true,
    loadingMore: false,
  });
  expect(
    state.results.map(({ message }) => [
      message.channelId,
      message.ts,
      message.userId,
    ]),
  ).toEqual([
    [general, "1700000300.000100", "U222222222"],
    ["D0C0F7S8Y", "1700000200.000200", "U222222222"],
    [random, "1700000100.000300", "U333333333"],
  ]);
});

test("a result carries what opening it needs: conversation, ts, thread and permalink", async () => {
  await start();

  await harness.session.search("proton");

  const [channelMessage, , reply] = harness.session.searchState().results;

  expect(channelMessage?.permalink).toBe(
    "https://example.slack.com/archives/C012AB3CD/p1700000300000100",
  );
  expect(channelMessage?.message.threadTs).toBeUndefined();
  expect(reply?.message.threadTs).toBe("1700000000.000300");
  expect(reply?.permalink).toContain("thread_ts=1700000000.000300");
});

test("the next page is added after the first, with the total kept and the end reached", async () => {
  await start();

  await harness.session.search("proton");
  await harness.session.searchMore();

  const state = harness.session.searchState();

  expect(searchCalls().map((call) => call.params.page)).toEqual(["1", "2"]);
  expect(state.results).toHaveLength(4);
  expect(state.results.at(-1)?.message.channelId).toBe(design);
  expect(state).toMatchObject({ total: 4, hasMore: false });

  await harness.session.searchMore();

  expect(searchCalls()).toHaveLength(2);
});

test("a page that repeats a message the earlier ones had doesn't show it twice", async () => {
  const pages = await loadFixture("search-messages");

  await start({
    prepare: (slack) =>
      slack.respond("search.messages", ({ params }) =>
        params.page === "1"
          ? pages[0]!
          : {
              ...pages[1]!,
              messages: {
                ...pages[1]!.messages,
                matches: [
                  pages[0]!.messages.matches[2],
                  ...pages[1]!.messages.matches,
                ],
              },
            },
      ),
  });

  await harness.session.search("proton");
  await harness.session.searchMore();

  expect(harness.session.searchState().results).toHaveLength(4);
});

test("names in the results are resolved: the conversation's people, the author and mentions", async () => {
  await start({
    prepare: (slack) =>
      slack.respond("users.info", ({ params }) =>
        params.user === ray
          ? {
              ok: true,
              user: {
                id: ray,
                name: "gozer",
                real_name: "Gozer Gozerian",
                profile: { display_name: "Gozer" },
              },
            }
          : { ok: false, error: "user_not_found" },
      ),
  });

  expect(harness.session.user(ray)).toBeUndefined();

  await harness.session.search("proton");
  await harness.session.searchMore();

  expect(harness.session.user(ray)?.displayName).toBe("Gozer");
});

test("a conversation termslack doesn't know is looked up so it can be named", async () => {
  await start({
    prepare: (slack) =>
      slack.respond("conversations.info", ({ params }) =>
        params.channel === design
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
      ),
  });

  expect(harness.session.conversation(design)).toBeUndefined();

  await harness.session.search("proton");
  await harness.session.searchMore();

  expect(harness.session.conversation(design)?.name).toBe("design");
});

test("a newer search is never replaced by a slower older one", async () => {
  const pages = await loadFixture("search-messages");
  let releaseOld: () => void = () => {};
  const oldAnswer = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });

  await start({
    prepare: (slack) =>
      slack.respond("search.messages", async ({ params }) => {
        if (params.query === "old") {
          await oldAnswer;
          return pages[0]!;
        }

        return {
          ...pages[1]!,
          query: "new",
          messages: { ...pages[1]!.messages, total: 1 },
        };
      }),
  });

  const old = harness.session.search("old");

  await waitFor(() => searchCalls().length === 1);
  await harness.session.search("new");
  releaseOld();
  await old;

  const state = harness.session.searchState();

  expect(state.query).toBe("new");
  expect(state.results.map(({ message }) => message.channelId)).toEqual([
    design,
  ]);
});

test("a page still loading when a new search starts is dropped", async () => {
  const pages = await loadFixture("search-messages");
  let releaseSecond: () => void = () => {};
  const secondAnswer = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });

  await start({
    prepare: (slack) =>
      slack.respond("search.messages", async ({ params }) => {
        if (params.page === "2") {
          await secondAnswer;
          return pages[1]!;
        }

        return params.query === "other"
          ? {
              ...pages[0]!,
              messages: {
                ...pages[0]!.messages,
                total: 3,
                paging: { page: 1, pages: 1 },
              },
            }
          : pages[0]!;
      }),
  });

  await harness.session.search("proton");

  const more = harness.session.searchMore();

  await harness.session.search("other");
  releaseSecond();
  await more;

  const state = harness.session.searchState();

  expect(state.query).toBe("other");
  expect(state.results).toHaveLength(3);
  expect(state.loadingMore).toBe(false);
});

test("while the first page loads the state says so and holds no old results", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pages = await loadFixture("search-messages");

  await start({
    prepare: (slack) =>
      slack.respond("search.messages", async () => {
        await gate;
        return pages[0]!;
      }),
  });

  const searching = harness.session.search("proton");

  await waitFor(() => harness.session.searchState().status === "searching");
  expect(harness.session.searchState().results).toEqual([]);
  release();
  await searching;
  expect(harness.session.searchState().status).toBe("loaded");
});

test("no matches is a loaded search with no results", async () => {
  await start({
    prepare: (slack) =>
      slack.respond("search.messages", () => ({
        ok: true,
        query: "zzz",
        messages: {
          total: 0,
          paging: { count: 20, total: 0, page: 1, pages: 0 },
          matches: [],
        },
      })),
  });

  await harness.session.search("zzz");

  expect(harness.session.searchState()).toMatchObject({
    status: "loaded",
    results: [],
    total: 0,
    hasMore: false,
  });
});

test("a blank query does nothing", async () => {
  await start();

  await harness.session.search("   ");

  expect(searchCalls()).toHaveLength(0);
  expect(harness.session.searchState().status).toBe("idle");
});

test.each([
  ["invalid_query", "Slack didn't understand that search."],
  ["missing_scope", "search:read"],
  ["rate_limited", "going too fast"],
  ["something_new", "something_new"],
])("Slack refusing with %s says why", async (code, wording) => {
  await start({
    prepare: (slack) =>
      slack.respond("search.messages", () => ({ ok: false, error: code })),
  });

  await harness.session.search("proton");

  const state = harness.session.searchState();

  expect(state.status).toBe("failed");
  expect(state.failure).toContain(wording);
  expect(state.query).toBe("proton");
});

test("without the search:read permission nothing is sent and the reason is given", async () => {
  await start({ scopes: ["identify", "channels:read"] });

  await harness.session.search("proton");

  expect(searchCalls()).toHaveLength(0);
  expect(harness.session.searchState()).toMatchObject({
    status: "failed",
    failure: expect.stringContaining("search:read"),
  });
  expect(harness.session.scopeProblem("search")).toContain("search:read");
});

test("a page that fails keeps the results and the next call tries it again", async () => {
  const pages = await loadFixture("search-messages");
  let failing = true;

  await start({
    prepare: (slack) =>
      slack.respond("search.messages", ({ params }) => {
        if (params.page === "2" && failing) {
          return { ok: false, error: "internal_error" };
        }

        return pages[Number(params.page) - 1]!;
      }),
  });

  await harness.session.search("proton");
  await harness.session.searchMore();

  expect(harness.session.searchState()).toMatchObject({
    status: "loaded",
    loadingMore: false,
    hasMore: true,
    failure: expect.stringContaining("internal_error"),
  });
  expect(harness.session.searchState().results).toHaveLength(3);

  failing = false;
  await harness.session.searchMore();

  expect(harness.session.searchState().results).toHaveLength(4);
  expect(harness.session.searchState().failure).toBeUndefined();
});
