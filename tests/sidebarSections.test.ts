import { theme } from "../src/ui/theme";
import { afterEach, describe, expect, test } from "bun:test";
import type { SectionConfig } from "../src/config/config";
import type { CollapseMemory } from "../src/config/state";
import {
  headingRow,
  sidebarGroups,
  sidebarLines,
} from "../src/ui/app/sidebarEntries";
import { waitFor } from "./support/fakeSlack";
import { loadPayload } from "./support/fixtures";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";

let app: AppHarness;

afterEach(() => app.stop());

const general = "C012AB3CD";
const random = "C061EG9T2";
const other = "U222222222";

/** A collapse memory that keeps its value in a variable and records every write. */
function fakeCollapseMemory(initial: string[] = []) {
  const writes: string[][] = [];
  let stored = initial;

  const memory: CollapseMemory = {
    recall: async () => stored,
    remember(ids) {
      stored = ids;
      writes.push(ids);
    },
    flush: async () => {},
  };

  return { memory, writes, stored: () => stored };
}

async function start(options: Parameters<typeof startAppHarness>[0] = {}) {
  app = await startAppHarness(options);
  await app.waitForScreen("@Peter Venkman");
}

const sidebar = (): string[] =>
  app
    .screen()
    .split("\n")
    .map((line) => line.slice(0, 32).trimEnd());

/** The sidebar's rows without the 3-cell marker prefix, blank rows dropped. */
const names = (): string[] =>
  sidebar()
    .map((line) => line.slice(3).trim())
    .filter(Boolean);

const selectedRow = () => sidebar().find((line) => line.startsWith("›"));

const work: SectionConfig = { name: "Work", channels: ["#random"] };

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

/** Moves the selection (sidebar focused) onto the row containing `text`, searching down and then up. */
async function selectRow(text: string) {
  for (const key of [keys.down, keys.up]) {
    for (let i = 0; i < 30 && !selectedRow()?.includes(text); i += 1) {
      await app.press(key);
    }
  }

  expect(selectedRow()).toContain(text);
}

describe("configured sections", () => {
  test("appear in config order above Channels, with unassigned channels left in Channels", async () => {
    await start({
      sections: [
        { name: "Work", channels: ["#random"] },
        { name: "Empty", channels: [] },
      ],
    });

    expect(names().slice(0, 6)).toEqual([
      "Work",
      "#random",
      "Empty",
      "Channels",
      "#general",
      "Direct messages",
    ]);
  });

  test("a channel goes in the first section that lists it", async () => {
    await start({
      sections: [
        { name: "One", channels: ["random", "#random"] },
        { name: "Two", channels: ["#random", "general"] },
      ],
    });

    expect(names().slice(0, 6)).toEqual([
      "One",
      "#random",
      "Two",
      "#general",
      "Channels",
      "Direct messages",
    ]);
  });

  test("a channel configured by ID keeps its section after a rename; one configured by name does not", async () => {
    await start({
      sections: [
        { name: "ById", channels: [general] },
        { name: "ByName", channels: ["#random"] },
      ],
    });

    expect(names().slice(0, 4)).toEqual([
      "ById",
      "#general",
      "ByName",
      "#random",
    ]);

    await app.sendEvents(await loadPayload("channel-rename"));
    await app.waitForScreen("#renamed");

    expect(names().slice(0, 4)).toEqual([
      "ById",
      "#renamed",
      "ByName",
      "#random",
    ]);
  });

  test("unknown names produce one status-bar warning and are otherwise ignored", async () => {
    await start({
      sections: [
        { name: "Work", channels: ["#random", "#nope", "ghost", "C0MISSING"] },
        { name: "More", channels: ["ghost"] },
      ],
    });

    const status = app.screen().trimEnd().split("\n").at(-1)!;

    expect(status).toContain("not found in sections: #nope, ghost, C0MISSING");
    expect(status.match(/not found/g)).toHaveLength(1);
    expect(names().slice(0, 3)).toEqual(["Work", "#random", "More"]);
  });

  test("no warning while the channel list is still loading, none when everything is known", async () => {
    await start({ sections: [work] });

    expect(app.screen()).not.toContain("not found");
  });
});

describe("collapsing", () => {
  test("Enter on a heading hides its channels and Enter again shows them; Enter on a channel still opens it", async () => {
    await start({ sections: [work] });

    await selectRow("Work");
    await app.press(keys.enter);

    expect(names()).not.toContain("#random");
    expect(names()).toContain("#general");
    expect(selectedRow()).toContain("▸");

    await app.press(keys.enter);

    expect(names()).toContain("#random");
    expect(selectedRow()).toContain("▾");

    await app.press(keys.down);
    await app.press(keys.enter);

    expect(app.screen()).toContain("▌");
    expect(names()).toContain("#random");
  });

  test("space toggles, and left and right collapse and expand", async () => {
    await start({ sections: [work] });
    await selectRow("Work");

    await app.press(" ");
    expect(names()).not.toContain("#random");

    await app.press(" ");
    expect(names()).toContain("#random");

    await app.press(keys.left);
    expect(names()).not.toContain("#random");

    await app.press(keys.left);
    expect(names()).not.toContain("#random");

    await app.press(keys.right);
    expect(names()).toContain("#random");

    await app.press("h");
    expect(names()).not.toContain("#random");

    await app.press("l");
    expect(names()).toContain("#random");
  });

  test("Channels and Direct messages collapse too", async () => {
    await start();

    await selectRow("Channels");
    await app.press(keys.enter);

    expect(names()).not.toContain("#general");
    expect(names()).toContain("@Peter Venkman");

    await selectRow("Direct messages");
    await app.press(keys.enter);

    expect(names().slice(0, 2)).toEqual(["Channels", "Direct messages"]);
  });

  test("navigation moves over headings and visible entries, skipping collapsed contents", async () => {
    await start({ sections: [work] });

    expect(selectedRow()).toContain("#random");

    await app.press(keys.up);
    expect(selectedRow()).toContain("Work");

    await app.press(keys.enter);
    await app.press(keys.down);
    expect(selectedRow()).toContain("Channels");

    await app.press(keys.down);
    expect(selectedRow()).toContain("#general");

    await app.press(keys.up);
    await app.press(keys.up);
    expect(selectedRow()).toContain("Work");
  });

  test("the selection stays on the heading when it collapses", async () => {
    await start({ sections: [work] });
    await selectRow("Channels");
    await app.press(keys.enter);

    expect(selectedRow()).toContain("Channels");
  });

  test("a collapsed section still lists the open conversation", async () => {
    await start({ sections: [work] });
    await selectRow("#random");
    await app.press(keys.enter);
    await app.press(keys.up);
    await app.press(keys.enter);

    expect(names().slice(0, 2)).toEqual(["Work", "#random"]);
    expect(app.screen()).toContain("▌");

    await app.press(keys.down);
    await app.press(keys.down);
    await app.press(keys.up);
    await app.press(keys.up);
    await app.press(keys.enter);

    expect(names().slice(0, 2)).toEqual(["Work", "#random"]);
  });

  test("a message in a collapsed section shows on its heading", async () => {
    await start({ sections: [work] });
    await selectRow("Work");
    await app.press(keys.enter);

    await say(random, { text: "<!here> hi" });
    await say(random, { text: "<!here> again" });
    await waitFor(() => app.session.markers(random).mentions === 2);
    await app.waitForScreen(/Work +2/);

    expect(sidebar().find((line) => line.includes("Work"))).toEndWith("2");
  });
});

describe("aggregated markers on a collapsed heading", () => {
  const headingFor = (id: string, collapsed: Set<string>) =>
    sidebarLines(sidebarGroups(app.session, [work]), {
      recentLimit: 10,
      showAll: false,
      collapsed,
    }).find((line) => line.kind === "heading" && line.id === id)!;

  const runs = (id: string, collapsed: Set<string>) => {
    const line = headingFor(id, collapsed);

    if (line.kind !== "heading") {
      throw new Error("not a heading");
    }

    return headingRow(line, {
      selected: false,
      focused: true,
      width: 32,
    });
  };

  test("an expanded heading is quiet; a collapsed one is bold white when anything inside is unread, with the mention total as a badge", async () => {
    await start({ sections: [work] });

    const collapsed = new Set(["section:Work", "channels"]);

    expect(runs("section:Work", collapsed)[1]).toMatchObject({
      color: theme.sidebarHeadingText,
    });

    await say(random);
    await waitFor(() => app.session.markers(random).isUnread);

    expect(runs("section:Work", new Set())[1]).toMatchObject({
      color: theme.sidebarHeadingText,
    });
    expect(runs("section:Work", collapsed)[1]).toMatchObject({
      bold: true,
      color: theme.brightText,
    });
    expect(runs("channels", collapsed)[1]).toMatchObject({
      color: theme.sidebarHeadingText,
    });

    await say(random, { text: "<!here> hi" });
    await say(random, { text: "<!here> hi" });
    await waitFor(() => app.session.markers(random).mentions === 2);

    const badge = runs("section:Work", collapsed).find(
      (run) => run.backgroundColor === theme.mentionBadgeBackground,
    );

    expect(badge?.text).toBe(" 2 ");
    expect(
      runs("section:Work", new Set()).some((run) => run.color === "red"),
    ).toBe(false);
  });

  test("the Direct messages heading aggregates DMs outside the recent window too", async () => {
    await start({ recentDms: 1 });

    const hidden = sidebarGroups(app.session).directMessages.at(-1)!;

    await say(hidden.conversation.id, { channel_type: "im" });
    await waitFor(() => app.session.markers(hidden.conversation.id).isUnread);

    expect(
      runs("directMessages", new Set(["directMessages"]))[1],
    ).toMatchObject({ bold: true, color: theme.brightText });
  });
});

describe("remembering collapsed sections", () => {
  test("collapsing and expanding is recorded with the memory", async () => {
    const { memory, writes } = fakeCollapseMemory();

    await start({ sections: [work], collapseMemory: memory });
    await selectRow("Work");
    await app.press(keys.enter);
    await selectRow("Direct messages");
    await app.press(keys.enter);
    await app.press(keys.up);
    await app.press(keys.up);
    await app.press(keys.up);
    await app.press(keys.enter);

    expect(writes).toEqual([
      ["section:Work"],
      ["section:Work", "directMessages"],
      ["directMessages"],
    ]);
  });

  test("what an earlier run collapsed starts collapsed", async () => {
    const { memory } = fakeCollapseMemory(["section:Work", "channels"]);

    await start({ sections: [work], collapseMemory: memory });
    await waitFor(() => !names().includes("#general"));

    expect(names().slice(0, 3)).toEqual([
      "Work",
      "Channels",
      "Direct messages",
    ]);
  });

  test("remembered ids of sections that no longer exist are harmless", async () => {
    const { memory } = fakeCollapseMemory(["section:Gone"]);

    await start({ sections: [work], collapseMemory: memory });

    expect(names().slice(0, 2)).toEqual(["Work", "#random"]);
  });
});
