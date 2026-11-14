import { afterEach, expect, test } from "bun:test";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import { waitFor } from "./support/fakeSlack";
import { paneInputLines } from "./support/panes";

let app: AppHarness;

afterEach(() => app.stop());

const general = "C012AB3CD";
const me = "U123ABC456";

const altEnter = "\x1b\r";
const ctrlJ = "\n";
const shiftEnterKitty = "\x1b[13;2u";

const postCalls = () =>
  app.slack.calls.filter((call) => call.method === "chat.postMessage");

/** Opens #general and moves focus to the input with `i`, so the next keys type. */
async function start(options: Parameters<typeof startAppHarness>[0] = {}) {
  app = await startAppHarness({
    columns: 100,
    rows: 24,
    ...options,
    prepare: (slack) => {
      slack.respond("conversations.history", (call) => ({
        ok: true,
        messages:
          call.params.channel === general
            ? [
                {
                  type: "message",
                  user: "U222222222",
                  text: "earlier",
                  ts: "1600000000.000001",
                },
              ]
            : [],
        has_more: false,
      }));

      return options.prepare?.(slack);
    },
  });
  await app.waitForScreen("#general", 5000);
  await app.press(keys.enter);
  await app.waitForScreen("earlier");
  await waitFor(() => app.session.currentUserId);
}

/** The input's lines: the rows under the divider. */
const inputLines = () => paneInputLines(app.screen());

const statusLine = () => app.screen().split("\n").at(-1) ?? "";

test("i jumps to the input; letters, even shortcuts like q and j, are typed there", async () => {
  await start();
  expect(app.screen()).toContain("Message #general");

  await app.press("i");
  await app.press("quick j");

  expect(inputLines()).toEqual(["quick j"]);
  expect(app.screen()).not.toContain("Message #general");
  expect(statusLine()).toContain("Enter send");
});

test("Tab cycles sidebar, messages, input, and Esc goes back to the messages", async () => {
  await start();

  await app.press(keys.tab);
  expect(statusLine()).toContain("j/k select");

  await app.press(keys.tab);
  expect(statusLine()).toContain("Enter send");

  await app.press(keys.escape);
  expect(statusLine()).toContain("j/k select");

  await app.press("i");
  expect(statusLine()).toContain("Enter send");

  await app.press(keys.tab);
  expect(statusLine()).not.toContain("Enter send");
  expect(statusLine()).not.toContain("j/k select");
});

test("i does nothing while no conversation is open", async () => {
  app = await startAppHarness();
  await app.waitForScreen("#general", 5000);
  await app.press("i");

  expect(app.screen()).toContain("No conversation open");
  expect(app.screen()).not.toContain("Enter send");
});

test("Alt+Enter, Ctrl+J and Shift+Enter (kitty) insert newlines and the box grows", async () => {
  await start();
  await app.press("i");

  await app.press("one");
  await app.press(altEnter);
  await app.press("two");
  await app.press(ctrlJ);
  await app.press("three");
  await app.press(shiftEnterKitty);
  await app.press("four");

  expect(inputLines()).toEqual(["one", "two", "three", "four"]);
  expect(postCalls()).toHaveLength(0);
});

test("the box stops growing after a few lines and scrolls to the cursor", async () => {
  await start();
  await app.press("i");

  for (const word of ["a", "b", "c", "d", "e", "f", "g"]) {
    await app.press(word);
    await app.press(altEnter);
  }

  const lines = inputLines();

  expect(lines.length).toBeLessThanOrEqual(5);
  expect(lines.at(-1)?.trim()).toBe("");
  expect(lines.join("")).toContain("g");
  expect(lines.join("")).not.toContain("a");
});

test("the cursor moves and edits inside the text", async () => {
  await start();
  await app.press("i");
  await app.press("helo");
  await app.press(keys.left);
  await app.press("l");
  await app.press(keys.right);
  await app.press("\x7f");
  await app.press("!");
  await app.press(keys.enter);

  await waitFor(() => postCalls().length === 1);
  expect(postCalls()[0]?.params.text).toBe("hell!");
});

test("Enter sends: the message shows as pending, then normally, once", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));

  await start({
    prepare: (slack) => {
      const normal = slack.handler("chat.postMessage");

      slack.respond("chat.postMessage", async (call) => {
        await gate;

        return normal(call);
      });
    },
  });
  await app.press("i");
  await app.press("hi there");
  await app.press(keys.enter);

  await app.waitForScreen("hi there");
  expect(inputLines()).toEqual([""]);
  expect(postCalls()[0]?.params).toMatchObject({
    channel: general,
    text: "hi there",
  });

  // Pending: dimmed.
  expect(app.session.messages(general).at(-1)?.delivery).toBe("pending");

  release();
  await waitFor(
    () => app.session.messages(general).at(-1)?.delivery === undefined,
  );

  const echoSeen = app.session.messages(general).at(-1)!.ts;

  await app.sendEvents({
    type: "event_callback",
    event: {
      type: "message",
      channel: general,
      channel_type: "channel",
      user: me,
      text: "hi there",
      ts: echoSeen,
    },
  });

  expect(app.screen().match(/hi there/g)).toHaveLength(1);
});

test("& < > are escaped and blank messages aren't sent", async () => {
  await start();
  await app.press("i");

  await app.press("  ");
  await app.press(altEnter);
  await app.press(keys.enter);
  expect(postCalls()).toHaveLength(0);

  await app.press("a & b <c>");
  await app.press(keys.enter);

  await waitFor(() => postCalls().length === 1);
  expect(postCalls()[0]?.params.text).toBe("a &amp; b &lt;c&gt;");
  await app.waitForScreen("a & b <c>");
});

test("a failed send says why in the status bar and puts the text back", async () => {
  await start({
    prepare: (slack) =>
      slack.respond("chat.postMessage", () => ({
        ok: false,
        error: "not_in_channel",
      })),
  });
  await app.press("i");
  await app.press("hello");
  await app.press(keys.enter);

  await app.waitForScreen("can't write to it");
  expect(inputLines()).toEqual(["hello"]);
  expect(app.screen()).toContain("(not sent)");
});

test("a missing scope is explained", async () => {
  await start({
    prepare: (slack) =>
      slack.respond("chat.postMessage", () => ({
        ok: false,
        error: "missing_scope",
        needed: "chat:write",
      })),
  });
  await app.press("i");
  await app.press("hello");
  await app.press(keys.enter);

  const screen = await app.waitForScreen("chat:write");

  expect(screen).toContain("setup");
});

test("a draft stays with its conversation when switching away and back", async () => {
  await start();
  await app.press("i");
  await app.press("unfinished");
  await app.press(keys.tab);
  await app.press("j");
  await app.press(keys.enter);
  await app.waitForScreen("No messages yet");

  expect(inputLines()).toEqual(["Message #random"]);

  await app.press("k");
  await app.press(keys.enter);
  await app.waitForScreen("earlier");

  expect(inputLines()).toEqual(["unfinished"]);
});
