import { afterEach, expect, test } from "bun:test";
import { waitFor } from "./support/fakeSlack";
import { loadPayload } from "./support/fixtures";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";

let app: AppHarness;

afterEach(() => app.stop());

const general = "C012AB3CD";
const egon = "U123ABC456";
const venkman = "U222222222";

/** Wednesday, Nov 4 2026, mid-afternoon, local time. */
const now = new Date(2026, 10, 4, 15, 0);

/** A Slack `ts` for a local date and time; months are 1-based. */
function at(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): string {
  const date = new Date(year, month - 1, day, hour, minute, second);
  const seconds = date.getTime() / 1000;

  return `${seconds}.000100`;
}

const today = (hour: number, minute: number, second = 0) =>
  at(2026, 11, 4, hour, minute, second);

type Raw = Record<string, unknown>;

function say(user: string, text: string, ts: string, extra: Raw = {}): Raw {
  return { type: "message", user, text, ts, ...extra };
}

/** Starts the app with `messages` (oldest first) as #general's history, in `pageSize` pages. */
async function start(messages: Raw[], pageSize = 100) {
  const newestFirst = [...messages].reverse();
  const pages: Raw[] = [];

  for (let at = 0; at < newestFirst.length; at += pageSize) {
    const more = at + pageSize < newestFirst.length;

    pages.push({
      ok: true,
      messages: newestFirst.slice(at, at + pageSize),
      has_more: more,
      response_metadata: { next_cursor: more ? `after-${at}` : "" },
    });
  }

  app = await startAppHarness({
    columns: 100,
    rows: 30,
    now: () => now,
    prepare: (slack) => slack.respondPaged("conversations.history", pages),
  });
  await app.waitForScreen("#general", 5000);
  await app.press(keys.enter);
  await app.waitForScreen(/\d\d:\d\d /, 5000);
}

const paneLines = () =>
  app
    .screen()
    .split("\n")
    .map((line) => line.slice(33).replace(/ *│$/, ""));

/** How many lines are exactly `text`, as an author header or a separator is. */
const count = (text: string | RegExp) =>
  paneLines().filter((line) =>
    typeof text === "string" ? line.trim() === text : text.test(line),
  ).length;

const lineWith = (text: string) =>
  paneLines().find((line) => line.includes(text));

const historyCalls = () =>
  app.slack.calls.filter((call) => call.method === "conversations.history");

const headers = (name: string) => count(name);

async function sendLive(overrides: Raw) {
  const payload = await loadPayload("message");

  return app.sendEvents({
    ...payload,
    event: { ...payload.event, channel: general, ...overrides },
  });
}

test("messages from one author close together share a single author line", async () => {
  await start([
    say(egon, "first", today(10, 0)),
    say(egon, "second", today(10, 3)),
    say(egon, "third", today(10, 7)),
  ]);

  expect(headers("egon")).toBe(1);
  expect(lineWith("first")).toContain("10:00");
  expect(lineWith("second")).toContain("10:03");
  expect(lineWith("third")).toContain("10:07");
  expect(lineWith("first")).not.toContain("egon");
});

test("a message under a group is indented below the author line", async () => {
  await start([say(egon, "hello", today(10, 0))]);

  const lines = paneLines();
  const header = lines.findIndex((line) => line.trim() === "egon");

  expect(lines[header + 1]).toMatch(/^\s+10:00 hello$/);
  expect(lines[header]!.search(/\S/)).toBeLessThan(
    lines[header + 1]!.search(/\S/),
  );
});

test("a different author starts a new group, and returning to the first author does too", async () => {
  await start([
    say(egon, "one", today(10, 0)),
    say(venkman, "two", today(10, 1)),
    say(egon, "three", today(10, 2)),
  ]);

  expect(headers("egon")).toBe(2);
  expect(headers("Peter Venkman")).toBe(1);
});

test("a gap of more than five minutes starts a new group, five minutes does not", async () => {
  await start([
    say(egon, "a", today(10, 0, 0)),
    say(egon, "b", today(10, 5, 0)),
    say(egon, "c", today(10, 10, 1)),
  ]);

  expect(headers("egon")).toBe(2);

  const lines = paneLines();
  const second = lines.findIndex((line) => line.trim() === "egon");

  expect(lines.slice(second).join("\n")).toMatch(
    /egon\n\s+10:00 a\n\s+10:05 b/,
  );
});

test("the window is measured from the previous message, so a steady chat stays in one group", async () => {
  await start(
    [0, 4, 8, 12, 16].map((minute) =>
      say(egon, `m${minute}`, today(10, minute)),
    ),
  );

  expect(headers("egon")).toBe(1);
});

test("bot messages group by bot, apart from people and other bots", async () => {
  const bot = (name: string, text: string, ts: string) =>
    say("", text, ts, {
      user: undefined,
      subtype: "bot_message",
      bot_id: `B${name}`,
      username: name,
    });

  await start([
    bot("deploybot", "build 1", today(10, 0)),
    bot("deploybot", "build 2", today(10, 1)),
    bot("alertbot", "alert", today(10, 2)),
    say(egon, "hi", today(10, 3)),
  ]);

  expect(headers("deploybot")).toBe(1);
  expect(headers("alertbot")).toBe(1);
  expect(headers("egon")).toBe(1);
});

test("a wrapped message keeps its continuation lines under the text", async () => {
  const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");

  await start([say(egon, long, today(10, 0))]);

  const lines = paneLines();
  const first = lines.findIndex((line) => line.includes("10:00 word0"));

  expect(lines[first]!.indexOf("word0")).toBe(lines[first + 1]!.search(/\S/));
  expect(Bun.stringWidth(lines[first + 1]!)).toBeLessThanOrEqual(67);
});

test("days are separated, with Today and Yesterday, weekday dates, and the year for other years", async () => {
  await start([
    say(egon, "ancient", at(2025, 12, 24, 9, 0)),
    say(egon, "older", at(2026, 11, 2, 9, 0)),
    say(egon, "yesterday", at(2026, 11, 3, 23, 59)),
    say(egon, "today", at(2026, 11, 4, 0, 1)),
  ]);

  expect(count(/Wednesday, Dec 24, 2025/)).toBe(1);
  expect(count(/Monday, Nov 2 ──/)).toBe(1);
  expect(count(/Yesterday/)).toBe(1);
  expect(count(/Today/)).toBe(1);

  const screen = app.screen();
  const order = [
    "Dec 24, 2025",
    "ancient",
    "Nov 2",
    "older",
    "Yesterday",
    "yesterday",
    "Today",
    "today",
  ].map((text) => screen.indexOf(text));

  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(order.every((at) => at >= 0)).toBe(true);
});

test("messages on the same day have one separator, and a new day starts a new group even within the window", async () => {
  await start([
    say(egon, "late", at(2026, 11, 3, 23, 58)),
    say(egon, "early", at(2026, 11, 4, 0, 1)),
    say(egon, "later", at(2026, 11, 4, 0, 2)),
  ]);

  expect(count(/Today/)).toBe(1);
  expect(count(/Yesterday/)).toBe(1);
  expect(headers("egon")).toBe(2);
});

test("thread parents show their reply count from history", async () => {
  await start([
    say(egon, "plain", today(9, 0)),
    say(egon, "parent one", today(10, 0), {
      thread_ts: today(10, 0),
      reply_count: 1,
    }),
    say(venkman, "parent many", today(11, 0), {
      thread_ts: today(11, 0),
      reply_count: 12,
    }),
  ]);

  expect(count(/\b1 reply\b/)).toBe(1);
  expect(count(/\b12 replies\b/)).toBe(1);
  expect(count(/repl(y|ies)/)).toBe(2);

  const lines = paneLines();

  expect(lines.findIndex((line) => line.includes("1 reply"))).toBe(
    lines.findIndex((line) => line.includes("parent one")) + 1,
  );
});

test("thread replies from history stay out of the pane, broadcast replies stay in", async () => {
  await start([
    say(egon, "parent", today(10, 0), {
      thread_ts: today(10, 0),
      reply_count: 2,
    }),
    say(venkman, "quiet reply", today(10, 1), { thread_ts: today(10, 0) }),
    say(venkman, "loud reply", today(10, 2), {
      thread_ts: today(10, 0),
      subtype: "thread_broadcast",
    }),
  ]);

  expect(app.screen()).not.toContain("quiet reply");
  expect(app.screen()).toContain("loud reply");
  expect(count(/2 replies/)).toBe(1);
});

test("a live reply raises the parent's reply count", async () => {
  await start([
    say(egon, "parent", today(10, 0), {
      thread_ts: today(10, 0),
      reply_count: 1,
    }),
    say(egon, "no thread yet", today(10, 1)),
  ]);

  await sendLive({
    user: venkman,
    text: "reply!",
    ts: today(10, 2),
    thread_ts: today(10, 0),
  });
  await app.waitForScreen("2 replies");

  expect(app.screen()).not.toContain("reply!");

  await sendLive({
    user: venkman,
    text: "again",
    ts: today(10, 3),
    thread_ts: today(10, 0),
  });
  await app.waitForScreen("3 replies");
});

test("the first live reply to a message gives it a reply count", async () => {
  await start([say(egon, "starts a thread", today(10, 0))]);

  await sendLive({
    user: venkman,
    text: "reply",
    ts: today(10, 1),
    thread_ts: today(10, 0),
  });
  await app.waitForScreen("1 reply");
});

test("a message delivered twice counts once", async () => {
  await start([
    say(egon, "parent", today(10, 0), {
      thread_ts: today(10, 0),
      reply_count: 1,
    }),
  ]);

  const reply = {
    user: venkman,
    text: "reply",
    ts: today(10, 1),
    thread_ts: today(10, 0),
  };

  await sendLive(reply);
  await app.waitForScreen("2 replies");
  await sendLive(reply);
  await Bun.sleep(60);

  expect(count(/2 replies/)).toBe(1);
  expect(count(/3 replies/)).toBe(0);
});

test("loading an older page joins a group across the page boundary and keeps one separator per day", async () => {
  const messages = Array.from({ length: 60 }, (_, i) =>
    say(egon, `msg ${String(i).padStart(2, "0")}`, today(8, 0, i)),
  );

  await start(messages, 40);
  await app.press(keys.tab);
  await app.press("g");
  await waitFor(() => historyCalls().length === 2);
  await Bun.sleep(60);
  await app.press("g");

  const lines = paneLines();

  expect(lines.join("\n")).toContain("msg 00");
  expect(count(/Today/)).toBe(1);
  expect(headers("egon")).toBe(1);
});

test("older messages that start a new group above leave the visible lines where they are", async () => {
  const older = Array.from({ length: 30 }, (_, i) =>
    say(venkman, `old ${String(i).padStart(2, "0")}`, at(2026, 11, 3, 9, 0, i)),
  );
  const newer = Array.from({ length: 30 }, (_, i) =>
    say(egon, `new ${String(i).padStart(2, "0")}`, today(9, 0, i)),
  );

  await start([...older, ...newer], 30);
  await app.press(keys.tab);
  await app.press("g");

  const before = paneLines().filter((line) => /new \d\d/.test(line));

  await waitFor(() => historyCalls().length === 2);
  await Bun.sleep(60);

  expect(paneLines().filter((line) => /new \d\d/.test(line))).toEqual(before);

  await app.press("k");

  const lines = paneLines();
  const lastOld = lines.findIndex((line) => line.includes("old 29"));

  expect(lines[lastOld + 1]).toContain("Today");

  await app.press("g");
  await Bun.sleep(60);

  expect(count(/Yesterday/)).toBe(1);
  expect(headers("Peter Venkman")).toBe(1);
});

test("deleting the first message of a group moves the author line to the next", async () => {
  await start(
    [
      say(egon, "keep me", today(10, 1)),
      say(egon, "delete me", today(10, 0)),
    ].reverse(),
  );

  const deleted = await loadPayload("message-deleted");

  await app.sendEvents({
    ...deleted,
    event: {
      ...deleted.event,
      channel: general,
      deleted_ts: today(10, 0),
    },
  });
  await app.waitForScreen("keep me").then(() => Bun.sleep(40));

  expect(app.screen()).not.toContain("delete me");

  const lines = paneLines();
  const header = lines.findIndex((line) => line.trim() === "egon");

  expect(headers("egon")).toBe(1);
  expect(lines[header + 1]).toContain("keep me");
});

test("deleting the only message of a day removes its separator, and deleting between two groups merges them", async () => {
  await start([
    say(egon, "friday", at(2026, 10, 30, 10, 0)),
    say(egon, "left", today(10, 0)),
    say(venkman, "between", today(10, 1)),
    say(egon, "right", today(10, 2)),
  ]);

  expect(headers("egon")).toBe(3);

  const deleted = await loadPayload("message-deleted");

  for (const ts of [at(2026, 10, 30, 10, 0), today(10, 1)]) {
    await app.sendEvents({
      ...deleted,
      event: { ...deleted.event, channel: general, deleted_ts: ts },
    });
  }

  await Bun.sleep(80);

  expect(app.screen()).not.toContain("friday");
  expect(count(/Friday/)).toBe(0);
  expect(headers("egon")).toBe(1);
  expect(headers("Peter Venkman")).toBe(0);
});

test("editing a message keeps the group and marks it edited", async () => {
  await start([say(egon, "one", today(10, 0)), say(egon, "two", today(10, 1))]);

  const changed = await loadPayload("message-changed");

  await app.sendEvents({
    ...changed,
    event: {
      ...changed.event,
      channel: general,
      message: {
        ...changed.event.message,
        user: egon,
        ts: today(10, 1),
        text: "two, revised",
      },
    },
  });
  await app.waitForScreen("two, revised");

  expect(lineWith("two, revised")).toContain("(edited)");
  expect(headers("egon")).toBe(1);
});

test("a new live message joins the last group while following", async () => {
  await start([say(egon, "one", today(10, 0))]);
  await sendLive({ user: egon, text: "two", ts: today(10, 2) });
  await app.waitForScreen("two");

  expect(headers("egon")).toBe(1);
});
