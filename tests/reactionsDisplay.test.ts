import { afterEach, expect, test } from "bun:test";
import { conversationRows } from "../src/ui/app/paneRows";
import { theme } from "../src/ui/theme";
import { waitFor } from "./support/fakeSlack";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";

let app: AppHarness;

afterEach(() => app.stop());

const general = "C012AB3CD";
const me = "U123ABC456";
const ts = "1762286400.000100";

type Raw = Record<string, unknown>;

async function start(reactions: Raw[] | undefined, columns = 100) {
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
              text: "ship it",
              ts,
              reactions,
            },
          ],
          has_more: false,
        },
      ]),
  });
  await app.waitForScreen("#general", 5000);
  await app.press(keys.enter);
  await app.waitForScreen("ship it", 5000);
}

const pane = () =>
  app
    .screen()
    .replaceAll(" ", " ")
    .split("\n")
    .map((line) => line.slice(33).replace(/ *│$/, ""));

const screenText = () => app.screen().replaceAll("\u00a0", " ");

function waitForPane(text: string) {
  return waitFor(() => screenText().includes(text), 5000);
}

function react(action: "added" | "removed", user: string, name: string) {
  return app.sendEvents({
    event: {
      type: `reaction_${action}`,
      user,
      reaction: name,
      item: { type: "message", channel: general, ts },
      event_ts: "1.1",
    },
  });
}

test("reactions show under their message as emoji and count, in first-seen order", async () => {
  await start([
    { name: "tada", users: ["U1"], count: 1 },
    { name: "thumbsup", users: ["U1", "U2", "U3"], count: 3 },
  ]);

  const lines = pane();
  const message = lines.findIndex((line) => line.includes("ship it"));

  expect(lines[message + 1]).toMatch(/^\s+🎉 1  👍 3$/);
});

test("custom and unknown reactions show as shortcodes, skin tones as the base emoji", async () => {
  await start([
    { name: "partyparrot", users: ["U1"], count: 2 },
    { name: "+1::skin-tone-2", users: ["U1"], count: 1 },
  ]);

  expect(pane().some((line) => /^\s+:partyparrot: 2  👍 1$/.test(line))).toBe(
    true,
  );
});

test("a message without reactions has no reaction line", async () => {
  await start([]);

  const lines = pane();
  const message = lines.findIndex((line) => line.includes("ship it"));

  expect(lines[message + 1]?.trim().startsWith("╭")).toBe(true);
});

test("live adds and removes update the counts, and the last removal clears the line", async () => {
  await start([{ name: "tada", users: ["U1"], count: 1 }]);

  await react("added", "U2", "tada");
  await waitForPane("🎉 2");

  await react("added", "U2", "heart");
  await waitForPane("🎉 2  ❤️ 1");

  await react("removed", "U1", "tada");
  await react("removed", "U2", "tada");
  await waitForPane("❤️ 1");

  expect(screenText()).not.toContain("🎉");

  await react("removed", "U2", "heart");
  await Bun.sleep(50);

  expect(screenText()).not.toContain("❤️");
});

test("reactions on a message that isn't stored don't throw and the log line still prints", async () => {
  await start([]);

  const event = await app.sendEvents({
    event: {
      type: "reaction_added",
      user: me,
      reaction: "tada",
      item: { type: "message", channel: general, ts: "9.9" },
      event_ts: "1.1",
    },
  });

  expect(event).toMatchObject({ kind: "reaction", messageTs: "9.9" });
});

test("the user's own reactions are marked, others are not", async () => {
  await start([
    { name: "tada", users: ["U1", me], count: 2 },
    { name: "heart", users: ["U1"], count: 1 },
  ]);

  const [reactionRow] = conversationRows(app.session, general, 100).rows.filter(
    (row) => row.kind === "reactions",
  );
  const marked = (text: string) =>
    reactionRow?.runs.find((run) => run.text.includes(text))
      ?.backgroundColor === theme.ownReactionBackground;

  expect(marked("🎉")).toBe(true);
  expect(marked("❤️")).toBe(false);

  await react("added", me, "heart");
  await waitForPane("❤️ 2");

  const [after] = conversationRows(app.session, general, 100).rows.filter(
    (row) => row.kind === "reactions",
  );

  expect(
    after?.runs.find((run) => run.text.includes("❤️"))?.backgroundColor,
  ).toBe(theme.ownReactionBackground);
});

test("reactions wrap onto more rows without splitting an emoji from its count", async () => {
  await start(
    ["tada", "heart", "thumbsup", "eyes", "fire"].map((name) => ({
      name,
      users: ["U1"],
      count: 12,
    })),
  );

  const rows = conversationRows(app.session, general, 24).rows.filter(
    (row) => row.kind === "reactions",
  );

  expect(rows.length).toBeGreaterThan(1);
  expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);

  for (const row of rows) {
    expect(row.runs.map((run) => run.text).join("")).toMatch(/\S 12/);
  }
});
