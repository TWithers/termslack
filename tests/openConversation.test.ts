import { afterEach, expect, test } from "bun:test";
import { loadFixture, loadPayload } from "./support/fixtures";
import { waitFor } from "./support/fakeSlack";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";

let app: AppHarness;

afterEach(() => app.stop());

const general = "C012AB3CD";
const random = "C061EG9T2";

async function start(
  options: Parameters<typeof startAppHarness>[0] = {},
  ready = "@Peter Venkman",
) {
  const historyPages = await loadFixture("conversations-history");

  app = await startAppHarness({
    ...options,
    prepare: (slack) => {
      slack.respondPaged("conversations.history", historyPages);
      return options.prepare?.(slack);
    },
  });
  await app.waitForScreen(ready);
}

const historyCalls = (channel: string) =>
  app.slack.calls.filter(
    (call) =>
      call.method === "conversations.history" &&
      call.params.channel === channel,
  );

const lines = () => app.screen().split("\n");
const lineWith = (text: string) => lines().find((line) => line.includes(text));

/** The sidebar's part of the line mentioning `text` (the sidebar is a third of 100 columns, at most 32). */
const sidebarLineWith = (text: string) =>
  lines()
    .map((line) => line.slice(0, 32))
    .find((line) => line.includes(text));

/** The sidebar line carrying the selection marker. */
const selectedLine = () => lines().find((line) => line.includes("›"));

async function open(...presses: string[]) {
  for (const press of presses) {
    await app.press(press);
  }

  await app.press(keys.enter);
}

async function sendLive(overrides: Record<string, unknown>) {
  const payload = await loadPayload("message");

  return app.sendEvents({
    ...payload,
    event: { ...payload.event, channel: general, ...overrides },
  });
}

function clock(ts: string): string {
  return new Date(Number.parseFloat(ts) * 1000).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

test("the first conversation starts selected, and j/k and the arrow keys move the selection", async () => {
  await start();

  expect(selectedLine()).toContain("#general");

  await app.press("j");
  expect(selectedLine()).toContain("#random");

  await app.press(keys.down);
  expect(selectedLine()).toContain("Direct messages");

  await app.press(keys.down);
  expect(selectedLine()).toContain("@");

  await app.press(keys.up);
  await app.press(keys.up);
  expect(selectedLine()).toContain("#random");

  await app.press("k");
  expect(selectedLine()).toContain("#general");
});

test("the selection stops at the first and last line", async () => {
  await start();

  await app.press("k");
  await app.press("k");
  await app.press("k");
  expect(selectedLine()).toContain("Channels");

  for (let i = 0; i < 10; i++) {
    await app.press("j");
  }

  expect(selectedLine()).toContain("@stantz");

  await app.press(keys.down);
  expect(selectedLine()).toContain("@stantz");
});

test("moving the selection doesn't open anything", async () => {
  await start();

  await app.press("j");

  expect(app.screen()).toContain("No conversation open");
  expect(
    app.slack.calls.some((c) => c.method === "conversations.history"),
  ).toBe(false);
});

test("Enter opens the conversation and shows its history oldest to newest", async () => {
  await start();

  await open();
  await app.waitForScreen("What, you want to smell my shoes better?");

  const screen = app.screen();

  expect(screen).not.toContain("No conversation open");
  expect(historyCalls(general)).toHaveLength(1);

  const order = [
    "Deploy finished",
    "@Peter Venkman any plans for the weekend?",
    "What, you want to smell my shoes better?",
  ].map((text) => screen.indexOf(text));

  expect(order.every((at) => at >= 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
});

test("each message shows its time and text, under its author", async () => {
  await start();
  await open();
  await app.waitForScreen("any plans for the weekend?");

  const line = lineWith("any plans for the weekend?")!;

  expect(line).toContain(clock("1512100000.000300"));
  expect(lineWith("egon")).toBeDefined();
  expect(lineWith("deploybot")).toBeDefined();
  expect(lineWith("Deploy finished")).toContain(clock("1512090000.000200"));
});

test("the selected and open conversations are both marked in the sidebar", async () => {
  await start();
  await open("j");
  await app.waitForScreen("What, you want");
  await app.press("k");

  expect(sidebarLineWith("#general")).toContain("›");
  expect(sidebarLineWith("#general")).not.toContain("▌");
  expect(sidebarLineWith("#random")).toContain("▌");
  expect(sidebarLineWith("#random")).not.toContain("›");
});

test("a loading indicator shows while history loads", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const [first] = await loadFixture("conversations-history");

  await start({
    prepare: (slack) =>
      slack.respond("conversations.history", async () => {
        await gate;

        return first!;
      }),
  });

  await open();
  await app.waitForScreen("Loading");

  expect(app.screen()).not.toContain("Deploy finished");

  release();

  await app.waitForScreen("Deploy finished");
  expect(app.screen()).not.toContain("Loading");
});

test("a failed history load says so, and opening again retries", async () => {
  let failing = true;
  const [first] = await loadFixture("conversations-history");

  await start({
    prepare: (slack) =>
      slack.respond("conversations.history", () =>
        failing ? { ok: false, error: "channel_not_found" } : first!,
      ),
  });

  await open();
  await app.waitForScreen("channel_not_found");

  expect(app.screen()).toMatch(/couldn't load/i);
  expect(app.screen()).not.toContain("Loading");

  failing = false;
  await open();
  await app.waitForScreen("Deploy finished");

  expect(app.screen()).not.toContain("channel_not_found");
});

test("an empty conversation says it has no messages", async () => {
  await start({
    prepare: (slack) =>
      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [],
        has_more: false,
      })),
  });

  await open();
  await app.waitForScreen("No messages");
});

test("reopening a conversation doesn't load its history again", async () => {
  await start();

  await open();
  await app.waitForScreen("Deploy finished");
  await open("j");
  await app.waitForScreen("What, you want");
  await open("k");

  expect(app.screen()).toContain("Deploy finished");

  await open("j");

  expect(historyCalls(general)).toHaveLength(1);
  expect(historyCalls(random)).toHaveLength(1);
});

test("mentions, channels, broadcasts, links and emoji are rendered like the log renders them", async () => {
  await start({ columns: 160 });
  await open();
  await app.waitForScreen("Deploy finished");

  await sendLive({
    ts: "1600000001.000100",
    text: "hi <@U222222222> in <#C061EG9T2|random> <!here> see <https://example.com|docs> :tada: &amp; &lt;ok&gt;",
  });

  const line = await app
    .waitForScreen("@Peter Venkman in #random")
    .then(() => lineWith("@Peter Venkman in #random")!);

  expect(line).toContain("@here");
  expect(line).toContain("docs (https://example.com)");
  expect(line).toContain("🎉");
  expect(line).toContain("& <ok>");
  expect(line).not.toContain("<@U222222222>");
});

test("messages with only attachments, blocks or files show the fallback text and file names", async () => {
  await start();
  await open();
  await app.waitForScreen("Deploy finished");

  const rich = await loadPayload("message-rich-text");
  const files = await loadPayload("message-file-share-no-text");
  const bare = await loadPayload("message-attachment-no-fallback");

  for (const payload of [rich, files, bare]) {
    await app.sendEvents({
      ...payload,
      event: { ...payload.event, channel: general },
    });
  }

  await app.waitForScreen("[files: Untitled photo]");

  expect(app.screen()).toContain("ping @Peter Venkman see the docs");
  expect(app.screen()).toContain("Image: https://example.com/chart.png");
});

test("new messages in the open conversation appear at the bottom, and other conversations leave the pane alone", async () => {
  await start();
  await open();
  await app.waitForScreen("Deploy finished");

  await sendLive({ ts: "1600000002.000100", text: "fresh news" });
  await app.waitForScreen("fresh news");

  const screen = app.screen();

  expect(screen.indexOf("fresh news")).toBeGreaterThan(
    screen.indexOf("What, you want"),
  );

  await sendLive({
    channel: random,
    ts: "1600000003.000100",
    text: "elsewhere",
  });
  await Bun.sleep(40);

  expect(app.screen()).not.toContain("elsewhere");
});

test("thread replies stay out of the pane, broadcast replies show", async () => {
  await start();
  await open();
  await app.waitForScreen("Deploy finished");

  await sendLive({
    ts: "1600000004.000100",
    thread_ts: "1512100000.000300",
    text: "quiet reply",
  });
  await sendLive({
    ts: "1600000005.000100",
    thread_ts: "1512100000.000300",
    subtype: "thread_broadcast",
    text: "loud reply",
  });
  await app.waitForScreen("loud reply");

  expect(app.screen()).not.toContain("quiet reply");
});

test("an edit updates the message in place and marks it edited", async () => {
  await start();
  await open();
  await app.waitForScreen("Deploy finished");

  const changed = await loadPayload("message-changed");

  await app.sendEvents({
    ...changed,
    event: {
      ...changed.event,
      channel: general,
      message: {
        ...changed.event.message,
        user: "U222222222",
        ts: "1512104434.000490",
        text: "Smelling is believing",
      },
    },
  });
  await app.waitForScreen("Smelling is believing");

  expect(app.screen()).not.toContain("smell my shoes");
  expect(lineWith("Smelling is believing")).toContain("(edited)");
  expect(lineWith("Smelling is believing")).toContain(
    clock("1512104434.000490"),
  );
  expect(lineWith("Deploy finished")).not.toContain("(edited)");
});

test("a deleted message disappears, and a deletion of one we never saw leaves no tombstone", async () => {
  await start();
  await open();
  await app.waitForScreen("Deploy finished");

  const deleted = await loadPayload("message-deleted");

  await app.sendEvents({
    ...deleted,
    event: {
      ...deleted.event,
      channel: general,
      deleted_ts: "1512090000.000200",
    },
  });
  await waitFor(() => !app.screen().includes("Deploy finished"));

  await app.sendEvents({
    ...deleted,
    event: {
      ...deleted.event,
      channel: general,
      deleted_ts: "1111111111.000100",
    },
  });
  await Bun.sleep(40);

  expect(app.screen()).toContain("What, you want");
  expect(app.screen()).not.toMatch(/deleted/i);
  expect(app.screen()).not.toContain("[no text]");
});

test("long messages wrap inside the pane and the newest message stays in view", async () => {
  await start({ columns: 60, rows: 15 });
  await open();
  await app.waitForScreen("Deploy finished");

  const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");

  await sendLive({ ts: "1600000006.000100", text: long });
  await app.waitForScreen("word39");

  for (const line of lines()) {
    expect(Bun.stringWidth(line)).toBeLessThanOrEqual(60);
  }

  expect(lines()).toHaveLength(15);

  await sendLive({ ts: "1600000007.000100", text: "the very newest" });
  await app.waitForScreen("the very newest");
});

test("the selection scrolls the sidebar to stay visible in a short terminal", async () => {
  await start({ columns: 60, rows: 5 }, "#general");

  expect(lines()).toHaveLength(5);

  for (let i = 0; i < 10; i++) {
    await app.press("j");
  }

  expect(selectedLine()).toContain("@stantz");

  for (let i = 0; i < 10; i++) {
    await app.press("k");
  }

  expect(selectedLine()).toContain("Channels");
});

test("a group DM shows who is in it without waiting for an event", async () => {
  await start();

  await app.waitForScreen("@Peter Venkman, stantz");

  expect(app.screen()).not.toContain("@G0AKFJBEU");
});
