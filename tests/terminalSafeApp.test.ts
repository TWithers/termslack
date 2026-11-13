import { afterEach, expect, test } from "bun:test";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import { waitFor } from "./support/fakeSlack";

let app: AppHarness;

afterEach(() => app.stop());

const general = "C012AB3CD";
const me = "U123ABC456";
const ts = "1762286400.000100";
const columns = 100;
const undrawable = /[\u{1F3FB}-\u{1F3FF}‍]/u;

async function start() {
  app = await startAppHarness({
    columns,
    rows: 30,
    prepare: (slack) =>
      slack.respondPaged("conversations.history", [
        {
          ok: true,
          messages: [
            {
              type: "message",
              user: "U222222222",
              text: "nice 👍🏽 family 👨‍👩‍👧 and :+1::skin-tone-3: and :man-woman-girl:",
              ts,
              reactions: [
                { name: "+1", users: ["U222222222"], count: 2 },
                { name: "+1::skin-tone-2", users: [me], count: 1 },
              ],
            },
          ],
          has_more: false,
        },
      ]),
  });
  await app.waitForScreen("#general", 5000);
  await app.press(keys.enter);
  await app.waitForScreen("nice", 5000);
  await waitFor(() => app.session.currentUserId);
}

const calls = (method: string) =>
  app.slack.calls.filter((call) => call.method === method);

test("rows never hold a skin tone or joiner and never measure wider than the screen", async () => {
  await start();
  await app.press("i");
  await app.press("a 👍🏻 typed 🧑‍💻");

  const lines = app.screen().replaceAll("\u00a0", " ").split("\n");

  expect(lines.join("\n")).toContain("👍 2");
  expect(lines.join("\n")).toContain("a 👍 typed 🧑💻");
  expect(lines.join("\n")).toContain("👨👩👧");

  for (const frame of app.frames()) {
    expect(frame).not.toMatch(undrawable);
  }

  for (const line of lines) {
    expect(Bun.stringWidth(line)).toBeLessThanOrEqual(columns);
  }
});

test("the emoji prompt offers its completions without skin tones", async () => {
  await start();
  await app.press(keys.tab);
  await app.press("r");
  await app.press("wave");
  await app.waitForScreen(":wave:");

  expect(app.screen()).not.toMatch(undrawable);
});

test("toggling your own skin-toned reaction still removes and adds it by its Slack name", async () => {
  await start();
  await app.press(keys.tab);
  await app.press("r");
  await app.press(":+1::skin-tone-2:");

  expect(app.screen()).toContain("Enter removes");

  await app.press(keys.enter);
  await waitFor(() => calls("reactions.remove").length > 0);

  expect(calls("reactions.remove")[0]?.params).toMatchObject({
    timestamp: ts,
    name: "+1::skin-tone-2",
  });

  await app.press(keys.tab);
});

test("adding a skin-toned reaction sends its Slack name", async () => {
  await start();
  await app.press(keys.tab);
  await app.press("r");
  await app.press(":+1::skin-tone-4:");
  await app.press(keys.enter);
  await waitFor(() => calls("reactions.add").length > 0);

  expect(calls("reactions.add")[0]?.params).toMatchObject({
    name: "+1::skin-tone-4",
  });
});
