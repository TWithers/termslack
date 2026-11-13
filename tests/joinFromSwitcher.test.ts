import { afterEach, expect, test } from "bun:test";
import { loadFixture, loadPayload } from "./support/fixtures";
import { waitFor, type FakeSlack } from "./support/fakeSlack";
import { findPopup } from "./support/popup";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import { sidebarRows as readSidebarRows } from "./support/panes";

let app: AppHarness;

afterEach(() => app.stop());

const design = "C0DES1GN7";

const everyScope = ["identify", "channels:read", "channels:write"];

async function start({
  scopes = everyScope,
  join,
  gate,
  ...options
}: {
  scopes?: string[];
  join?: Parameters<FakeSlack["respond"]>[1];
  /** Holds back the second page of the channel listing until released. */
  gate?: Promise<void>;
} & Parameters<typeof startAppHarness>[0] = {}) {
  const [joined] = await loadFixture("conversations-join");

  app = await startAppHarness({
    rows: 30,
    ...options,
    prepare: async (slack) => {
      slack.respondPaged(
        "conversations.list",
        await loadFixture("conversations-list-public"),
      );

      if (gate) {
        const paged = slack.handler("conversations.list");

        slack.respond("conversations.list", async (call) => {
          if (call.params.cursor) {
            await gate;
          }

          return paged(call);
        });
      }

      slack.grantScopes(scopes);
      slack.respond("conversations.join", join ?? (() => joined!));
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [],
        has_more: false,
      }));
    },
  });
  await app.waitForScreen("@Peter Venkman");
  await waitFor(() => app.session.currentUserId);
}

const statusBar = () => app.screen().trimEnd().split("\n").at(-1)!;
const switcherIsOpen = () => app.screen().includes("Switch conversation");
const switcherTitle = () =>
  app
    .screen()
    .split("\n")
    .find((line) => line.includes("Switch conversation")) ?? "";

const results = (): string[] =>
  (findPopup(app.screen(), "Switch conversation")?.rows ?? [])
    .slice(1)
    .map((line) => line.replace(/^\s*(› )?/, "").trimEnd())
    .filter(Boolean);

const sidebarRows = () =>
  readSidebarRows(app.screen()).map((line) => line.trim());

async function type(text: string) {
  for (const character of text) {
    await app.press(character);
  }
}

const calls = (method: string) =>
  app.slack.calls.filter((call) => call.method === method);

async function pickDesign() {
  await app.press(keys.ctrlK);
  await waitFor(() => app.session.conversation(design));
  await type("design");
  await app.press(keys.enter);
}

test("the public channels aren't listed until the switcher first opens, and then only once", async () => {
  await start();

  expect(calls("conversations.list")).toHaveLength(0);

  await app.press(keys.ctrlK);
  await waitFor(() => app.session.publicChannelsStatus() === "loaded");
  await app.press(keys.escape);
  await app.press(keys.ctrlK);

  expect(calls("conversations.list")).toHaveLength(2);
});

test("public channels the user isn't in are listed with a note and their member count, after the ones they are in", async () => {
  await start();
  await app.press(keys.ctrlK);
  await waitFor(() => app.session.publicChannelsStatus() === "loaded");
  await type("e");

  const rows = results();

  expect(rows).toContain("#design not a member · 8 members");
  expect(rows).toContain("#devops not a member · 54 members");
  expect(rows.indexOf("#general")).toBeLessThan(
    rows.indexOf("#design not a member · 8 members"),
  );
  expect(rows.indexOf("#random")).toBeLessThan(
    rows.indexOf("#devops not a member · 54 members"),
  );
});

test("while the listing is still loading the switcher shows what is loaded so far and says it is loading", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));

  await start({ gate });
  await app.press(keys.ctrlK);
  await waitFor(() => app.session.conversation(design));
  await type("dev");

  expect(switcherTitle()).toContain("still loading channels");
  expect(results()).toEqual([]);

  release();
  await waitFor(() => !switcherTitle().includes("still loading channels"));

  expect(results()).toEqual(["#devops not a member · 54 members"]);
});

test("picking one asks 'Join #name? y/n' in the status bar without calling Slack", async () => {
  await start();

  await pickDesign();

  expect(switcherIsOpen()).toBe(false);
  expect(statusBar()).toContain("Join #design? y/n");
  expect(calls("conversations.join")).toHaveLength(0);
  expect(sidebarRows().some((row) => row.includes("#design"))).toBe(false);
});

test("y joins with conversations.join, adds the channel to the Channels section once and opens it", async () => {
  await start();

  await pickDesign();
  await app.press("y");
  await app.waitForScreen("›▌ #design");

  expect(calls("conversations.join").map((call) => call.params)).toEqual([
    { channel: design },
  ]);
  expect(statusBar()).not.toContain("Join #design");
  expect(statusBar()).toContain("j/k select");
  expect(sidebarRows().filter((row) => row.includes("#design"))).toHaveLength(
    1,
  );
  await waitFor(() =>
    calls("conversations.history").some(
      (call) => call.params.channel === design,
    ),
  );

  const lines = sidebarRows();

  expect(lines.indexOf("▾ Channels")).toBeGreaterThan(-1);
  expect(lines.findIndex((row) => row.includes("#design"))).toBeGreaterThan(
    lines.indexOf("▾ Channels"),
  );
  expect(lines.findIndex((row) => row.includes("#design"))).toBeLessThan(
    lines.findIndex((row) => row.includes("Direct messages")),
  );
});

test("the member_joined_channel echo doesn't add the channel to the sidebar twice", async () => {
  await start();

  await pickDesign();
  await app.press("y");
  await app.waitForScreen("›▌ #design");

  const payload = await loadPayload("member-joined-channel");

  await app.sendEvents({
    ...payload,
    event: { ...payload.event, channel: design },
  });

  expect(sidebarRows().filter((row) => row.includes("#design"))).toHaveLength(
    1,
  );
});

test("a channel a section names goes in that section", async () => {
  await start({ sections: [{ name: "Product", channels: ["#design"] }] });

  await pickDesign();
  await app.press("y");
  await app.waitForScreen("›▌ #design");

  const lines = sidebarRows();
  const section = lines.indexOf("▾ Product");

  expect(section).toBeGreaterThan(-1);
  expect(lines[section + 1]).toContain("#design");
  expect(lines.filter((row) => row.includes("#design"))).toHaveLength(1);
});

test.each([
  ["n", "n"],
  ["Esc", keys.escape],
  ["Enter", keys.enter],
  ["Ctrl+K", keys.ctrlK],
])("%s cancels: no call, nothing joined", async (_name, key) => {
  await start();

  await pickDesign();
  await app.press(key);

  expect(statusBar()).not.toContain("Join #design");
  expect(switcherIsOpen()).toBe(false);
  expect(calls("conversations.join")).toHaveLength(0);
  expect(app.session.conversation(design)?.isMember).toBe(false);
  expect(sidebarRows().some((row) => row.includes("#design"))).toBe(false);
});

test("without channels:write picking a channel explains in the status bar and asks nothing", async () => {
  await start({ scopes: ["identify", "channels:read"] });

  await pickDesign();

  expect(statusBar()).toContain("Joining channels is off");
  expect(statusBar()).toContain("channels:write");
  expect(statusBar()).not.toContain("y/n");

  await app.press("y");

  expect(calls("conversations.join")).toHaveLength(0);
});

test.each([
  ["is_archived", "archived"],
  ["method_not_supported_for_channel_type", "kind of channel"],
  ["missing_scope", "channels:write"],
])(
  "Slack refusing with %s shows the reason and changes nothing",
  async (error, words) => {
    await start({ join: () => ({ ok: false, error }) });

    await pickDesign();

    const before = app.session.conversations();

    await app.press("y");
    await waitFor(() => calls("conversations.join").length === 1);
    await app.waitForScreen(words);

    expect(statusBar()).toContain(words);
    expect(app.session.conversations()).toEqual(before);
    expect(app.session.conversation(design)?.isMember).toBe(false);
    expect(sidebarRows().some((row) => row.includes("#design"))).toBe(false);
  },
);

test("a slow join doesn't switch away from a conversation opened meanwhile, but the channel still lands in the sidebar", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const [joined] = await loadFixture("conversations-join");

  await start({
    join: async () => {
      await gate;

      return joined!;
    },
  });

  await pickDesign();
  await app.press("y");
  await waitFor(() => calls("conversations.join").length === 1);
  await app.press(keys.enter);
  await app.waitForScreen("›▌ #general");

  release();
  await waitFor(() => app.session.conversation(design)?.isMember === true);
  await waitFor(() => sidebarRows().some((row) => row.includes("#design")));

  expect(app.screen()).toContain("›▌ #general");
  expect(app.screen()).not.toContain("▌ #design");
  expect(
    calls("conversations.history").some(
      (call) => call.params.channel === design,
    ),
  ).toBe(false);
});
