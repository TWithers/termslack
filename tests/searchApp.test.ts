import { afterEach, expect, test } from "bun:test";
import { shortcuts } from "../src/ui/app/shortcuts";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import { loadFixture } from "./support/fixtures";
import { type FakeSlack, waitFor } from "./support/fakeSlack";
import { findPopup } from "./support/popup";

let app: AppHarness;

afterEach(() => app.stop());

const searchTitle = "Search messages";

async function start({
  scopes,
  search,
  rows = 30,
}: {
  scopes?: string[];
  search?: Parameters<FakeSlack["respond"]>[1];
  rows?: number;
} = {}) {
  const pages = await loadFixture("search-messages");

  app = await startAppHarness({
    rows,
    columns: 120,
    prepare: (slack) => {
      slack.respond("search.messages", (call) =>
        search
          ? search(call)
          : (pages[Number(call.params.page) - 1] ?? {
              ok: false,
              error: "no_page",
            }),
      );
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [],
        has_more: false,
      }));

      if (scopes) {
        slack.grantScopes(scopes);
      }
    },
  });
  await app.waitForScreen("#general", 5000);
  await waitFor(() => app.session.currentUserId);
}

const statusBar = () => app.screen().trimEnd().split("\n").at(-1)!;
const popup = () => findPopup(app.screen(), searchTitle);
const popupText = () => popup()?.rows.join("\n") ?? "";
const title = () => popup()?.topBorder ?? "";
const searchCalls = () =>
  app.slack.calls.filter((call) => call.method === "search.messages");

async function type(text: string) {
  for (const character of text) {
    await app.press(character);
  }
}

async function searchFor(query: string) {
  await app.press("/");
  await type(query);
  await app.press(keys.enter);
}

test("/ from the sidebar opens a search prompt that says what to type, and runs nothing yet", async () => {
  await start();

  await app.press("/");

  expect(popup()).toBeDefined();
  expect(popupText()).toContain("Type a query and press Enter");
  expect(popup()!.bottomBorder).toContain("Enter search");
  expect(statusBar()).not.toContain("Enter search");
  expect(searchCalls()).toHaveLength(0);
});

test("Enter runs the query and lists results newest first with conversation, author, time and rendered text", async () => {
  await start();

  await searchFor("proton");
  await app.waitForScreen("proton pack lunch");

  const text = popupText();

  expect(popup()?.rows[0]).toContain("> proton");
  expect(title()).toContain("4 matches");
  expect(text).toContain("#general · Peter Venkman");
  expect(text).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  expect(text).toContain("Has anyone seen the @stantz proton pack? 🎉");
  expect(text).toContain("@Peter Venkman · Peter Venkman");
  expect(text).toContain("lunch at noon? the menu (https://example.com/menu)");
  expect(text).toContain("#random · stantz");
  expect(text).toContain("reply in thread");
  expect(text.indexOf("#general")).toBeLessThan(text.indexOf("#random"));
  expect(text).not.toContain("*proton*");
  expect(searchCalls()[0]?.params).toMatchObject({
    query: "proton",
    sort_dir: "desc",
    count: "20",
  });
});

test("scrolling to the last result loads the next page, and the end of results is shown", async () => {
  await start({ rows: 24 });

  await searchFor("proton");
  await app.waitForScreen("proton pack lunch");
  expect(title()).not.toContain("end of results");

  await app.press(keys.down);
  await app.press(keys.down);
  await waitFor(() => searchCalls().length === 2);
  await app.waitForScreen("end of results");

  expect(title()).toContain("4 matches");
  expect(popupText()).not.toContain("design review notes");

  await app.press(keys.down);

  expect(popupText()).toContain("#design · gozer");
  expect(popupText()).toContain("proton pack design review notes");
  expect(popupText()).toContain("› #design");

  await app.press(keys.down);

  expect(searchCalls()).toHaveLength(2);
});

test("Ctrl+N and Ctrl+P move the highlight too", async () => {
  await start();

  await searchFor("proton");
  await app.waitForScreen("proton pack lunch");

  await app.press(keys.ctrlN);
  expect(popupText()).toContain("› @Peter Venkman");

  await app.press(keys.ctrlP);
  expect(popupText()).toContain("› #general");
});

test("changing the query and pressing Enter starts a new search that replaces the results", async () => {
  await start({
    search: ({ params }) =>
      params.query === "other"
        ? {
            ok: true,
            messages: {
              total: 0,
              paging: { page: 1, pages: 0 },
              matches: [],
            },
          }
        : {
            ok: true,
            messages: {
              total: 1,
              paging: { page: 1, pages: 1 },
              matches: [
                {
                  ts: "1700000300.000100",
                  user: "U222222222",
                  text: "old answer",
                  channel: {
                    id: "C012AB3CD",
                    name: "general",
                    is_channel: true,
                  },
                },
              ],
            },
          },
  });

  await searchFor("first");
  await app.waitForScreen("old answer");

  await app.press(keys.backspace);
  await app.press(keys.backspace);
  await app.press(keys.backspace);
  await app.press(keys.backspace);
  await app.press(keys.backspace);
  await type("other");
  await app.press(keys.enter);
  await app.waitForScreen('No messages match "other"');

  expect(popupText()).not.toContain("old answer");
  expect(searchCalls().map((call) => call.params.query)).toEqual([
    "first",
    "other",
  ]);
});

test("no results says so, with the total at zero", async () => {
  await start({
    search: () => ({
      ok: true,
      messages: { total: 0, paging: { page: 1, pages: 0 }, matches: [] },
    }),
  });

  await searchFor("nothing");
  await app.waitForScreen('No messages match "nothing"');

  expect(title()).toContain("0 matches");
});

test("Slack refusing the query shows the reason in the overlay", async () => {
  await start({ search: () => ({ ok: false, error: "invalid_query" }) });

  await searchFor("from:");
  await app.waitForScreen("Slack didn't understand that search.");

  expect(popup()).toBeDefined();
});

test("a refusal with a code termslack has no wording for shows the code", async () => {
  await start({ search: () => ({ ok: false, error: "fatal_error" }) });

  await searchFor("x");
  await app.waitForScreen("fatal_error");
});

test("without search:read, / explains in the status bar and opens nothing", async () => {
  await start({ scopes: ["identify", "channels:read"] });

  await app.press("/");

  expect(popup()).toBeUndefined();
  expect(statusBar()).toContain("search:read");
  expect(searchCalls()).toHaveLength(0);
});

test("in the input box / types a slash instead of opening the search", async () => {
  await start();
  await app.press(keys.enter);
  await app.press(keys.tab);
  await app.press("i");
  await app.press("/");

  expect(popup()).toBeUndefined();
  expect(app.screen()).toContain("/");
  expect(app.screen()).not.toContain(searchTitle);
});

test("/ works from the message pane too", async () => {
  await start();
  await app.press(keys.enter);
  await app.press(keys.tab);

  await app.press("/");

  expect(popup()).toBeDefined();
});

test("Esc closes the search and focus is back where it was", async () => {
  await start();
  await app.press(keys.enter);
  await app.press(keys.tab);
  expect(statusBar()).toContain("j/k select");

  await searchFor("proton");
  await app.waitForScreen("proton pack lunch");
  await app.press(keys.escape);

  expect(popup()).toBeUndefined();
  expect(statusBar()).toContain("j/k select");
});

test("the last query is remembered: reopening search starts with it and its results", async () => {
  await start();

  await searchFor("proton");
  await app.waitForScreen("proton pack lunch");
  await app.press(keys.escape);
  await app.press("/");

  expect(popup()?.rows[0]).toContain("> proton");
  expect(popupText()).toContain("proton pack lunch");
  expect(searchCalls().filter((call) => call.params.page === "1")).toHaveLength(
    1,
  );
});

test("while typing, letters that are list keys go into the query", async () => {
  await start();

  await app.press("/");
  await type("jkgG");

  expect(popup()?.rows[0]).toContain("> jkgG");
});

test("a small terminal still shows whole results and scrolls through them", async () => {
  await start({ rows: 16 });

  await searchFor("proton");
  await app.waitForScreen("Has anyone seen");
  expect(popupText()).not.toContain("lunch at noon");

  await app.press(keys.pageDown);
  await app.press(keys.pageDown);
  await waitFor(() => searchCalls().length === 2);
  await app.waitForScreen("end of results");

  expect(popupText()).toContain("#random");
});

test("the help lists / and the search keys", async () => {
  await start();

  await app.press("?");

  const keysShown = shortcuts
    .filter(
      (shortcut) =>
        shortcut.group === "search" || shortcut.id === "global.search",
    )
    .map((shortcut) => shortcut.description);

  expect(keysShown.length).toBeGreaterThan(3);
  expect(
    findPopup(app.screen(), "Keyboard shortcuts")?.rows.join("\n"),
  ).toContain("Search messages across the workspace");

  for (let index = 0; index < 8; index++) {
    await app.press(keys.pageDown);
  }

  expect(app.screen()).toContain("Message search");
  expect(app.screen()).toContain("Search for the query");
});
