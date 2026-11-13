import { afterEach, expect, test } from "bun:test";
import { conversationRows } from "../src/ui/app/paneRows";
import { theme } from "../src/ui/theme";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import { waitFor } from "./support/fakeSlack";

let app: AppHarness;

afterEach(() => app.stop());

const general = "C012AB3CD";
const me = "U123ABC456";
const other = "U222222222";
const parentTs = "1600000000.000001";
const theirsTs = "1600000050.000001";
const mineTs = "1600000100.000001";
const replyTs = "1600000010.000001";

type Raw = Record<string, unknown>;

const parent: Raw = {
  type: "message",
  user: other,
  text: "their parent",
  ts: parentTs,
  thread_ts: parentTs,
  reply_count: 1,
};
const theirs: Raw = {
  type: "message",
  user: other,
  text: "their words",
  ts: theirsTs,
  reactions: [{ name: "tada", users: [other], count: 1 }],
};
const mine: Raw = {
  type: "message",
  user: me,
  text: "my words",
  ts: mineTs,
  reactions: [{ name: "heart", users: [me, other], count: 2 }],
};
const reply: Raw = {
  type: "message",
  user: other,
  text: "a reply",
  ts: replyTs,
  thread_ts: parentTs,
};

/** Opens #general with the newest message ("my words") selected in the message pane. */
async function start() {
  app = await startAppHarness({
    columns: 160,
    rows: 30,
    prepare: (slack) => {
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [mine, theirs, parent],
        has_more: false,
      }));
      slack.respond("conversations.replies", () => ({
        ok: true,
        messages: [parent, reply],
        has_more: false,
      }));
      slack.respond("emoji.list", () => ({
        ok: true,
        emoji: { partyparrot: "https://x/y.gif" },
      }));
    },
  });
  await app.waitForScreen("#general", 5000);
  await app.press(keys.enter);
  await app.waitForScreen("my words");
  await waitFor(() => app.session.currentUserId);
  await waitFor(() => app.session.customEmojiNames().length > 0);
  await app.press(keys.tab);
}

const calls = (method: string) =>
  app.slack.calls.filter((call) => call.method === method);

const reactionsOf = (ts: string) => app.session.message(general, ts)?.reactions;
const statusBar = () => app.screen().trimEnd().split("\n").at(-1)!;
const promptArea = () => app.screen().split("\n").slice(-12).join("\n");

function echo(action: "added" | "removed", ts: string, name: string) {
  return app.sendEvents({
    event: {
      type: `reaction_${action}`,
      user: me,
      reaction: name,
      item: { type: "message", channel: general, ts },
      event_ts: "1.1",
    },
  });
}

test("r opens a prompt that completes names, says it will add, and Enter adds the chosen one", async () => {
  await start();
  await app.press("k");
  await app.press("r");

  expect(promptArea()).toContain("React with");

  await app.press("tad");
  await app.waitForScreen(":tada:");

  expect(promptArea()).toContain("🎉");
  expect(promptArea()).toContain("Enter adds :tada:");
  expect(promptArea()).toContain("Esc cancels");

  await app.press(keys.enter);

  await waitFor(() => calls("reactions.add").length > 0);
  expect(calls("reactions.add")[0]?.params).toMatchObject({
    channel: general,
    timestamp: theirsTs,
    name: "tada",
  });
  expect(app.screen()).not.toContain("React with");
  expect(app.screen()).toContain("🎉\u00a02");

  await echo("added", theirsTs, "tada");

  expect(app.screen()).toContain("🎉\u00a02");
});

test("the prompt says remove for a reaction you already have, and Enter removes it", async () => {
  await start();
  await app.press("r");
  await app.press(":heart:");

  expect(promptArea()).toContain("Enter removes :heart:");

  await app.press(keys.enter);
  await waitFor(() => calls("reactions.remove").length > 0);

  expect(calls("reactions.remove")[0]?.params).toMatchObject({
    timestamp: mineTs,
    name: "heart",
  });
  expect(reactionsOf(mineTs)).toEqual([
    { name: "heart", userIds: [other], count: 1 },
  ]);

  await echo("removed", mineTs, "heart");

  expect(reactionsOf(mineTs)).toEqual([
    { name: "heart", userIds: [other], count: 1 },
  ]);
});

test("Up and Down choose, custom emoji are offered, Tab fills the name in for editing", async () => {
  await start();
  await app.press("r");
  await app.press("party");
  await app.waitForScreen(":partyparrot:");

  expect(promptArea()).toContain("custom");

  await app.press(keys.tab);
  await app.press("::skin-tone-2");
  await app.press(keys.enter);
  await waitFor(() => calls("reactions.add").length > 0);

  expect(calls("reactions.add")[0]?.params).toMatchObject({
    name: "partyparrot::skin-tone-2",
  });
});

test("skin tones typed in full are sent as typed, with or without colons", async () => {
  await start();
  await app.press("r");
  await app.press(":+1::skin-tone-2:");
  await app.press(keys.enter);
  await waitFor(() => calls("reactions.add").length > 0);

  expect(calls("reactions.add")[0]?.params).toMatchObject({
    name: "+1::skin-tone-2",
  });
});

test("Up/Down pick another match before Enter", async () => {
  await start();
  await app.press("r");
  await app.press("smile");
  await app.press(keys.down);
  await app.press(keys.enter);
  await waitFor(() => calls("reactions.add").length > 0);

  expect(calls("reactions.add")[0]?.params.name).toBeTruthy();
  expect(calls("reactions.add")[0]?.params.name).not.toBe("smile");
});

test("Esc cancels the prompt without calling Slack", async () => {
  await start();
  await app.press("r");
  await app.press("tad");
  await app.press(keys.escape);

  expect(app.screen()).not.toContain("React with");
  expect(calls("reactions.add")).toHaveLength(0);
  expect(calls("reactions.remove")).toHaveLength(0);
});

test("your own reactions are highlighted in the reaction line, including a new one", async () => {
  await start();
  await app.press("r");
  await app.press("eyes");
  await app.press(keys.enter);
  await waitFor(() => calls("reactions.add").length > 0);

  const [row] = conversationRows(app.session, general, 100).rows.filter(
    (candidate) =>
      candidate.kind === "reactions" && candidate.messageTs === mineTs,
  );
  const marked = (text: string) =>
    row?.runs.find((run) => run.text.includes(text))?.backgroundColor ===
    theme.ownReactionBackground;

  expect(marked("❤️")).toBe(true);
  expect(marked("👀")).toBe(true);
});

test("a refused reaction goes back and the reason is in the status bar", async () => {
  await start();
  app.slack.respond("reactions.add", () => ({
    ok: false,
    error: "too_many_reactions",
  }));
  await app.press("r");
  await app.press("eyes");
  await app.press(keys.enter);
  await app.waitForScreen("most reactions");

  expect(statusBar()).toContain("most reactions");
  expect(reactionsOf(mineTs)).toEqual([
    { name: "heart", userIds: [me, other], count: 2 },
  ]);
});

test("already_reacted leaves the reaction shown and says nothing", async () => {
  await start();
  app.slack.respond("reactions.add", () => ({
    ok: false,
    error: "already_reacted",
  }));
  await app.press("r");
  await app.press("eyes");
  await app.press(keys.enter);
  await waitFor(() => calls("reactions.add").length > 0);
  await app.press("");

  expect(statusBar()).not.toContain("Slack");
  expect(reactionsOf(mineTs)?.map((reaction) => reaction.name)).toContain(
    "eyes",
  );
});

test("r in the thread pane reacts to the selected reply", async () => {
  await start();
  await app.press("k");
  await app.press("k");
  await app.press(keys.enter);
  await app.waitForScreen("a reply");
  await app.press("r");
  await app.press("fire");
  await app.press(keys.enter);
  await waitFor(() => calls("reactions.add").length > 0);

  expect(calls("reactions.add")[0]?.params).toMatchObject({
    timestamp: replyTs,
    name: "fire",
  });
});

test("while the prompt is open its keys don't act on the list", async () => {
  await start();
  await app.press("r");
  await app.press("d");

  expect(statusBar()).not.toContain("Delete this message?");
  expect(promptArea()).toContain("React with");
});
