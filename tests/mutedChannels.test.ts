import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import chalk from "chalk";
import type { MuteMemory } from "../src/config/state";
import {
  aggregateMarkers,
  sidebarGroups,
  sidebarLines,
} from "../src/ui/app/sidebarEntries";
import { switcherCandidates } from "../src/ui/app/switcherCandidates";
import { theme } from "../src/ui/theme";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import { sidebarRows as readSidebarRows } from "./support/panes";
import { waitFor } from "./support/fakeSlack";
import { type FakeClock, fakeClock } from "./support/fakeClock";
import { loadFixture, loadPayload } from "./support/fixtures";

let app: AppHarness;
let colourLevel: typeof chalk.level;
let clock: FakeClock;

beforeAll(() => {
  colourLevel = chalk.level;
  chalk.level = 3;
});

afterAll(() => {
  chalk.level = colourLevel;
});

afterEach(() => app.stop());

const me = "U123ABC456";
const other = "U222222222";
const general = "C012AB3CD";
const random = "C061EG9T2";
const sidebarWidth = 32;

/** A mute memory that keeps what it is told, as the state file would. */
function fakeMuteMemory(initial: string[] = []) {
  const writes: string[][] = [];
  const memory: MuteMemory = {
    recall: async () => initial,
    remember: (ids) => writes.push(ids),
    flush: async () => undefined,
  };

  return { memory, writes };
}

async function start(
  options: Parameters<typeof startAppHarness>[0] = {},
  waitForMuted: string[] = [],
) {
  clock = fakeClock();
  app = await startAppHarness({
    columns: 120,
    rows: 30,
    clock,
    prepare: (slack) => {
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [
          {
            type: "message",
            user: other,
            text: "earlier",
            ts: "1600000000.000001",
          },
        ],
        has_more: false,
      }));
    },
    ...options,
  });
  await app.waitForScreen("@Peter Venkman");
  await waitFor(() => app.session.currentUserId);

  for (const id of waitForMuted) {
    await waitFor(() => app.session.isMuted(id));
  }
}

let counter = 0;

function say(channel: string, overrides: Record<string, unknown> = {}) {
  counter += 1;

  return app.sendEvents({
    event: {
      type: "message",
      channel,
      channel_type: "channel",
      user: other,
      text: "hello there",
      ts: `1700000000.${String(counter).padStart(6, "0")}`,
      ...overrides,
    },
  });
}

const sidebarRows = () =>
  readSidebarRows(app.screen(), sidebarWidth).map((line) => line.trim());
const rowOf = (name: string) =>
  sidebarRows().findIndex((row) => row.includes(name));
const colouredRow = (name: string) => app.coloredScreen()[rowOf(name) + 1]!;
const foreground = (colour: string) => {
  const [red, green, blue] = [1, 3, 5].map((at) =>
    Number.parseInt(colour.slice(at, at + 2), 16),
  );

  return `\u001b[38;2;${red};${green};${blue}m`;
};
const bold = "\u001b[1m";

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

/** Chooses the menu item with `letter` for the channel named `name`. */
async function fromMenu(name: string, letter: string) {
  await selectRow(name);
  await app.press("m");
  await app.press(letter);
}

test("the menu offers Mute channel, and choosing it mutes at once; it then offers Unmute channel", async () => {
  await start();

  await app.press("m");
  expect(app.screen()).toContain("m Mute channel");
  await app.press("m");

  expect(app.session.isMuted(general)).toBe(true);
  expect(app.screen()).not.toContain("m Mute channel");

  await app.press("m");
  expect(app.screen()).toContain("m Unmute channel");
  await app.press("m");

  expect(app.session.isMuted(general)).toBe(false);
});

test("muting and unmuting are remembered, and an earlier run's mutes are loaded", async () => {
  const { memory, writes } = fakeMuteMemory();

  await start({ muteMemory: memory });
  await fromMenu("#general", "m");
  await fromMenu("#random", "m");
  await fromMenu("#general", "m");

  expect(writes).toEqual([[general], [general, random], [random]]);

  await app.stop();
  await start({ muteMemory: fakeMuteMemory([random]).memory }, [random]);

  expect(app.session.isMuted(general)).toBe(false);
});

test("a muted channel never notifies, mentions included; others still do", async () => {
  await start({ muteMemory: fakeMuteMemory([general]).memory }, [general]);

  await say(general, { text: `hey <@${me}>` });
  await say(general, { text: "<!channel> look" });
  clock.advance(1000);

  expect(app.notifications).toEqual([]);

  await say(random, { text: `hey <@${me}>` });
  clock.advance(1000);

  expect(app.notifications).toHaveLength(1);
  expect(app.notifications[0]!.newest.conversationId).toBe(random);
});

test("muting takes effect without a restart, and unmuting lets mentions notify again", async () => {
  await start();

  app.session.setMuted(general, true);
  await say(general, { text: `hey <@${me}>` });
  clock.advance(1000);
  expect(app.notifications).toEqual([]);

  app.session.setMuted(general, false);
  await say(general, { text: `hey <@${me}>` });
  clock.advance(1000);
  expect(app.notifications).toHaveLength(1);
});

test("a muted channel is dimmed, and not bold when unread; an unmuted unread one is bold", async () => {
  await start({ muteMemory: fakeMuteMemory([general]).memory }, [general]);
  await selectRow("@stantz");

  await say(general);
  await say(random);
  await waitFor(() => app.session.markers(random).isUnread);

  const muted = colouredRow("#general");
  const loud = colouredRow("#random");

  expect(muted).toContain(foreground(theme.mutedChannelText));
  expect(muted).not.toContain(bold);
  expect(loud).toContain(bold);
  expect(loud).toContain(foreground(theme.brightText));
});

test("a muted channel with a mention still shows its badge, but its name stays dim", async () => {
  await start({ muteMemory: fakeMuteMemory([general]).memory }, [general]);
  await selectRow("@stantz");

  await say(general, { text: `hey <@${me}>` });
  await waitFor(() => app.session.markers(general).mentions === 1);

  const row = colouredRow("#general");

  expect(Bun.stripANSI(row).slice(0, sidebarWidth)).toMatch(/#general\s+1/);
  expect(row).toContain(foreground(theme.mutedChannelText));
  expect(row.split(bold)[0]).not.toContain(foreground(theme.brightText));
});

test("a muted channel's unread doesn't make a collapsed heading loud, but its mentions still count", async () => {
  await start({ muteMemory: fakeMuteMemory([general, random]).memory }, [
    general,
    random,
  ]);

  await say(general);
  await say(random, { text: `hey <@${me}>` });
  await waitFor(() => app.session.markers(random).mentions === 1);

  const groups = sidebarGroups(app.session);

  expect(aggregateMarkers(groups.channels)).toEqual({
    isUnread: false,
    mentions: 1,
  });

  const heading = sidebarLines(groups, {
    recentLimit: 10,
    showAll: false,
    collapsed: new Set(["channels"]),
  }).find((line) => line.kind === "heading" && line.id === "channels");

  expect(heading).toMatchObject({ markers: { isUnread: false, mentions: 1 } });
});

test("the quick switcher marks a muted channel and still finds it", async () => {
  await start({ muteMemory: fakeMuteMemory([general]).memory }, [general]);

  await app.press(keys.ctrlK);

  for (const character of "gener") {
    await app.press(character);
  }

  expect(app.screen()).toContain("#general muted");

  const candidate = switcherCandidates(app.session).find(
    ({ id }) => id === general,
  );

  expect(candidate).toMatchObject({ muted: true, note: "muted" });
});

test("channel details say whether the channel is muted", async () => {
  const [info] = await loadFixture("conversations-info-channel");

  await start(
    {
      muteMemory: fakeMuteMemory([general]).memory,
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
    [general],
  );

  await app.press("m");
  await app.press("d");
  await app.waitForScreen("#general details");

  expect(app.screen()).toMatch(/Muted\s+yes/);
});

test("leaving a channel forgets that it was muted, here and from another device", async () => {
  const { memory, writes } = fakeMuteMemory([general, random]);

  await start({ muteMemory: memory }, [general, random]);
  await app.session.leaveChannel(random);

  expect(app.session.isMuted(random)).toBe(false);
  expect(writes.at(-1)).toEqual([general]);

  await app.sendEvents(await loadPayload("channel-left"));

  expect(app.session.isMuted(general)).toBe(false);
  expect(writes.at(-1)).toEqual([]);
});
