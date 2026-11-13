import { afterEach, expect, test } from "bun:test";
import type { ConversationMemory } from "../src/config/state";
import { loadFixture, loadPayload } from "./support/fixtures";
import { waitFor, type FakeSlack } from "./support/fakeSlack";
import { shortcuts } from "../src/ui/app/shortcuts";
import { findPopup } from "./support/popup";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";

let app: AppHarness;

afterEach(() => app.stop());

const general = "C012AB3CD";
const random = "C061EG9T2";
const secret = "G012AB3CD";

const everyScope = [
  "identify",
  "channels:read",
  "channels:write",
  "groups:write",
];

async function start({
  scopes,
  leave,
  conversationMemory,
  ...options
}: {
  scopes?: string[];
  leave?: Parameters<FakeSlack["respond"]>[1];
} & Parameters<typeof startAppHarness>[0] = {}) {
  const [info] = await loadFixture("conversations-info-private");
  const [channels, directs] = [
    ...(await loadFixture("users-conversations-channels")),
    ...(await loadFixture("users-conversations-dms")),
  ];

  app = await startAppHarness({
    rows: 30,
    columns: 120,
    conversationMemory,
    ...options,
    prepare: async (slack) => {
      slack.respondPaged("users.conversations", [
        {
          ...channels!,
          channels: [...channels!.channels, info!.channel],
        },
        directs!,
      ]);
      slack.respondPaged(
        "conversations.list",
        await loadFixture("conversations-list-public"),
      );
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [
          {
            type: "message",
            user: "U222222222",
            text: "earlier",
            ts: "1600000000.000001",
          },
        ],
        has_more: false,
      }));

      if (scopes) {
        slack.grantScopes(scopes);
      }

      if (leave) {
        slack.respond("conversations.leave", leave);
      }
    },
  });
  await app.waitForScreen("#secret");
  await app.waitForScreen("@Peter Venkman");
  await waitFor(() => app.session.currentUserId);
}

const statusBar = () => app.screen().trimEnd().split("\n").at(-1)!;

const sidebarRows = () =>
  app
    .screen()
    .split("\n")
    .map((line) => line.slice(0, 32).trim());

const inSidebar = (name: string) =>
  sidebarRows().some((row) => row.includes(name));

const selectedRow = () => sidebarRows().find((row) => row.startsWith("›"));

const calls = () =>
  app.slack.calls.filter((call) => call.method === "conversations.leave");

/** A memory that records what it was asked to remember. */
function fakeMemory(initial?: string) {
  const writes: (string | undefined)[] = [];
  let stored = initial;

  const memory: ConversationMemory = {
    recall: async () => stored,
    remember(id) {
      stored = id;
      writes.push(id);
    },
    flush: async () => {},
  };

  return { memory, writes };
}

test("x on a channel asks 'Leave #name? y/n' in the status bar without calling Slack", async () => {
  await start();

  await app.press("x");

  expect(statusBar()).toContain("Leave #general? y/n");
  expect(statusBar()).not.toContain("rejoin");
  expect(calls()).toHaveLength(0);
});

test("y leaves with conversations.leave and the channel goes from the sidebar, selection moving to the next entry", async () => {
  await start({ scopes: everyScope });

  await app.press("x");
  await app.press("y");
  await waitFor(() => !inSidebar("#general"));

  expect(calls().map((call) => call.params)).toEqual([{ channel: general }]);
  expect(statusBar()).not.toContain("Leave #general");
  expect(selectedRow()).toContain("#random");
  expect(inSidebar("#random")).toBe(true);
});

test("leaving the last channel moves the selection to whatever follows it", async () => {
  await start();

  await app.press("j");
  await app.press("j");
  expect(selectedRow()).toContain("#secret");

  await app.press("x");
  await app.press("y");
  await waitFor(() => !inSidebar("#secret"));

  expect(selectedRow()).toContain("Direct messages");
});

test("a private channel's confirmation says it can't be rejoined without an invite", async () => {
  await start({ scopes: everyScope });

  await app.press("j");
  await app.press("j");
  await app.press("x");

  expect(statusBar()).toContain("Leave #secret?");
  expect(statusBar()).toContain("can't rejoin without an invite");

  await app.press("y");
  await waitFor(() => !inSidebar("#secret"));

  expect(calls().map((call) => call.params)).toEqual([{ channel: secret }]);
});

test.each([
  ["n", "n"],
  ["Esc", keys.escape],
  ["Enter", keys.enter],
  ["x", "x"],
])("%s cancels: no call, the channel stays", async (_name, key) => {
  await start();

  await app.press("x");
  await app.press(key);

  expect(statusBar()).not.toContain("Leave #general");
  expect(calls()).toHaveLength(0);
  expect(app.session.conversation(general)?.isMember).toBe(true);
  expect(inSidebar("#general")).toBe(true);
});

test("the key that cancels is used up", async () => {
  await start();

  await app.press("x");
  await app.press("j");

  expect(selectedRow()).toContain("#general");
});

test("x on a DM or group DM does nothing but say only channels can be left", async () => {
  await start();

  for (const name of ["@Peter Venkman", "@stantz"]) {
    while (!selectedRow()?.includes(name)) {
      await app.press("j");
    }

    await app.press("x");

    expect(statusBar()).toContain("Only channels can be left");
    expect(statusBar()).not.toContain("y/n");

    await app.press("y");
  }

  expect(calls()).toHaveLength(0);
});

test("x on a section heading does nothing", async () => {
  await start();

  await app.press("k");
  expect(selectedRow()).toContain("Channels");

  await app.press("x");

  expect(statusBar()).not.toContain("y/n");
  expect(calls()).toHaveLength(0);
});

test("leaving the open conversation closes the panes and drops its draft and memory", async () => {
  const { memory, writes } = fakeMemory();

  await start({ conversationMemory: memory });
  await app.press(keys.enter);
  await app.waitForScreen("earlier");
  await app.press("i");
  await app.press("unsent words");
  await app.press(keys.tab);
  await app.press("x");
  await app.press("y");
  await app.waitForScreen("No conversation open");

  expect(inSidebar("#general")).toBe(false);
  expect(app.screen()).not.toContain("earlier");
  expect(app.screen()).not.toContain("unsent words");
  expect(writes.at(-1)).toBeUndefined();
  expect(writes).toContain(general);
  expect(selectedRow()).toContain("#random");

  await app.sendEvents({
    ...(await loadPayload("member-joined-channel")),
  });
  await waitFor(() => inSidebar("#general"));
  await app.press("k");
  await app.press(keys.enter);
  await app.waitForScreen("earlier");
  await app.press("i");

  expect(app.screen()).not.toContain("unsent words");
});

test("leaving a channel that isn't open leaves the open one alone", async () => {
  await start();

  await app.press(keys.enter);
  await app.waitForScreen("earlier");
  await app.press("j");
  await app.press("x");
  await app.press("y");
  await waitFor(() => !inSidebar("#random"));

  expect(app.screen()).toContain("earlier");
  expect(inSidebar("#general")).toBe(true);
});

test("a left public channel is a 'not a member' result in the switcher once the listing is loaded", async () => {
  await start();

  await app.press("j");
  await app.press("x");
  await app.press("y");
  await waitFor(() => !inSidebar("#random"));
  await app.press(keys.ctrlK);
  await waitFor(() => app.session.publicChannelsStatus() === "loaded");

  for (const character of "random") {
    await app.press(character);
  }

  const rows = (findPopup(app.screen(), "Switch conversation")?.rows ?? [])
    .slice(2)
    .map((line) => line.replace(/^\s*(› )?/, "").trimEnd());

  expect(rows.some((row) => row.startsWith("#random not a member"))).toBe(true);
});

test("channel_left, group_left and the user's own member_left_channel remove the channel, and the open one closes", async () => {
  await start();

  await app.press(keys.enter);
  await app.waitForScreen("earlier");

  await app.sendEvents(await loadPayload("channel-left"));
  await app.waitForScreen("No conversation open");

  expect(inSidebar("#general")).toBe(false);

  await app.sendEvents(await loadPayload("group-left"));
  await waitFor(() => !inSidebar("#secret"));

  const left = await loadPayload("member-left-channel");

  await app.sendEvents({ ...left, event: { ...left.event, channel: random } });
  await waitFor(() => !inSidebar("#random"));
  expect(calls()).toHaveLength(0);
});

test("someone else leaving a channel doesn't remove it", async () => {
  await start();

  const left = await loadPayload("member-left-channel");

  await app.sendEvents({
    ...left,
    event: { ...left.event, user: "U999999999" },
  });

  expect(inSidebar("#general")).toBe(true);
});

test("the channel_left echo after leaving here is harmless", async () => {
  await start();

  await app.press("x");
  await app.press("y");
  await waitFor(() => !inSidebar("#general"));
  await app.sendEvents(await loadPayload("channel-left"));

  expect(inSidebar("#random")).toBe(true);
  expect(selectedRow()).toContain("#random");
});

test("without channels:write x explains up front, asks nothing and calls nothing", async () => {
  await start({ scopes: ["identify", "channels:read", "groups:write"] });

  await app.press("x");

  expect(statusBar()).toContain("Leaving channels is off");
  expect(statusBar()).toContain("channels:write");
  expect(statusBar()).not.toContain("y/n");

  await app.press("y");

  expect(calls()).toHaveLength(0);
  expect(inSidebar("#general")).toBe(true);
});

test("without groups:write a private channel can't be left but a public one can", async () => {
  await start({ scopes: ["identify", "channels:read", "channels:write"] });

  await app.press("j");
  await app.press("j");
  await app.press("x");

  expect(statusBar()).toContain("groups:write");
  expect(statusBar()).not.toContain("y/n");

  await app.press("k");
  await app.press("k");
  await app.press("x");

  expect(statusBar()).toContain("Leave #general? y/n");
});

test.each([
  ["cant_leave_general", "can't be left"],
  ["last_member", "last member"],
  ["missing_scope", "channels:write"],
])(
  "Slack refusing with %s shows the reason and keeps the channel",
  async (error, words) => {
    await start({ leave: () => ({ ok: false, error }) });

    await app.press("x");
    await app.press("y");
    await waitFor(() => calls().length === 1);
    await app.waitForScreen(words);

    expect(statusBar()).toContain(words);
    expect(app.session.conversation(general)?.isMember).toBe(true);
    expect(inSidebar("#general")).toBe(true);
  },
);

test("the help lists x", async () => {
  await start({ rows: 200, columns: 300 });
  await app.press("?");

  const leave = shortcuts.filter(({ id }) =>
    ["sidebar.leave", "leave.confirm"].includes(id),
  );

  expect(leave.map(({ keys }) => keys)).toEqual([["x"], ["y"]]);

  for (const shortcut of leave) {
    expect(app.screen()).toContain(shortcut.description);
  }
});
