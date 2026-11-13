import { afterEach, expect, test } from "bun:test";
import { loadPayload } from "./support/fixtures";
import { waitFor } from "./support/fakeSlack";
import { findPopup } from "./support/popup";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";

let app: AppHarness;

afterEach(() => app.stop());

const general = "C012AB3CD";
const random = "C061EG9T2";
const secret = "G0SECRET1";
const other = "U222222222";

const secretChannel = {
  id: secret,
  name: "secret-plans",
  is_channel: false,
  is_group: true,
  is_im: false,
  is_mpim: false,
  is_private: true,
  is_archived: false,
  created: 1503435939,
};
const archivedChannel = {
  ...secretChannel,
  id: "G0ARCHIVE",
  name: "old-news",
  is_archived: true,
};

/** The small workspace plus a private channel and an archived one. */
async function start(options: Parameters<typeof startAppHarness>[0] = {}) {
  app = await startAppHarness({
    rows: 30,
    ...options,
    prepare: (slack) => {
      const handler = slack.handler("users.conversations");

      slack.respond("users.conversations", async (call) => {
        const page = (await handler(call)) as { channels?: unknown[] };

        if (call.params.cursor || !page.channels) {
          return page;
        }

        return {
          ...page,
          channels: [...page.channels, secretChannel, archivedChannel],
        };
      });
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [
          {
            type: "message",
            user: other,
            text: "hello there",
            ts: "1600000000.000001",
          },
        ],
        has_more: false,
      }));
      options.prepare?.(slack);
    },
  });
  await app.waitForScreen("@Peter Venkman");
  await waitFor(() => app.session.conversations().length === 7);
}

let counter = 0;

async function say(channel: string, overrides: Record<string, unknown> = {}) {
  const payload = await loadPayload("message");

  counter += 1;

  return app.sendEvents({
    ...payload,
    event: {
      ...payload.event,
      channel,
      user: other,
      ts: `1700000000.${String(counter).padStart(6, "0")}`,
      ...overrides,
    },
  });
}

const statusBar = () => app.screen().trimEnd().split("\n").at(-1)!;
const switcherIsOpen = () => app.screen().includes("Switch conversation");

/** The switcher's result rows, without the highlight marker. */
const results = (): string[] => {
  return (findPopup(app.screen(), "Switch conversation")?.rows ?? [])
    .slice(1)
    .map((line) => line.replace(/^\s*(› )?/, "").trimEnd())
    .filter(Boolean);
};

const popupRows = () =>
  findPopup(app.screen(), "Switch conversation")?.rows ?? [];

const highlighted = () =>
  popupRows()
    .find(
      (line) =>
        (line.trimStart().startsWith("›") && line.includes("#")) ||
        line.trimStart().startsWith("› @"),
    )
    ?.replace(/^\s*› /, "")
    .trimEnd();

const filterLine = () =>
  popupRows().find((line) => line.trimStart().startsWith(">")) ?? "";

async function type(text: string) {
  for (const character of text) {
    await app.press(character);
  }
}

async function openRandom() {
  await app.press(keys.ctrlK);
  await type("random");
  await app.press(keys.enter);
}

test("Ctrl+K opens the switcher over everything the user is in, leaving out archived conversations, and Esc closes it", async () => {
  await start();

  await app.press(keys.ctrlK);

  expect(switcherIsOpen()).toBe(true);
  expect(
    findPopup(app.screen(), "Switch conversation")!.bottomBorder,
  ).toContain("Enter open");
  expect(statusBar()).not.toContain("Enter open");
  expect(results()).toEqual(
    expect.arrayContaining([
      "#general",
      "#random",
      "#secret-plans private",
      "@Peter Venkman",
    ]),
  );
  expect(results().join()).not.toContain("old-news");
  expect(
    results().some((row) => row.startsWith("@") && row.includes(",")),
  ).toBe(true);

  await app.press(keys.escape);

  expect(switcherIsOpen()).toBe(false);
  expect(app.screen()).toContain("Channels");
});

test("typing narrows the list and Backspace widens it", async () => {
  await start();
  await app.press(keys.ctrlK);

  await type("rand");

  expect(filterLine()).toContain("rand");
  expect(results()).toEqual(["#random"]);

  await app.press(keys.backspace);
  await app.press(keys.backspace);
  await app.press(keys.backspace);
  await app.press(keys.backspace);

  expect(results().length).toBeGreaterThan(3);

  await type("zq");

  expect(results()).toEqual([]);

  await app.press(keys.backspace);
  await app.press(keys.backspace);
  await type("venk");

  expect(results()).toEqual(["@Peter Venkman", "@Peter Venkman, stantz"]);
});

test("letters like j, k, q and ? type into the filter instead of acting", async () => {
  await start();
  await app.press(keys.ctrlK);

  await type("jkq?");

  expect(filterLine()).toContain("jkq?");
  expect(switcherIsOpen()).toBe(true);
  expect(app.session.status).not.toBe("disconnected");
});

test("the arrows and Ctrl+N / Ctrl+P move the highlight", async () => {
  await start();
  await app.press(keys.ctrlK);
  await type("e");
  const [first, second] = results();

  expect(highlighted()).toBe(first);

  await app.press(keys.ctrlN);

  expect(highlighted()).toBe(second);

  await app.press(keys.ctrlP);

  expect(highlighted()).toBe(first);

  await app.press(keys.down);
  await app.press(keys.up);
  await app.press(keys.up);

  expect(highlighted()).toBe(first);
});

test("Enter opens the highlighted conversation, selects it in the sidebar and moves focus to its messages", async () => {
  await start();

  await openRandom();
  await app.waitForScreen("hello there");

  expect(switcherIsOpen()).toBe(false);
  expect(statusBar()).toContain("j/k select");
  expect(app.session.currentUserId).toBeDefined();
  expect(app.screen()).toContain("›▌ #random");
});

test("the switcher lists the open conversation's neighbours by recent use, then unread ones, with no filter", async () => {
  await start();
  await say(random, { text: "ping" });
  await waitFor(() => app.session.markers(random).isUnread);
  await app.press(keys.ctrlK);

  expect(results()[0]).toBe("#random");

  await app.press(keys.escape);
  await app.press(keys.ctrlK);
  await type("g");
  await app.press(keys.enter);
  await app.press(keys.ctrlK);

  expect(results()[0]).toBe("#general");
});

test("results show unread and mention markers", async () => {
  await start();
  await say(general, { text: "plain" });
  await say(random, {
    text: `hey <@${app.session.currentUserId ?? "U123ABC456"}>`,
  });
  await waitFor(() => app.session.markers(general).isUnread);
  await app.press(keys.ctrlK);

  const rows = results();

  expect(rows.find((row) => row.startsWith("#general"))).toBeDefined();
  expect(app.session.markers(random).mentions).toBeGreaterThan(0);
  expect(rows.find((row) => row.startsWith("#random"))).toMatch(/\d+ *$/);
  expect(rows.find((row) => row.startsWith("#general"))).not.toMatch(/\d+ *$/);
});

test("Ctrl+K works while typing: Esc leaves the input's text and focus alone", async () => {
  await start();
  await app.press(keys.enter);
  await app.waitForScreen("hello there");
  await app.press("i");
  await type("half a thought");
  expect(statusBar()).toContain("Esc back");

  await app.press(keys.ctrlK);

  expect(switcherIsOpen()).toBe(true);

  await type("zz");
  await app.press(keys.escape);

  expect(switcherIsOpen()).toBe(false);
  expect(app.screen()).toContain("half a thought");
  expect(statusBar()).toContain("Esc back");

  await type("!");

  expect(app.screen()).toContain("half a thought!");
});

test("choosing from an input opens the conversation and keeps both drafts", async () => {
  await start();
  await app.press(keys.enter);
  await app.waitForScreen("hello there");
  await app.press("i");
  await type("draft one");

  await openRandom();
  await app.waitForScreen("hello there");

  expect(app.screen()).not.toContain("draft one");
  expect(statusBar()).toContain("j/k select");

  await app.press("i");
  await type("draft two");
  await app.press(keys.ctrlK);
  await type("general");
  await app.press(keys.enter);

  expect(app.screen()).toContain("draft one");
  expect(app.screen()).not.toContain("draft two");

  await app.press(keys.ctrlK);
  await type("random");
  await app.press(keys.enter);

  expect(app.screen()).toContain("draft two");
});

test("Ctrl+K opens from the message pane and a second Ctrl+K closes it", async () => {
  await start();
  await app.press(keys.enter);
  await app.waitForScreen("hello there");
  await app.press(keys.tab);

  await app.press(keys.ctrlK);

  expect(switcherIsOpen()).toBe(true);

  await app.press(keys.ctrlK);

  expect(switcherIsOpen()).toBe(false);
  expect(statusBar()).toContain("j/k select");
});

test("choosing a conversation in a collapsed section expands it", async () => {
  await start({
    collapseMemory: {
      recall: async () => ["channels"],
      remember: () => {},
      flush: async () => {},
    },
  });
  await waitFor(() => !app.screen().includes("#random"));

  await openRandom();
  await app.waitForScreen("hello there");

  expect(app.screen()).toContain("#general");
  expect(app.screen()).toContain("›▌ #random");
});

test("choosing a DM the recent-DMs filter hides shows it in the sidebar", async () => {
  await start({ recentDms: 1 });
  const sidebarRows = () =>
    app
      .screen()
      .split("\n")
      .map((line) => line.slice(3, 32).trim());
  const hidden = ["@Peter Venkman", "@stantz"].find(
    (name) => !sidebarRows().includes(name),
  );

  expect(hidden).toBeDefined();

  await app.press(keys.ctrlK);
  await type(hidden!.slice(1));
  await app.press(keys.enter);
  await app.waitForScreen("hello there");

  expect(
    app
      .screen()
      .split("\n")
      .some((line) => line.slice(0, 32).includes(`▌ ${hidden}`)),
  ).toBe(true);
});

test("the help lists the switcher's keys", async () => {
  await start({ rows: 100, columns: 200 });

  await app.press("?");

  expect(app.screen()).toContain("Ctrl+K");
  expect(app.screen()).toContain("Quick switcher");

  await app.press("G");

  expect(app.screen()).toContain("Ctrl+N");
  expect(app.screen()).toContain("Ctrl+P");
});

test("the switcher is a compact popup near the top over the panes, which stay where they were", async () => {
  await start({ columns: 100, rows: 40 });
  await app.press(keys.enter);
  await app.waitForScreen("hello there");
  const before = app.screen().split("\n");
  const rows = before.length;

  await app.press(keys.ctrlK);

  const popup = findPopup(app.screen(), "Switch conversation")!;

  expect(popup.right - popup.left).toBe(60);
  expect(popup.left).toBe(20);
  expect(popup.top).toBe(7);
  // The filter line and one row per result, up to ten.
  expect(popup.rows.length).toBe(1 + results().length);
  expect(popup.rows.length).toBeLessThanOrEqual(11);

  const after = app.screen().split("\n");

  for (const [index, line] of before.entries()) {
    if (index < popup.top || (index > popup.bottom && index < rows - 1)) {
      expect(after[index]).toBe(line);
    }
  }

  expect(after[0]).toContain("Channels");
});

test("nothing from the panes shows through the switcher popup, even on its empty rows", async () => {
  await start({ columns: 100, rows: 12 });
  await app.press(keys.enter);
  await app.waitForScreen("hello there");
  const before = app.screen().split("\n");

  await app.press(keys.ctrlK);

  const popup = findPopup(app.screen(), "Switch conversation")!;
  const underneath = before
    .slice(popup.top + 1, popup.bottom)
    .map((line) => [...line].slice(popup.left + 1, popup.right - 1).join(""));

  expect(underneath.join("").trim()).not.toBe("");
  expect(popup.rows.every((row) => row.length === 58)).toBe(true);
  expect(popup.rows.join("")).not.toContain("hello there");

  await type("zzzzzz");

  const empty = findPopup(app.screen(), "Switch conversation")!;

  expect(results()).toEqual([]);
  expect(empty.rows).toHaveLength(2);
  expect(empty.rows[1]).toBe(" ".repeat(58));
});

test("in a narrow terminal the switcher popup fills the width, and a long row is cut off, not wrapped", async () => {
  await start({ columns: 56, rows: 20 });

  await app.press(keys.ctrlK);

  const popup = findPopup(app.screen(), "Switch conversation")!;

  expect(popup.left).toBe(0);
  expect(popup.right).toBe(56);

  await type("peter");

  expect(results()).toEqual(["@Peter Venkman", "@Peter Venkman, stantz"]);
  expect(findPopup(app.screen(), "Switch conversation")!.rows).toHaveLength(3);
});

test("Ctrl+K from the help closes it and opens the switcher", async () => {
  await start();
  await app.press("?");
  expect(app.screen()).toContain("Keyboard shortcuts");

  await app.press(keys.ctrlK);

  expect(switcherIsOpen()).toBe(true);
  expect(app.screen()).not.toContain("Keyboard shortcuts");

  await app.press(keys.escape);

  expect(switcherIsOpen()).toBe(false);
  expect(app.screen()).not.toContain("Keyboard shortcuts");
});

test("Ctrl+K from the search closes it and opens the switcher, and / brings the query back", async () => {
  await start({
    prepare: (slack) =>
      slack.respond("search.messages", () => ({
        ok: true,
        messages: { total: 0, matches: [], paging: { page: 1, pages: 1 } },
      })),
  });
  await app.press("/");
  await type("deploy");
  await app.press(keys.enter);
  await app.waitForScreen('No messages match "deploy"');

  await app.press(keys.ctrlK);

  expect(switcherIsOpen()).toBe(true);
  expect(app.screen()).not.toContain("Search messages");

  await app.press(keys.escape);
  await app.press("/");

  expect(app.screen()).toContain("Search messages");
  expect(app.screen()).toContain("deploy");
});

test("Ctrl+K from the reaction prompt closes it and opens the switcher", async () => {
  await start();
  await app.press(keys.enter);
  await app.waitForScreen("hello there");
  await app.press(keys.tab);
  await app.press("r");
  expect(app.screen()).toContain("Add reaction");

  await app.press(keys.ctrlK);

  expect(switcherIsOpen()).toBe(true);
  expect(app.screen()).not.toContain("Add reaction");
});
