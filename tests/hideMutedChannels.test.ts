import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import chalk from "chalk";
import type { HideMutedMemory, MuteMemory } from "../src/config/state";
import {
  type SidebarEntry,
  type SidebarGroups,
  lineKey,
  sidebarLineAt,
  sidebarLines,
} from "../src/ui/app/sidebarEntries";
import { shortcuts } from "../src/ui/app/shortcuts";
import { sidebarKeyHints } from "../src/ui/app/statusLine";
import { theme } from "../src/ui/theme";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import {
  sidebarRows as readSidebarRows,
  sidebarStatus,
  statusLine,
} from "./support/panes";
import { waitFor } from "./support/fakeSlack";

let app: AppHarness;
let colourLevel: typeof chalk.level;

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

/** A hide-muted memory that keeps its value and records every write. */
function fakeHideMemory(initial = false) {
  const writes: boolean[] = [];
  let stored = initial;
  const memory: HideMutedMemory = {
    recall: async () => stored,
    remember(hidden) {
      stored = hidden;
      writes.push(hidden);
    },
    flush: async () => undefined,
  };

  return { memory, writes };
}

const muteMemory = (initial: string[]): MuteMemory => ({
  recall: async () => initial,
  remember: () => undefined,
  flush: async () => undefined,
});

async function start(options: Parameters<typeof startAppHarness>[0] = {}) {
  app = await startAppHarness({
    columns: 120,
    rows: 30,
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
  await waitFor(() => app.session.isMuted(general) || !options.muteMemory);
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
/** The screen row a sidebar row is drawn on: one below the box's top border. */
const screenRowOf = (name: string) => rowOf(name) + 1;
const isListed = (name: string) => rowOf(name) !== -1;
const selectedRow = () => sidebarRows().find((row) => row.startsWith("›"));
const statusLineText = () => statusLine(app.screen());

async function selectRow(name: string) {
  const selectedIndex = () =>
    sidebarRows().findIndex((row) => row.startsWith("›"));

  while (!selectedRow()?.includes(name)) {
    await app.press(selectedIndex() < rowOf(name) ? "j" : "k");
  }
}

describe("hiding muted channels from the keyboard", () => {
  test("muted channels show by default; M hides them, and M again shows them", async () => {
    await start({ muteMemory: muteMemory([general]) });

    expect(isListed("#general")).toBe(true);

    await app.press("M");
    expect(isListed("#general")).toBe(false);
    expect(isListed("#random")).toBe(true);

    await app.press("M");
    expect(isListed("#general")).toBe(true);
  });

  test("a lowercase m still opens the channel menu, not the toggle", async () => {
    await start({ muteMemory: muteMemory([general]) });

    await app.press("m");

    expect(app.screen()).toContain("Leave channel");
    expect(isListed("#general")).toBe(true);
  });

  test("the choice is remembered and an earlier run's choice is loaded", async () => {
    const { memory, writes } = fakeHideMemory();

    await start({ muteMemory: muteMemory([general]), hideMutedMemory: memory });
    await app.press("M");
    await app.press("M");
    await app.press("M");

    expect(writes).toEqual([true, false, true]);

    await app.stop();
    await start({
      muteMemory: muteMemory([general]),
      hideMutedMemory: fakeHideMemory(true).memory,
    });
    await waitFor(() => !isListed("#general"));

    expect(isListed("#random")).toBe(true);
  });

  test("the sidebar hints name the key, and the sidebar's border says 'muted hidden' while they are hidden", async () => {
    await start({ muteMemory: muteMemory([general]) });

    expect(sidebarKeyHints(false)).toContain("M hide muted");
    expect(statusLineText()).toContain("M hide muted");
    expect(sidebarStatus(app.screen())).not.toContain("muted hidden");

    await app.press("M");

    expect(sidebarKeyHints(true)).toContain("M show muted");
    expect(statusLineText()).toContain("M show muted");
    expect(sidebarStatus(app.screen())).toContain("muted hidden");
  });

  test("Help lists M under the sidebar keys", () => {
    expect(shortcuts).toContainEqual(
      expect.objectContaining({
        id: "sidebar.hideMuted",
        group: "sidebar",
        keys: ["M"],
      }),
    );
  });

  test("up and down skip hidden channels, and the selection moves off a channel that gets hidden", async () => {
    await start({ muteMemory: muteMemory([general]) });
    await app.press("M");

    await selectRow("#random");
    await app.press("k");

    expect(selectedRow()).toContain("Channels");

    await app.press("j");
    expect(selectedRow()).toContain("#random");
  });

  test("selecting a muted channel and hiding moves the selection to a listed row", async () => {
    await start({ muteMemory: muteMemory([general]) });
    await selectRow("#general");
    await app.press("M");

    expect(selectedRow()).toBeDefined();
    expect(selectedRow()).not.toContain("#general");
  });
});

describe("what still shows while muted channels are hidden", () => {
  test("a muted channel with an unread mention shows until it is read, then disappears again", async () => {
    await start({ muteMemory: muteMemory([general]) });
    await selectRow("@stantz");
    await app.press("M");
    expect(isListed("#general")).toBe(false);

    await say(general, { text: `hey <@${me}>` });
    await waitFor(() => app.session.markers(general).mentions === 1);

    expect(isListed("#general")).toBe(true);
    expect(sidebarRows()[rowOf("#general")]).toMatch(/#general\s+1/);

    await selectRow("#general");
    await app.press(keys.enter);
    await waitFor(() => app.session.markers(general).mentions === 0);
    expect(isListed("#general")).toBe(true);

    await selectRow("@stantz");
    await app.press(keys.enter);
    await waitFor(() => !isListed("#general"));
  });

  test("a muted channel with only unread messages stays hidden", async () => {
    await start({ muteMemory: muteMemory([general]) });
    await selectRow("@stantz");
    await app.press("M");

    await say(general);
    await waitFor(() => app.session.markers(general).isUnread);

    expect(isListed("#general")).toBe(false);
  });

  test("the open conversation stays listed while muted and hidden", async () => {
    await start({ muteMemory: muteMemory([general]) });
    await selectRow("#general");
    await app.press(keys.enter);
    await app.press("M");

    expect(isListed("#general")).toBe(true);

    await app.press("M");
    await selectRow("@stantz");
    await app.press(keys.enter);
    await app.press("M");

    expect(isListed("#general")).toBe(false);
  });

  test("hiding does nothing to channels that are not muted", async () => {
    await start({ muteMemory: muteMemory([general]) });
    await app.press("M");

    expect(isListed("#random")).toBe(true);
    expect(isListed("@stantz")).toBe(true);
  });
});

describe("mouse rows map to what is drawn", () => {
  test("clicking the row where a hidden channel was opens the channel now drawn there", async () => {
    await start({ muteMemory: muteMemory([general]) });
    await app.press("M");

    await app.click(5, screenRowOf("#random"));
    await app.waitForScreen("#random");

    expect(selectedRow()).toContain("#random");
  });

  test("hovering a row hovers what is drawn there", async () => {
    await start({ muteMemory: muteMemory([general]) });
    await app.press("M");

    await selectRow("@stantz");
    await app.hover(5, screenRowOf("#random"));

    const [red, green, blue] = [1, 3, 5].map((at) =>
      Number.parseInt(theme.sidebarHoverBackground.slice(at, at + 2), 16),
    );

    expect(app.coloredScreen()[screenRowOf("#random")]).toContain(
      `\u001b[48;2;${red};${green};${blue}m`,
    );
    expect(app.coloredScreen()[screenRowOf("#general")] ?? "").not.toContain(
      `\u001b[48;2;${red};${green};${blue}m`,
    );
  });
});

describe("sidebar lines", () => {
  const entry = (
    id: string,
    label: string,
    extra: Partial<SidebarEntry> = {},
  ): SidebarEntry =>
    ({
      conversation: { id },
      label,
      markers: { isUnread: false, mentions: 0 },
      ...extra,
    }) as SidebarEntry;

  const groups: SidebarGroups = {
    sections: [
      {
        id: "section:Work",
        name: "Work",
        entries: [entry("C0", "#work", { muted: true })],
      },
    ],
    channels: [
      entry("C1", "#one"),
      entry("C2", "#two", { muted: true }),
      entry("C3", "#three", {
        muted: true,
        markers: { isUnread: false, mentions: 2 },
      }),
      entry("C4", "#four", { muted: true }),
    ],
    directMessages: [entry("D1", "@ann")],
    unknownChannels: [],
  };
  const view = { recentLimit: 10, showAll: false };
  const keysOf = (lines: ReturnType<typeof sidebarLines>) => lines.map(lineKey);

  test("muted channels are listed unless hidden, in every section", () => {
    expect(keysOf(sidebarLines(groups, view))).toContain("C2");
    expect(keysOf(sidebarLines(groups, { ...view, hideMuted: true }))).toEqual([
      "heading:section:Work",
      "heading:channels",
      "C1",
      "C3",
      "heading:directMessages",
      "D1",
    ]);
  });

  test("a muted channel with mentions and the open conversation stay", () => {
    expect(
      keysOf(sidebarLines(groups, { ...view, hideMuted: true, openId: "C4" })),
    ).toEqual([
      "heading:section:Work",
      "heading:channels",
      "C1",
      "C3",
      "C4",
      "heading:directMessages",
      "D1",
    ]);
  });

  test("rows map to what is drawn, with hidden channels gone", () => {
    const lines = sidebarLines(groups, { ...view, hideMuted: true });

    expect(
      [0, 1, 2, 3, 4, 5, 6].map((row) => {
        const line = sidebarLineAt(lines, 0, 20, row);

        return line && lineKey(line);
      }),
    ).toEqual([
      "heading:section:Work",
      "heading:channels",
      "C1",
      "C3",
      "heading:directMessages",
      "D1",
      undefined,
    ]);
  });

  test("a collapsed section lists only the open conversation, hidden or not, and counts mentions of every channel", () => {
    const lines = sidebarLines(groups, {
      ...view,
      hideMuted: true,
      collapsed: new Set(["channels"]),
    });
    const heading = lines.find((line) => lineKey(line) === "heading:channels");

    expect(keysOf(lines)).not.toContain("C3");
    expect(heading).toMatchObject({ markers: { mentions: 2 } });
  });
});
