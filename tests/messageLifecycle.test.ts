import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { logSession } from "../src/ui/eventLog";
import { loadFixture } from "./support/fixtures";
import {
  type SessionHarness,
  startSessionHarness,
} from "./support/sessionHarness";

let harness: SessionHarness;
let lines: string[];
let spy: ReturnType<typeof spyOn>;

beforeEach(() => {
  lines = [];
  spy = spyOn(console, "log").mockImplementation((line: string) => {
    lines.push(line);
  });
});

afterEach(async () => {
  await harness.stop();
  spy.mockRestore();
});

const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "");
const lastLine = () => plain(lines.at(-1) ?? "");
const channel = "C123ABC456";

async function userResponse(id: string, displayName: string) {
  const [response] = await loadFixture("users-info");

  return {
    ...response,
    user: {
      ...response?.user,
      id,
      profile: { ...response?.user.profile, display_name: displayName },
    },
  };
}

/** A session where U123ABC456 is "spengler" and U222222222 is "egon". */
async function start(options: Parameters<typeof startSessionHarness>[0] = {}) {
  const people = {
    U123ABC456: await userResponse("U123ABC456", "spengler"),
    U222222222: await userResponse("U222222222", "egon"),
  };

  harness = await startSessionHarness({
    ...options,
    prepare: (slack) =>
      slack.respond("users.info", (call) => {
        const response = people[call.params.user as keyof typeof people];

        return response ?? { ok: false, error: "user_not_found" };
      }),
  });

  logSession(harness.session, false);
}

/** Sends every payload of a fixture, in order. */
async function sendFixture(name: string) {
  for (const payload of await loadFixture(name)) {
    await harness.sendEvents(payload);
  }
}

async function sendMessage(overrides: Record<string, unknown>) {
  const [payload] = await loadFixture("message");

  return harness.sendEvents({
    ...payload,
    event: { ...payload?.event, ...overrides },
  });
}

test("the store records messages per conversation, keyed by ts", async () => {
  await start();
  await sendMessage({ ts: "2.000000", text: "second" });
  await sendMessage({ ts: "1.000000", text: "first" });
  await sendMessage({ ts: "3.000000", text: "elsewhere", channel: "C0OTHER" });

  expect(
    harness.session.messages(channel).map((message) => message.text),
  ).toEqual(["first", "second"]);
  expect(harness.session.message(channel, "2.000000")).toMatchObject({
    channelId: channel,
    userId: "U123ABC456",
    text: "second",
    isEdited: false,
    isDeleted: false,
  });
  expect(harness.session.message(channel, "9.000000")).toBeUndefined();
  expect(harness.session.messages("C0NONE")).toEqual([]);
});

test("an edit shows the new rendered text marked as edited and updates the store", async () => {
  await start();
  await sendMessage({ ts: "1355517523.000005", text: "Hello world" });
  await harness.sendEvents({
    event: {
      type: "message",
      subtype: "message_changed",
      channel,
      ts: "1358878755.000001",
      message: {
        user: "U123ABC456",
        text: "Hello <@U222222222>",
        ts: "1355517523.000005",
      },
    },
  });

  expect(lastLine()).toMatch(
    / message +C123ABC456 spengler edited: Hello @egon$/,
  );
  expect(harness.session.message(channel, "1355517523.000005")).toMatchObject({
    text: "Hello <@U222222222>",
    isEdited: true,
  });
});

test("an edit of a message the store hasn't seen is stored with its new text", async () => {
  await start();
  await sendFixture("message-changed");

  expect(harness.session.message(channel, "1355517523.000005")).toMatchObject({
    text: "Hello, world!",
    userId: "U123ABC456",
    isEdited: true,
  });
});

test("an edit that leaves only attachments shows their fallback", async () => {
  await start();
  await sendFixture("message-changed-blocks");

  expect(lastLine()).toMatch(/spengler edited: Edited fallback text$/);
});

test("a delete shows who wrote the message and a snippet, and marks it deleted", async () => {
  await start();
  await sendMessage({
    ts: "1358878749.000002",
    text: "Hello   world\nsecond line",
  });
  await sendFixture("message-deleted");

  expect(lastLine()).toMatch(
    / message +C123ABC456 deleted message by spengler: "Hello world second line"$/,
  );
  expect(harness.session.message(channel, "1358878749.000002")).toMatchObject({
    isDeleted: true,
    text: "Hello   world\nsecond line",
  });
});

test("a delete of an unknown message uses what Slack sent, else just the ts", async () => {
  await start();
  await sendFixture("message-deleted-previous");

  expect(lastLine()).toMatch(
    / message +#C123ABC456 deleted message by egon: "oops wrong channel"$/,
  );

  await harness.sendEvents({
    event: {
      type: "message",
      subtype: "message_deleted",
      channel,
      ts: "9.000001",
      deleted_ts: "9.000000",
    },
  });

  expect(lastLine()).toMatch(/ message +C123ABC456 message 9.000000 deleted$/);
});

test("a long snippet is cut short", async () => {
  await start();
  await sendMessage({ ts: "1358878749.000002", text: "x".repeat(200) });
  await sendFixture("message-deleted");

  expect(lastLine()).toMatch(/: "x{39}…"$/);
});

test("a reply shows a reply label with the parent's author and snippet", async () => {
  await start();
  await sendFixture("thread-reply");

  expect(lastLine()).toMatch(
    /#C123ABC456 egon ↳ reply to spengler \("Anyone seen the @egon deploy plan\?"\): yes, it's in the wiki$/,
  );
  expect(
    harness.session
      .threadReplies(channel, "1673464730.703009")
      .map((message) => message.ts),
  ).toEqual(["1673464745.620769"]);
  expect(
    harness.session.messages(channel).map((message) => message.ts),
  ).toEqual(["1673464730.703009"]);
});

test("a reply to an unknown parent says reply in thread", async () => {
  await start();

  const [, reply] = await loadFixture("thread-reply");

  await harness.sendEvents(reply!);

  expect(lastLine()).toMatch(/egon ↳ reply in thread: yes, it's in the wiki$/);
  expect(
    harness.session.threadReplies(channel, "1673464730.703009"),
  ).toHaveLength(1);
});

test("a broadcast reply is a reply in the channel list too", async () => {
  await start();
  await sendFixture("thread-broadcast");

  expect(lastLine()).toMatch(/↳ reply in thread: broadcasting this reply$/);
  expect(harness.session.messages(channel).map((m) => m.ts)).toEqual([
    "1673464745.620769",
  ]);
});

test("editing and deleting a reply updates it in its thread", async () => {
  await start();
  await sendFixture("thread-reply");
  await harness.sendEvents({
    event: {
      type: "message",
      subtype: "message_changed",
      channel,
      ts: "5.5",
      message: {
        user: "U222222222",
        text: "edited reply",
        ts: "1673464745.620769",
        thread_ts: "1673464730.703009",
      },
    },
  });

  const [reply] = harness.session.threadReplies(channel, "1673464730.703009");

  expect(reply).toMatchObject({ text: "edited reply", isEdited: true });
});

test("a message with only attachments shows their plain-text fallback", async () => {
  await start();
  await sendFixture("message-attachments");

  expect(lastLine()).toMatch(
    /spengler: Required plain-text summary of the attachment\.$/,
  );
  expect(harness.session.messages(channel)[0]?.fallbackText).toBe(
    "Required plain-text summary of the attachment.",
  );
});

test("an attachment without a fallback falls back to its text, then a placeholder", async () => {
  await start();
  await sendFixture("message-attachment-no-fallback");

  expect(lastLine()).toMatch(/spengler: \[no text\]$/);
});

test("a Block Kit message shows its text, with mentions rendered", async () => {
  await start();
  await sendFixture("message-blocks");

  expect(lastLine()).toMatch(
    /egon: Deploy finished \*All\* green, thanks @egon \*Env:\* production took 3 minutes$/,
  );
});

test("a rich text message shows its text, mentions, links and emoji", async () => {
  await start();
  await sendFixture("message-rich-text");

  expect(lastLine()).toMatch(
    /egon: ping @egon see the docs \(https:\/\/example\.com\) 🎉$/,
  );
});

test("blocks with no text show a placeholder", async () => {
  await start();
  await sendFixture("message-blocks-empty");

  expect(lastLine()).toMatch(/egon: \[no text\]$/);
});

test("a file share shows the file names", async () => {
  await start();
  await sendFixture("message-file-share");

  expect(lastLine()).toMatch(
    /egon: @egon uploaded a file: .*\[files: report\.pdf, chart\.png\]$/,
  );
  expect(lastLine()).not.toContain("(file_share)");
  expect(harness.session.messages(channel)[0]?.files).toEqual([
    "report.pdf",
    "chart.png",
  ]);
});

test("a file without a name uses its title, and nothing else needs a placeholder", async () => {
  await start();
  await sendFixture("message-file-share-no-text");

  expect(lastLine()).toMatch(/egon: \[files: Untitled photo\]$/);
});

test("a reaction names who reacted, what, and the message when it's stored", async () => {
  await start();
  await sendMessage({ ts: "1360782400.498405", text: "Hello world" });
  await sendFixture("reaction-added");

  expect(lastLine()).toMatch(
    /reaction_added +C123ABC456 spengler \+👍 on spengler: "Hello world"$/,
  );
});

test("a reaction on an unknown message shows its ts", async () => {
  await start();
  await sendFixture("reaction-added");

  expect(lastLine()).toMatch(
    /reaction_added +C123ABC456 spengler \+👍 on 1360782400\.498405$/,
  );
});

test("an unhandled subtype shows its text and the subtype", async () => {
  await start();
  await sendFixture("message-subtype-unknown");

  expect(lastLine()).toMatch(
    /spengler \(channel_topic\): set the channel topic: Deploy freeze until Monday$/,
  );
  expect(harness.session.messages(channel)[0]?.subtype).toBe("channel_topic");
});

test("malformed message payloads never throw", async () => {
  await start();

  for (const event of [
    { type: "message", channel, ts: "1.1", text: "x", attachments: "nope" },
    {
      type: "message",
      channel,
      ts: "1.2",
      text: "x",
      blocks: [null, 1, { type: "section", text: 5 }],
    },
    {
      type: "message",
      channel,
      ts: "1.3",
      text: "x",
      files: [null, { name: 5 }],
    },
    { type: "message", subtype: "message_deleted", channel },
    { type: "message", subtype: "message_changed", channel },
  ]) {
    await harness.sendEvents({ event });
  }

  expect(harness.session.messages(channel).length).toBeGreaterThan(0);
});

test("the store keeps a bounded number of messages per conversation, dropping the oldest", async () => {
  const cap = 5;

  await start({ maxMessagesPerConversation: cap });

  for (let index = 1; index <= cap + 3; index++) {
    await sendMessage({ ts: `${index}.000000`, text: `m${index}` });
  }

  const kept = harness.session.messages(channel);

  expect(kept).toHaveLength(cap);
  expect(kept[0]?.ts).toBe("4.000000");
  expect(kept.at(-1)?.ts).toBe(`${cap + 3}.000000`);
});
