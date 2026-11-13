import { afterEach, expect, test } from "bun:test";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import { waitFor } from "./support/fakeSlack";

let app: AppHarness;

afterEach(() => app.stop());

const general = "C012AB3CD";
const mineTs = "1600000100.000001";
const theirsTs = "1600000050.000001";

const everyScope = [
  "identify",
  "channels:history",
  "chat:write",
  "reactions:write",
];

/** Opens #general with fake Slack granting `scopes` (or reporting none when undefined). */
async function start(scopes?: string[]) {
  app = await startAppHarness({
    columns: 160,
    rows: 30,
    prepare: (slack) => {
      if (scopes) {
        slack.grantScopes(scopes);
      }

      slack.respond("conversations.history", () => ({
        ok: true,
        messages: [
          { type: "message", user: "U123ABC456", text: "my words", ts: mineTs },
          {
            type: "message",
            user: "U222222222",
            text: "their words",
            ts: theirsTs,
          },
        ],
        has_more: false,
      }));
    },
  });
  await app.waitForScreen("#general", 5000);
  await app.press(keys.enter);
  await app.waitForScreen("my words");
  await waitFor(() => app.session.currentUserId);
}

const calls = (method: string) =>
  app.slack.calls.filter((call) => call.method === method);

const withoutScope = (scope: string) => everyScope.filter((s) => s !== scope);

test("the session says which feature a missing scope turns off", async () => {
  await start(withoutScope("chat:write"));

  expect(app.session.scopeProblem("write")).toContain("chat:write");
  expect(app.session.scopeProblem("react")).toBeUndefined();
});

test("nothing is turned off when the scopes are granted or unknown", async () => {
  await start(everyScope);
  expect(app.session.scopeProblem("write")).toBeUndefined();
  expect(app.session.scopeProblem("react")).toBeUndefined();
  await app.stop();

  await start();
  expect(app.session.scopeProblem("write")).toBeUndefined();
  expect(app.session.scopeProblem("react")).toBeUndefined();
});

test("without chat:write nothing reaches Slack: send, edit and delete are refused up front", async () => {
  await start(withoutScope("chat:write"));

  const sent = await app.session.sendMessage({
    conversationId: general,
    text: "hello",
  });
  const edited = await app.session.editMessage({
    conversationId: general,
    ts: mineTs,
    text: "changed",
  });
  const deleted = await app.session.deleteMessage({
    conversationId: general,
    ts: mineTs,
  });

  for (const result of [sent, edited, deleted]) {
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toContain("chat:write");
  }

  expect(calls("chat.postMessage")).toHaveLength(0);
  expect(calls("chat.update")).toHaveLength(0);
  expect(calls("chat.delete")).toHaveLength(0);
  expect(app.session.message(general, mineTs)?.text).toBe("my words");
});

test("without reactions:write a reaction is refused up front and changes nothing", async () => {
  await start(withoutScope("reactions:write"));

  const result = await app.session.addReaction({
    conversationId: general,
    ts: theirsTs,
    name: "tada",
  });

  expect(result.ok).toBe(false);
  expect(result.ok ? "" : result.message).toContain("reactions:write");
  expect(calls("reactions.add")).toHaveLength(0);
  expect(app.session.message(general, theirsTs)?.reactions ?? []).toEqual([]);
});

test("without chat:write the input explains itself and takes no text", async () => {
  await start(withoutScope("chat:write"));
  await app.waitForScreen("chat:write");

  await app.press("i");
  await app.press("hello");
  await app.press(keys.enter);

  expect(app.screen()).not.toContain("hello");
  expect(calls("chat.postMessage")).toHaveLength(0);

  await app.press(keys.escape);
  await app.press("e");

  expect(app.screen()).not.toContain("Editing");
});

test("without reactions:write r explains and opens no prompt", async () => {
  await start(withoutScope("reactions:write"));
  await app.press(keys.tab);
  await app.press("r");

  expect(app.screen()).toContain("reactions:write");
  expect(app.screen()).not.toContain("Enter react");
});

test("with every scope the input takes text as before", async () => {
  await start(everyScope);
  await app.press("i");
  await app.press("hello");

  expect(app.screen()).toContain("hello");
});
