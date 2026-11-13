import { afterEach, expect, test } from "bun:test";
import { loadFixture } from "./support/fixtures";
import { waitFor, type ApiCall } from "./support/fakeSlack";
import { findPopup } from "./support/popup";
import {
  type AppHarness,
  keys,
  sgrMouse,
  startAppHarness,
} from "./support/appHarness";

let app: AppHarness;

afterEach(() => app.stop());

const sidebarWidth = 32;
const rightButton = 2;
const created = 1503435939;

type Info = Record<string, any>;

async function start({
  info = {},
  answer,
  sections,
}: {
  info?: Info;
  answer?: (
    call: ApiCall,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  sections?: { name: string; channels: string[] }[];
} = {}) {
  const [infoPrivate] = await loadFixture("conversations-info-private");
  const [infoChannel] = await loadFixture("conversations-info-channel");
  const [userInfo] = await loadFixture("users-info");
  const [channels, directs] = [
    ...(await loadFixture("users-conversations-channels")),
    ...(await loadFixture("users-conversations-dms")),
  ];

  app = await startAppHarness({
    rows: 30,
    columns: 120,
    sections,
    prepare: async (slack) => {
      slack.respondPaged("users.conversations", [
        {
          ...channels!,
          channels: [...channels!.channels, infoPrivate!.channel],
        },
        directs!,
      ]);
      slack.respondPaged(
        "conversations.list",
        await loadFixture("conversations-list-public"),
      );
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [],
        has_more: false,
      }));
      slack.respond("users.info", () => userInfo!);
      slack.respond("conversations.info", (call) => {
        if (answer) {
          return answer(call);
        }

        const source =
          call.params.channel === "G012AB3CD" ? infoPrivate : infoChannel;

        return {
          ...source!,
          channel: { ...source!.channel, num_members: 42, ...info },
        };
      });
      slack.grantScopes([
        "identify",
        "dnd:read",
        "channels:read",
        "channels:write",
        "groups:write",
      ]);
    },
  });
  await app.waitForScreen("#secret");
  await waitFor(() => app.session.currentUserId);
}

const sidebarRows = () =>
  app
    .screen()
    .split("\n")
    .map((line) => line.slice(0, sidebarWidth).trim());
const rowOf = (name: string) =>
  sidebarRows().findIndex((row) => row.includes(name));
const selectedRow = () => sidebarRows().find((row) => row.startsWith("›"));
const detailsCalls = () =>
  app.slack.calls.filter((call) => call.method === "conversations.info");
const statusBar = () => app.screen().trimEnd().split("\n").at(-1)!;

/** The popup, found by its title (`#name details`, which no sidebar row contains) over its border. */
const details = (title: string) => findPopup(app.screen(), title);

async function selectRow(name: string) {
  const selectedIndex = () =>
    sidebarRows().findIndex((row) => row.startsWith("›"));

  while (!selectedRow()?.includes(name)) {
    await app.press(selectedIndex() < rowOf(name) ? "j" : "k");
  }
}

async function openDetails(name?: string) {
  if (name) {
    await selectRow(name);
  }

  await app.press("m");
  await app.press("d");
}

const text = (title: string) => details(title)!.rows.join("\n");

test("the menu lists Channel details with its letter, and choosing it opens the popup for a public channel", async () => {
  await start();

  await app.press("m");

  expect(app.screen()).toContain("d Channel details");

  await app.press("d");
  await app.waitForScreen("#general details");

  const shown = text("#general details");

  expect(shown).toContain("Name         #general");
  expect(shown).toContain("Type         Public channel");
  expect(shown).toContain("Topic        Company-wide announcements");
  expect(shown).toContain("Description  General chat");
  expect(shown).toContain(
    `Created      ${new Date(created * 1000).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} by spengler`,
  );
  expect(shown).toContain("Members      42");
  expect(shown).toContain("ID           C012AB3CD");
  expect(shown).toContain("Section      Channels");
  expect(shown).toContain("Muted        no");
  expect(statusBar()).toContain("j/k scroll");
  expect(detailsCalls().at(-1)!.params).toMatchObject({
    channel: "C012AB3CD",
    include_num_members: "true",
  });
});

test("a private channel says so and shows its own fields", async () => {
  await start({ info: { num_members: 3 } });

  await openDetails("#secret");
  await app.waitForScreen("#secret details");

  const shown = text("#secret details");

  expect(shown).toContain("Type         Private channel");
  expect(shown).toContain("Members      3");
  expect(shown).toContain("ID           G012AB3CD");
});

test("the section is the configured one the channel is listed in", async () => {
  await start({ sections: [{ name: "Ghosts", channels: ["general"] }] });

  await openDetails();
  await app.waitForScreen("#general details");

  expect(text("#general details")).toContain("Section      Ghosts");
});

test("an empty topic and description show as none", async () => {
  await start({
    info: {
      topic: { value: "", creator: "", last_set: 0 },
      purpose: { value: "", creator: "", last_set: 0 },
    },
  });

  await openDetails();
  await app.waitForScreen("#general details");

  const shown = text("#general details");

  expect(shown).toContain("Topic        none");
  expect(shown).toContain("Description  none");
});

test("Slack formatting in the topic and description shows as it does in messages", async () => {
  await start({
    info: {
      topic: {
        value:
          "Ask <@U123ABC456> in <#C012AB3CD|general> :tada: <https://example.com|docs>",
      },
      purpose: { value: "Fish &amp; chips" },
    },
  });

  await openDetails();
  await app.waitForScreen("#general details");

  const shown = text("#general details");

  expect(shown).toContain("@spengler");
  expect(shown).toContain("#general");
  expect(shown).toContain("🎉");
  expect(shown).toContain("(https://example.com)");
  expect(shown).toContain("Fish & chips");
  expect(shown).not.toContain("<@");
});

test("it says it is loading while Slack answers, and shows the answer after", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const [infoChannel] = await loadFixture("conversations-info-channel");
  let held = false;

  await start({
    answer: async () => {
      if (held) {
        await gate;
      }

      return infoChannel!;
    },
  });
  held = true;

  await openDetails();

  expect(text("#general details")).toContain("Loading…");

  release();
  await app.waitForScreen("Company-wide announcements");

  expect(text("#general details")).not.toContain("Loading");
});

test("Slack's refusal shows in the popup", async () => {
  await start({
    answer: () => ({ ok: false, error: "channel_not_found" }),
  });

  await openDetails();
  await app.waitForScreen("Slack can't find this channel");

  expect(text("#general details")).not.toContain("Loading");
});

test("a missing scope is explained in the popup", async () => {
  await start({
    answer: () => ({ ok: false, error: "missing_scope" }),
  });

  await openDetails();
  await app.waitForScreen("channels:read");
});

test("each opening asks Slack again", async () => {
  await start();

  await openDetails();
  await app.waitForScreen("#general details");
  await app.press(keys.escape);
  await openDetails();
  await app.waitForScreen("#general details");

  await waitFor(() =>
    detailsCalls().filter((call) => call.params.include_num_members).length ===
    2
      ? true
      : undefined,
  );
});

const longText = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");

test("long text wraps inside the popup and scrolls with j/k and the wheel", async () => {
  await start({
    info: {
      topic: { value: longText },
      purpose: {
        value: Array.from({ length: 30 }, (_, i) => `line${i}`).join("\n"),
      },
    },
  });

  await openDetails();
  await app.waitForScreen("#general details");

  const popup = details("#general details")!;

  expect(popup.rows.join("\n")).toContain("word0");
  expect(popup.rows.join("\n")).not.toContain("word59");
  expect(popup.rows.join("\n")).not.toContain("ID  ");
  expect(
    popup.rows.every((row) => row.length === popup.right - popup.left - 2),
  ).toBe(true);

  await app.press("G");

  expect(text("#general details")).toContain("Section");
  expect(text("#general details")).not.toContain("Name ");

  await app.press("g");

  expect(text("#general details")).toContain("Name");

  await app.wheel("down", popup.left + 3, popup.top + 2, 5);

  expect(text("#general details")).not.toContain("Name   ");
  expect(details("#general details")).toBeDefined();
  expect(selectedRow()).toContain("#general");
});

test("Esc closes the popup and the sidebar has the keys again", async () => {
  await start();

  await openDetails();
  await app.waitForScreen("#general details");
  await app.press("x");

  expect(statusBar()).not.toContain("Leave");

  await app.press(keys.escape);

  expect(details("#general details")).toBeUndefined();

  await app.press("j");

  expect(selectedRow()).toContain("#random");
});

test("a click outside closes it, and one inside does not", async () => {
  await start();

  await openDetails();
  await app.waitForScreen("#general details");

  const popup = details("#general details")!;

  await app.click(popup.left + 3, popup.top + 2);

  expect(details("#general details")).toBeDefined();

  await app.click(110, 28);

  expect(details("#general details")).toBeUndefined();
  expect(selectedRow()).toContain("#general");
});

test("opened from a right-click menu it works the same", async () => {
  await start();

  await app.mouse(sgrMouse(rightButton, 5, rowOf("#secret"), "M"));

  const menu = findPopup(
    app
      .screen()
      .split("\n")
      .map((line) => " ".repeat(sidebarWidth) + line.slice(sidebarWidth))
      .join("\n"),
    "#secret",
  )!;

  await app.click(menu.left + 3, menu.top + 3);
  await app.waitForScreen("#secret details");
});
