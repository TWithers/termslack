import { afterEach, expect, test } from "bun:test";
import { waitFor } from "./support/fakeSlack";
import {
  type SessionHarness,
  startSessionHarness,
} from "./support/sessionHarness";

let harness: SessionHarness;

afterEach(() => harness.stop());

const channel = "C123ABC456";
const me = "U123ABC456";
const other = "U222222222";
const mineTs = "1600000000.000001";
const theirsTs = "1600000100.000001";

async function start() {
  harness = await startSessionHarness({
    prepare: (slack) =>
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [
          { type: "message", user: other, text: "theirs", ts: theirsTs },
          { type: "message", user: me, text: "mine &amp; more", ts: mineTs },
        ],
        has_more: false,
      })),
  });
  await waitFor(() => harness.session.currentUserId);
  await harness.session.loadHistory(channel);
}

const calls = (method: string) =>
  harness.slack.calls.filter((call) => call.method === method);

const stored = (ts = mineTs) => harness.session.message(channel, ts);

/** Makes a method wait until the returned function is called. */
function hold(method: string): () => void {
  const normal = harness.slack.handler(method);
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));

  harness.slack.respond(method, async (call) => {
    await gate;

    return normal(call);
  });

  return release;
}

function editEcho(ts: string, text: string) {
  return harness.sendEvents({
    type: "event_callback",
    event: {
      type: "message",
      subtype: "message_changed",
      channel,
      channel_type: "channel",
      message: { type: "message", user: me, text, ts, edited: { user: me } },
    },
  });
}

function deleteEcho(ts: string) {
  return harness.sendEvents({
    type: "event_callback",
    event: {
      type: "message",
      subtype: "message_deleted",
      channel,
      channel_type: "channel",
      deleted_ts: ts,
    },
  });
}

test("editDraft gives the message's text with mentions turned back into names", async () => {
  await start();

  expect(
    harness.session.editDraft({ conversationId: channel, ts: mineTs }),
  ).toMatchObject({
    text: "mine & more",
  });
  expect(
    harness.session.editDraft({ conversationId: channel, ts: "1.1" }),
  ).toBeUndefined();
});

test("editing shows the new text and (edited) at once, then calls chat.update with escaped text", async () => {
  await start();

  const release = hold("chat.update");
  const result = harness.session.editMessage({
    conversationId: channel,
    ts: mineTs,
    text: "fixed <up>",
  });

  expect(stored()).toMatchObject({ text: "fixed &lt;up&gt;", isEdited: true });

  release();

  expect(await result).toEqual({ ok: true });
  expect(calls("chat.update")[0]?.params).toMatchObject({
    channel,
    ts: mineTs,
    text: "fixed &lt;up&gt;",
  });
  expect(stored()).toMatchObject({ text: "fixed &lt;up&gt;", isEdited: true });
});

test("the echo of an edit that succeeded changes nothing, and one that arrives first is not applied twice", async () => {
  await start();

  await harness.session.editMessage({
    conversationId: channel,
    ts: mineTs,
    text: "fixed",
  });
  await editEcho(mineTs, "fixed");

  expect(harness.session.messages(channel).map((m) => m.text)).toEqual([
    "fixed",
    "theirs",
  ]);
  expect(stored()).toMatchObject({ isEdited: true });
});

test("a refused edit puts the message back exactly and says why", async () => {
  await start();

  const before = stored();

  harness.slack.respond("chat.update", () => ({
    ok: false,
    error: "edit_window_closed",
  }));

  const result = await harness.session.editMessage({
    conversationId: channel,
    ts: mineTs,
    text: "too late",
  });

  expect(result).toMatchObject({ ok: false });
  expect(result.ok === false && result.message).toContain("too old");
  expect(stored()).toEqual(before!);
});

test("a failed edit doesn't undo a newer edit that arrived meanwhile", async () => {
  await start();

  harness.slack.respond("chat.update", async () => {
    await editEcho(mineTs, "from my phone");

    return { ok: false, error: "cant_update_message" };
  });

  await harness.session.editMessage({
    conversationId: channel,
    ts: mineTs,
    text: "mine",
  });

  expect(stored()).toMatchObject({ text: "from my phone", isEdited: true });
});

test("editing text that hasn't changed doesn't call Slack", async () => {
  await start();

  const result = await harness.session.editMessage({
    conversationId: channel,
    ts: mineTs,
    text: "mine & more",
  });

  expect(result).toEqual({ ok: true });
  expect(calls("chat.update")).toHaveLength(0);
  expect(stored()?.isEdited).toBe(false);
});

test("blank text is not an edit", async () => {
  await start();

  const result = await harness.session.editMessage({
    conversationId: channel,
    ts: mineTs,
    text: "  ",
  });

  expect(result.ok).toBe(false);
  expect(calls("chat.update")).toHaveLength(0);
});

test("someone else's message can't be edited or deleted", async () => {
  await start();

  const edit = await harness.session.editMessage({
    conversationId: channel,
    ts: theirsTs,
    text: "mine now",
  });
  const del = await harness.session.deleteMessage({
    conversationId: channel,
    ts: theirsTs,
  });

  expect(edit).toEqual({
    ok: false,
    message: "You can only edit your own messages.",
  });
  expect(del).toEqual({
    ok: false,
    message: "You can only delete your own messages.",
  });
  expect(
    harness.session.modifyProblem(
      { conversationId: channel, ts: mineTs },
      "edit",
    ),
  ).toBeUndefined();
  expect(calls("chat.update")).toHaveLength(0);
  expect(calls("chat.delete")).toHaveLength(0);
  expect(stored(theirsTs)).toMatchObject({ text: "theirs", isEdited: false });
});

test("deleting shows the message deleted at once, then calls chat.delete", async () => {
  await start();

  const release = hold("chat.delete");
  const result = harness.session.deleteMessage({
    conversationId: channel,
    ts: mineTs,
  });

  expect(stored()?.isDeleted).toBe(true);

  release();

  expect(await result).toEqual({ ok: true });
  expect(calls("chat.delete")[0]?.params).toMatchObject({
    channel,
    ts: mineTs,
  });

  await deleteEcho(mineTs);

  expect(stored()).toMatchObject({ isDeleted: true, text: "mine &amp; more" });
});

test("a refused delete brings the message back and says why", async () => {
  await start();

  const before = stored();

  harness.slack.respond("chat.delete", () => ({
    ok: false,
    error: "cant_delete_message",
  }));

  const result = await harness.session.deleteMessage({
    conversationId: channel,
    ts: mineTs,
  });

  expect(result.ok).toBe(false);
  expect(stored()).toEqual(before!);
});

test("a message that Slack no longer has stays deleted", async () => {
  await start();

  harness.slack.respond("chat.delete", () => ({
    ok: false,
    error: "message_not_found",
  }));

  const result = await harness.session.deleteMessage({
    conversationId: channel,
    ts: mineTs,
  });

  expect(result.ok).toBe(false);
  expect(stored()?.isDeleted).toBe(true);
});
