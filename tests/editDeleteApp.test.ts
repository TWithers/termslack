import { afterEach, expect, test } from "bun:test";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import { waitFor } from "./support/fakeSlack";

let app: AppHarness;
import { statusLine } from "./support/panes";

afterEach(() => app.stop());

const general = "C012AB3CD";
const parentTs = "1600000000.000001";
const theirsTs = "1600000050.000001";
const mineTs = "1600000100.000001";
const replyTs = "1600000010.000001";

type Raw = Record<string, unknown>;

const parent: Raw = {
  type: "message",
  user: "U222222222",
  text: "their parent",
  ts: parentTs,
  thread_ts: parentTs,
  reply_count: 1,
};
const theirs: Raw = {
  type: "message",
  user: "U222222222",
  text: "their words",
  ts: theirsTs,
};
const mine: Raw = {
  type: "message",
  user: "U123ABC456",
  text: "my words &amp; more",
  ts: mineTs,
};
const myReply: Raw = {
  type: "message",
  user: "U123ABC456",
  text: "my reply",
  ts: replyTs,
  thread_ts: parentTs,
};

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
        messages: [parent, myReply],
        has_more: false,
      }));
    },
  });
  await app.waitForScreen("#general", 5000);
  await app.press(keys.enter);
  await app.waitForScreen("my words & more");
  await waitFor(() => app.session.currentUserId);
  await app.press(keys.tab);
}

const calls = (method: string) =>
  app.slack.calls.filter((call) => call.method === method);

const stored = (ts: string) => app.session.message(general, ts);

const column = (from: number, to?: number) =>
  app
    .screen()
    .split("\n")
    .map((line) => line.slice(from, to).trimEnd())
    .join("\n");

const messagePane = () => column(32, 96);
const threadPane = () => column(96);
const statusBar = () => statusLine(app.screen());

function echoEdit(ts: string, text: string) {
  return app.sendEvents({
    type: "event_callback",
    event: {
      type: "message",
      subtype: "message_changed",
      channel: general,
      channel_type: "channel",
      message: {
        type: "message",
        user: "U123ABC456",
        text,
        ts,
        edited: { user: "U123ABC456" },
      },
    },
  });
}

test("e puts the message in the input in edit mode; Enter saves it through chat.update and it shows (edited)", async () => {
  await start();
  await app.press("e");

  expect(app.screen()).toContain("Editing — Enter to save, Esc to cancel");
  expect(statusBar()).toContain("Enter save");
  expect(statusBar()).toContain("Esc cancel");
  expect(app.screen()).toContain("my words & more");

  await app.press(" plus");
  await app.press(keys.enter);
  await app.waitForScreen("(edited)");

  expect(calls("chat.update")[0]?.params).toMatchObject({
    channel: general,
    ts: mineTs,
    text: "my words &amp; more plus",
  });
  expect(messagePane()).toContain("my words & more plus");
  expect(app.screen()).not.toContain("Editing —");

  await echoEdit(mineTs, "my words &amp; more plus");

  expect(messagePane().match(/\(edited\)/g)).toHaveLength(1);
});

test("Esc cancels an edit and the draft that was in the input comes back", async () => {
  await start();
  await app.press("i");
  await app.press("half written");
  await app.press(keys.escape);
  await app.press("e");
  await app.press(" changed");
  await app.press(keys.escape);

  expect(app.screen()).not.toContain("Editing —");
  expect(app.screen()).toContain("half written");
  expect(app.screen()).not.toContain("changed");
  expect(calls("chat.update")).toHaveLength(0);

  await app.press("i");
  await app.press("!");

  expect(app.screen()).toContain("half written!");
});

test("saving unchanged text just leaves edit mode", async () => {
  await start();
  await app.press("e");
  await app.press(keys.enter);

  expect(app.screen()).not.toContain("Editing —");
  expect(calls("chat.update")).toHaveLength(0);
});

test("a refused edit restores the message and shows the reason", async () => {
  await start();
  app.slack.respond("chat.update", () => ({
    ok: false,
    error: "edit_window_closed",
  }));
  await app.press("e");
  await app.press(" late");
  await app.press(keys.enter);
  await app.waitForScreen("too old to edit");

  expect(messagePane()).toContain("my words & more");
  expect(messagePane()).not.toContain("late");
  expect(messagePane()).not.toContain("(edited)");
  expect(stored(mineTs)?.isEdited).toBe(false);
});

test("e and d on someone else's message show a hint and do nothing", async () => {
  await start();
  await app.press("k");
  await app.press("e");

  expect(statusBar()).toContain("You can only edit your own messages");
  expect(app.screen()).not.toContain("Editing —");

  await app.press("d");

  expect(statusBar()).toContain("You can only delete your own messages");
  expect(statusBar()).not.toContain("Delete this message?");
  expect(calls("chat.delete")).toHaveLength(0);
});

test("d asks in the status bar; any other key cancels and nothing else happens", async () => {
  await start();
  await app.press("d");

  expect(statusBar()).toContain("Delete this message? y/n");

  await app.press("k");

  expect(statusBar()).not.toContain("Delete this message?");
  expect(calls("chat.delete")).toHaveLength(0);
  expect(messagePane()).toContain("my words & more");
});

test("d then y deletes through chat.delete, the message goes and selection moves to its neighbour", async () => {
  await start();
  await app.press("d");
  await app.press("y");
  await waitFor(() => calls("chat.delete")[0]);

  expect(calls("chat.delete")[0]?.params).toMatchObject({
    channel: general,
    ts: mineTs,
  });
  expect(messagePane()).not.toContain("my words");
  expect(stored(mineTs)?.isDeleted).toBe(true);

  await app.sendEvents({
    type: "event_callback",
    event: {
      type: "message",
      subtype: "message_deleted",
      channel: general,
      channel_type: "channel",
      deleted_ts: mineTs,
    },
  });

  expect(messagePane()).toContain("their words");
});

test("a refused delete brings the message back and shows the reason", async () => {
  await start();
  app.slack.respond("chat.delete", () => ({
    ok: false,
    error: "cant_delete_message",
  }));
  await app.press("d");
  await app.press("y");
  await app.waitForScreen("won't let you delete");

  expect(messagePane()).toContain("my words & more");
});

test("the thread pane edits and deletes its own messages the same way", async () => {
  await start();
  await app.press("j");
  await app.press("k");
  await app.press("k");
  await app.press(keys.enter);
  await app.waitForScreen("my reply");

  await app.press("j");
  await app.press("e");

  expect(threadPane()).toContain("Editing — Enter to save, Esc to cancel");

  await app.press("!");
  await app.press(keys.enter);
  await waitFor(() => calls("chat.update")[0]);

  expect(calls("chat.update")[0]?.params).toMatchObject({
    ts: replyTs,
    text: "my reply!",
  });
  expect(threadPane()).toContain("my reply!");
  expect(threadPane()).toContain("(edited)");

  await app.press("d");
  await app.press("y");
  await waitFor(() => calls("chat.delete")[0]);

  expect(calls("chat.delete")[0]?.params).toMatchObject({ ts: replyTs });
  expect(threadPane()).not.toContain("my reply");
});

const ctrlT = "\x14";

const postCalls = () => calls("chat.postMessage");

/** Opens the parent's thread, then comes back to the conversation's message list. */
async function openThreadThenMessages() {
  await app.press("j");
  await app.press("k");
  await app.press("k");
  await app.press(keys.enter);
  await app.waitForScreen("my reply");
  await app.press(keys.tab);
  await app.press(keys.tab);
  await app.press(keys.tab);
  await app.press("j");
  await app.press("j");
}

test("an edit in the conversation input does not capture the thread reply box", async () => {
  await start();
  await openThreadThenMessages();
  await app.press("e");

  expect(messagePane()).toContain("Editing — Enter to save, Esc to cancel");

  await app.press(keys.tab);
  await app.press(keys.tab);
  await app.press("hi");
  await app.press(ctrlT);

  expect(threadPane()).toContain("also send to");

  await app.press(keys.enter);
  await waitFor(() => postCalls()[0]);

  expect(postCalls()[0]?.params).toMatchObject({
    text: "hi",
    thread_ts: parentTs,
  });
  expect(calls("chat.update")).toHaveLength(0);
  expect(messagePane()).toContain("Editing — Enter to save, Esc to cancel");

  await app.press(keys.tab);
  await app.press(keys.tab);
  await app.press(keys.tab);

  expect(messagePane()).toContain("Editing — Enter to save, Esc to cancel");
});

test("Esc in the thread reply box leaves an edit in the conversation input alone", async () => {
  await start();
  await openThreadThenMessages();
  await app.press("e");
  await app.press(keys.tab);
  await app.press(keys.tab);
  await app.press(keys.escape);

  expect(messagePane()).toContain("Editing — Enter to save, Esc to cancel");
});

test("an edit in the thread does not capture the conversation input", async () => {
  await start();
  await app.press("j");
  await app.press("k");
  await app.press("k");
  await app.press(keys.enter);
  await app.waitForScreen("my reply");
  await app.press("j");
  await app.press("e");
  await app.press(keys.tab);
  await app.press(keys.tab);
  await app.press(keys.tab);
  await app.press("yo");
  await app.press(keys.enter);
  await waitFor(() => postCalls()[0]);

  expect(postCalls()[0]?.params).toMatchObject({ text: "yo" });
  expect(postCalls()[0]?.params).not.toHaveProperty("thread_ts");
  expect(calls("chat.update")).toHaveLength(0);
  expect(threadPane()).toContain("Editing — Enter to save, Esc to cancel");
});

test("narrowing the terminal never drops focus into the thread input", async () => {
  await start();
  await openThreadThenMessages();
  await app.press(keys.tab);
  await app.resize(100, 30);
  await app.press("x");

  expect(app.screen()).not.toContain("x│");
  expect(app.screen()).toContain("Reply…");
  expect(statusBar()).not.toContain("Enter send");
});

test("an edit in the conversation input is cancelled when the terminal narrows, and the draft returns", async () => {
  await start();
  await app.press("i");
  await app.press("kept draft");
  await app.press(keys.escape);
  await openThreadThenMessages();
  await app.press("e");
  await app.resize(100, 30);

  expect(app.screen()).not.toContain("Editing —");

  await app.resize(160, 30);

  expect(app.screen()).not.toContain("Editing —");
  expect(messagePane()).toContain("kept draft");
  expect(calls("chat.update")).toHaveLength(0);
});
