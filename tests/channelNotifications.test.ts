import { afterEach, expect, test } from "bun:test";
import type { NotificationLevelMemory } from "../src/config/state";
import type { NotificationLevel } from "../src/session/notificationLevels";
import { type AppHarness, startAppHarness } from "./support/appHarness";
import { sidebarRows as readSidebarRows } from "./support/panes";
import { waitFor } from "./support/fakeSlack";
import { type FakeClock, fakeClock } from "./support/fakeClock";
import { loadFixture, loadPayload } from "./support/fixtures";

let app: AppHarness;
let clock: FakeClock;

afterEach(() => app.stop());

const me = "U123ABC456";
const other = "U222222222";
const general = "C012AB3CD";
const random = "C061EG9T2";
const directMessage = "D0C0F7S8Y";
const sidebarWidth = 32;

type Levels = Record<string, Exclude<NotificationLevel, "mentions">>;

/** A notification level memory that keeps what it is told, as the state file would. */
function fakeLevelMemory(initial: Levels = {}) {
  const writes: Levels[] = [];
  const memory: NotificationLevelMemory = {
    recall: async () => initial,
    remember: (levels) => writes.push(levels),
    flush: async () => undefined,
  };

  return { memory, writes };
}

async function start(
  options: Parameters<typeof startAppHarness>[0] = {},
  waitForLevels: Levels = {},
) {
  clock = fakeClock();
  app = await startAppHarness({
    columns: 120,
    rows: 30,
    clock,
    prepare: (slack) => {
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [],
        has_more: false,
      }));
    },
    ...options,
  });
  await app.waitForScreen("@Peter Venkman");
  await waitFor(() => app.session.currentUserId);

  for (const [id, level] of Object.entries(waitForLevels)) {
    await waitFor(() => app.session.notificationLevel(id) === level);
  }
}

let counter = 0;

function say(
  channel: string,
  overrides: Record<string, unknown> = {},
  channelType = "channel",
) {
  counter += 1;

  return app.sendEvents({
    event: {
      type: "message",
      channel,
      channel_type: channelType,
      user: other,
      text: "hello there",
      ts: `1700000000.${String(counter).padStart(6, "0")}`,
      ...overrides,
    },
  });
}

const mentionMe = { text: `hey <@${me}>` };

/** Lets the gathering window end, so what was waiting is sent. */
const flush = () => clock.advance(1000);

const sidebarRows = () =>
  readSidebarRows(app.screen(), sidebarWidth).map((line) => line.trim());
const rowOf = (name: string) =>
  sidebarRows().findIndex((row) => row.includes(name));

async function selectRow(name: string) {
  while (
    !sidebarRows()
      .find((row) => row.startsWith("›"))
      ?.includes(name)
  ) {
    const selected = sidebarRows().findIndex((row) => row.startsWith("›"));

    await app.press(selected < rowOf(name) ? "j" : "k");
  }
}

test("by default a channel notifies for mentions, @channel and @here, not for every message", async () => {
  await start();

  expect(app.session.notificationLevel(general)).toBe("mentions");

  await say(general);
  flush();

  expect(app.notifications).toEqual([]);

  await say(general, mentionMe);
  flush();
  await say(general, { text: "<!here> look" });
  clock.advance(5000);

  expect(app.notifications).toHaveLength(2);
});

test("the channel menu's Notifications list shows the level and changes it at once", async () => {
  await start();

  await app.press("m");
  expect(app.screen()).toContain("n Notifications…");
  await app.press("n");

  expect(app.screen()).toContain("m ✓ Mentions only");
  expect(app.screen()).toContain("a   All messages");
  expect(app.screen()).toContain("o   Off");

  await app.press("a");

  expect(app.session.notificationLevel(general)).toBe("all");

  await app.press("m");
  await app.press("n");

  expect(app.screen()).toContain("a ✓ All messages");
});

test("a channel set to all messages notifies for every new message, held by the same interval", async () => {
  await start({ notificationIntervalMs: 5000 });
  app.session.setNotificationLevel(random, "all");

  await say(random, { text: "first" });
  flush();

  expect(app.notifications).toHaveLength(1);

  await say(random, { text: "second" });
  await say(random, { text: "third" });
  flush();

  expect(app.notifications).toHaveLength(1);

  clock.advance(3999);

  expect(app.notifications).toHaveLength(1);

  clock.advance(1);

  expect(app.notifications).toHaveLength(2);
  expect(app.notifications[1]).toMatchObject({ count: 2, isBurst: true });
});

test("all messages leaves out thread replies, edits and joins, as the unread marker does", async () => {
  await start();
  app.session.setNotificationLevel(random, "all");

  await say(random, { thread_ts: "1700000000.000001", text: "a reply" });
  await say(random, { subtype: "channel_join", text: "joined" });
  flush();

  expect(app.notifications).toEqual([]);
});

test("all messages doesn't notify while the terminal has the focus", async () => {
  await start();
  app.session.setNotificationLevel(random, "all");
  app.session.setTerminalFocused(true);

  await say(random);
  flush();

  expect(app.notifications).toEqual([]);
});

test("a channel set to off never notifies, mentions included; DMs and other channels still do", async () => {
  await start();
  app.session.setNotificationLevel(general, "off");

  await say(general, mentionMe);
  await say(general, { text: "<!channel> look" });
  flush();

  expect(app.notifications).toEqual([]);

  await say(random, mentionMe);
  await say(directMessage, {}, "im");
  flush();

  expect(app.notifications).toHaveLength(1);
  expect(app.notifications[0]!.count).toBe(2);
});

test("a muted channel stays quiet even when set to all messages", async () => {
  await start();
  app.session.setNotificationLevel(general, "all");
  app.session.setMuted(general, true);

  await say(general);
  await say(general, mentionMe);
  flush();

  expect(app.notifications).toEqual([]);
});

test("levels are remembered, mentions only by leaving the channel out, and an earlier run's are loaded", async () => {
  const { memory, writes } = fakeLevelMemory();

  await start({ notificationLevelMemory: memory });

  app.session.setNotificationLevel(general, "all");
  app.session.setNotificationLevel(random, "off");
  app.session.setNotificationLevel(random, "off");
  app.session.setNotificationLevel(general, "mentions");

  expect(writes).toEqual([
    { [general]: "all" },
    { [general]: "all", [random]: "off" },
    { [random]: "off" },
  ]);

  await app.stop();
  await start(
    { notificationLevelMemory: fakeLevelMemory({ [general]: "all" }).memory },
    { [general]: "all" },
  );

  expect(app.session.notificationLevel(random)).toBe("mentions");
});

test("choosing from the menu is remembered", async () => {
  const { memory, writes } = fakeLevelMemory();

  await start({ notificationLevelMemory: memory });
  await selectRow("#random");
  await app.press("m");
  await app.press("n");
  await app.press("o");

  expect(writes).toEqual([{ [random]: "off" }]);
});

test("leaving a channel forgets its level, here and from another device", async () => {
  const { memory, writes } = fakeLevelMemory({
    [general]: "all",
    [random]: "off",
  });

  await start(
    { notificationLevelMemory: memory },
    { [general]: "all", [random]: "off" },
  );
  await app.session.leaveChannel(random);

  expect(app.session.notificationLevel(random)).toBe("mentions");
  expect(writes.at(-1)).toEqual({ [general]: "all" });

  await app.sendEvents(await loadPayload("channel-left"));

  expect(app.session.notificationLevel(general)).toBe("mentions");
  expect(writes.at(-1)).toEqual({});
});

test("channel details say what the channel notifies for", async () => {
  const [info] = await loadFixture("conversations-info-channel");

  await start(
    {
      notificationLevelMemory: fakeLevelMemory({ [general]: "all" }).memory,
      prepare: (slack) => {
        slack.respond("conversations.history", () => ({
          ok: true,
          messages: [],
          has_more: false,
        }));
        slack.respond("conversations.info", () => info!);
        slack.grantScopes(["identify", "channels:read"]);
      },
    },
    { [general]: "all" },
  );

  await app.press("m");
  await app.press("d");
  await app.waitForScreen("#general details");

  expect(app.screen()).toMatch(/Notify\s+All messages/);
});
