import { theme } from "../src/ui/theme";
import { afterEach, expect, test } from "bun:test";
import { loadPayload } from "./support/fixtures";
import { waitFor } from "./support/fakeSlack";
import { sidebarGroups, sidebarRow } from "../src/ui/app/sidebarEntries";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";

let app: AppHarness;

afterEach(() => app.stop());

const general = "C012AB3CD";
const random = "C061EG9T2";
const directMessage = "D0C0F7S8Y";
const other = "U222222222";

async function start(options: Parameters<typeof startAppHarness>[0] = {}) {
  app = await startAppHarness(options);
  await app.waitForScreen("@Peter Venkman");
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

const sidebarLineWith = (text: string) =>
  app
    .screen()
    .split("\n")
    .map((line) => line.slice(0, 32))
    .find((line) => line.includes(text))
    ?.trimEnd();

const findEntry = (label: string) => {
  const { channels, directMessages } = sidebarGroups(app.session);

  return [...channels, ...directMessages].find((e) => e.label === label);
};

const entryFor = (label: string) => {
  const entry = findEntry(label);

  if (!entry) {
    throw new Error(`no sidebar entry ${label}`);
  }

  return entry;
};

const rowOf = (
  label: string,
  state: { selected?: boolean; open?: boolean; focused?: boolean } = {},
  width = 32,
) =>
  sidebarRow(entryFor(label), {
    selected: false,
    open: false,
    focused: true,
    width,
    ...state,
  });

const nameRun = (label: string, state = {}) =>
  rowOf(label, state).find((run) => run.text.includes(label.slice(0, 4)))!;

const badgeOf = (label: string) =>
  rowOf(label).find(
    (run) => run.backgroundColor === theme.mentionBadgeBackground,
  );

test("read conversations are dimmed, unread are bold bright white with no dot, mentions add a red count badge at the right edge", async () => {
  await start();

  expect(nameRun("#random")).toMatchObject({ color: theme.secondaryText });
  expect(nameRun("#random").bold).toBeFalsy();

  await say(random);
  await waitFor(() => entryFor("#random").markers.isUnread);

  expect(nameRun("#random")).toMatchObject({
    bold: true,
    color: theme.brightText,
  });
  expect(badgeOf("#random")).toBeUndefined();
  expect(sidebarLineWith("#random")).not.toMatch(/[•(]/);

  await say(general, { text: "<!here> hi" });
  await say(general, { text: "<!channel> hi" });
  await waitFor(() => entryFor("#general").markers.mentions === 2);

  expect(nameRun("#general")).toMatchObject({
    bold: true,
    color: theme.brightText,
  });
  expect(badgeOf("#general")).toMatchObject({ text: " 2 ", bold: true });
  const drawnGeneralRow = () =>
    app
      .screen()
      .split("\n")
      .find((line) => line.includes("#general"))
      ?.slice(0, 32);

  await waitFor(() => drawnGeneralRow()?.endsWith(" 2 ") === true);
  expect(sidebarLineWith("#general")).toMatch(/^[› ][▌ ] #general +2$/);
  expect(drawnGeneralRow()).toEndWith(" 2 ");
});

test("selected and open markers stay legible in every state", async () => {
  await start();

  await say(random);
  await say(general, { text: "<!here> hi" });
  await waitFor(
    () =>
      entryFor("#random").markers.isUnread &&
      entryFor("#general").markers.mentions === 1,
  );

  for (const label of ["#random", "#general"]) {
    const selectedFocused = rowOf(label, { selected: true, open: true });
    const prefix = selectedFocused[0]!;

    expect(prefix.text).toBe("›▌ ");
    expect(prefix).toMatchObject({
      color: theme.selectionText,
      backgroundColor: theme.selectionBackground,
      bold: true,
    });

    const unfocused = rowOf(label, {
      selected: true,
      open: false,
      focused: false,
    });

    expect(unfocused[0]).toMatchObject({
      text: "›  ",
      backgroundColor: theme.unfocusedSelectionBackground,
    });
    expect(unfocused.map((run) => run.color)).not.toContain(
      theme.secondaryText,
    );
  }

  const readSelected = rowOf("@Peter Venkman", { selected: true });

  expect(readSelected[0]).toMatchObject({
    backgroundColor: theme.selectionBackground,
  });
  expect(readSelected.map((run) => run.color)).not.toContain(
    theme.secondaryText,
  );

  const readOpen = rowOf("@Peter Venkman", { open: true });

  expect(readOpen[0]).toMatchObject({ text: " ▌ ", bold: true });
  expect(readOpen[0]!.color).toBe(theme.text);
  expect(readOpen[1]).toMatchObject({ bold: true });
  expect(readOpen[1]!.color).toBe(theme.text);
});

test("the badge keeps its place when the selected row is highlighted", async () => {
  await start();

  await say(general, { text: "<!here> hi" });
  await waitFor(() => entryFor("#general").markers.mentions === 1);

  const row = rowOf("#general", { selected: true });
  const badge = row.at(-1)!;

  expect(badge).toMatchObject({
    text: " 1 ",
    backgroundColor: theme.mentionBadgeBackground,
    color: theme.mentionBadgeText,
  });
  expect(row.map((run) => run.text).join("")).toHaveLength(32);
});

test("a DM message shows as a mention", async () => {
  await start();

  await say(directMessage, { channel_type: "im" });

  await waitFor(() => entryFor("@Peter Venkman").markers.mentions === 1);
  await app.waitForScreen(/@Peter Venkman +1\b/);
});

test("the user's own messages leave the sidebar alone", async () => {
  await start();

  await say(general, { user: "U123ABC456" });
  await say(random, { text: "marker" });
  await waitFor(() => entryFor("#random").markers.isUnread);

  expect(entryFor("#general").markers.isUnread).toBe(false);
  expect(badgeOf("#general")).toBeUndefined();
});

test("opening a conversation clears its markers, and it stays clear while open", async () => {
  await start({
    prepare: (slack) =>
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [],
      })),
  });

  await say(general, { text: "<!here> hi" });
  await waitFor(() => entryFor("#general").markers.mentions === 1);

  await app.press(keys.enter);
  await waitFor(() => !badgeOf("#general"));

  await say(general, { text: "<!here> again" });
  await say(random);
  await waitFor(() => entryFor("#random").markers.isUnread);

  expect(badgeOf("#general")).toBeUndefined();
  expect(entryFor("#general").markers.isUnread).toBe(false);
});

test("markers follow their conversation when a rename re-sorts the sidebar", async () => {
  await start();

  await say(general, { text: "<!here> hi" });
  await waitFor(() => entryFor("#general").markers.mentions === 1);

  const rename = await loadPayload("channel-rename");

  await app.sendEvents({
    ...rename,
    event: {
      ...rename.event,
      channel: { ...rename.event.channel, id: general, name: "zzz-last" },
    },
  });

  await waitFor(() => findEntry("#zzz-last")?.markers.mentions === 1);
  expect(sidebarLineWith("#zzz-last")).toMatch(/#zzz-last +1$/);
});

test("a long name is cut short so the marker stays visible", async () => {
  await start({ columns: 60 });

  const rename = await loadPayload("channel-rename");

  await app.sendEvents({
    ...rename,
    event: {
      ...rename.event,
      channel: {
        ...rename.event.channel,
        id: general,
        name: "a-very-long-channel-name-indeed",
      },
    },
  });
  await say(general, { text: "<!here> hi" });

  await waitFor(() => findEntry("#a-very-long-channel-name-indeed"));
  await app.waitForScreen("…");

  const row = rowOf("#a-very-long-channel-name-indeed", {}, 20);

  expect(row.at(-1)).toMatchObject({ text: " 1 " });
  expect(row.map((run) => run.text).join("")).toHaveLength(20);
  expect(row.some((run) => run.text.endsWith("…"))).toBe(true);
});
