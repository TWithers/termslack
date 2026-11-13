import { afterEach, expect, test } from "bun:test";
import { conversationRows } from "../src/ui/app/paneRows";
import { legibleColour } from "../src/ui/authorColour";
import { theme } from "../src/ui/theme";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import { waitFor } from "./support/fakeSlack";
import { loadPayload } from "./support/fixtures";

let app: AppHarness;

afterEach(() => app.stop());

const general = "C012AB3CD";

type Raw = Record<string, unknown>;

async function start(messages: Raw[], columns = 100) {
  app = await startAppHarness({
    columns,
    rows: 40,
    prepare: (slack) =>
      slack.respondPaged("conversations.history", [
        { ok: true, messages: [...messages].reverse(), has_more: false },
      ]),
  });
  await app.waitForScreen("#general", 5000);
  await app.press(keys.enter);
  await waitFor(
    () => conversationRows(app.session, general, 100).rows.length > 2,
    5000,
  );
}

const messageRows = (width = 100) =>
  conversationRows(app.session, general, width).rows.filter(
    (row) => row.kind === "message",
  );
const textOf = (row: { runs: { text: string }[] }) =>
  row.runs.map((run) => run.text).join("");
const body = (width = 100) =>
  messageRows(width).map((row) => textOf(row).slice(8));

async function signupMessage(overrides: Raw = {}) {
  const { event } = await loadPayload("message-attachment-signup");

  return {
    ...event,
    ts: "1762286400.000400",
    channel: undefined,
    channel_type: undefined,
    ...overrides,
  };
}

test("a signup bot message shows the summary once, then a green bar with the title and a two-column grid", async () => {
  await start([await signupMessage()]);
  await app.waitForScreen("Converted_At", 5000);

  const lines = body();

  expect(app.screen()).toContain("Signup Bot");
  expect(lines[0]).toBe("New Account");
  expect(lines[1]).toBe("▌ New Account - Signup Form");
  expect(lines[2]).toMatch(/^▌ User\.id\s{2,}User\.name$/);
  expect(lines[3]).toMatch(/^▌ 101\s{2,}Jane Example$/);
  expect(lines[4]).toMatch(/^▌ User\.email\s+Company\.id$/);
  expect(lines[5]).toMatch(/^▌ jane@example\.com\s+202$/);
  expect(lines.at(-2)).toMatch(/^▌ Type$/);
  expect(lines.at(-1)).toBe("▌ initial");
  expect(
    lines.filter((line) => line.includes("New Account")),
  ).toHaveLength(2);
  expect(app.screen()).not.toContain("https://example.com/admin");
});

test("the bar is drawn in the attachment colour and the field titles are bold", async () => {
  await start([await signupMessage()]);
  await app.waitForScreen("Converted_At", 5000);

  const [, title, fieldTitles, fieldValues] = messageRows();
  const bars = messageRows().slice(1);

  expect(title!.runs.find((run) => run.text === "▌ ")?.color).toBe("#2eb886");
  expect(bars.every((row) => row.runs.some((run) => run.text === "▌ "))).toBe(
    true,
  );
  expect(fieldTitles!.runs.find((run) => run.text === "User.id")?.bold).toBe(
    true,
  );
  expect(fieldValues!.runs.find((run) => run.text === "101")).toMatchObject({
    underline: true,
  });
});

test("fields stack in one column when the pane is narrow", async () => {
  await start([await signupMessage()], 60);
  await app.waitForScreen("Converted_At", 5000);

  const lines = body(32);

  expect(lines.slice(0, 8)).toEqual([
    "New Account",
    "▌ New Account - Signup",
    "▌ Form",
    "▌ User.id",
    "▌ 101",
    "▌ User.name",
    "▌ Jane Example",
    "▌ User.email",
  ]);

  for (const row of messageRows(32)) {
    expect(Bun.stringWidth(textOf(row))).toBeLessThanOrEqual(32 + 8);
  }
});

test("named colours map to theme colours", async () => {
  await start([
    {
      user: "U222222222",
      ts: "1762286401.000100",
      attachments: [
        { color: "danger", title: "Broke" },
        { color: "warning", title: "Careful" },
        { color: "good", title: "Fine" },
        { title: "Plain" },
      ],
    },
  ]);
  await app.waitForScreen("Plain", 5000);

  expect(
    messageRows().map(
      (row) => row.runs.find((run) => run.text === "▌ ")?.color,
    ),
  ).toEqual([
    theme.attachmentDangerBar,
    theme.attachmentWarningBar,
    theme.attachmentGoodBar,
    theme.attachmentBar,
  ]);
});

test("a colour Slack gives an attachment is kept when it reads on the pane, else made legible", async () => {
  await start([
    {
      user: "U222222222",
      ts: "1762286401.000100",
      attachments: [
        { color: "#36a64f", title: "Bright" },
        { color: "#1a1d21", title: "Hidden" },
        { color: "not-a-colour", title: "Odd" },
      ],
    },
  ]);
  await app.waitForScreen("Odd", 5000);

  const bars = messageRows().map(
    (row) => row.runs.find((run) => run.text === "▌ ")?.color,
  );

  expect(bars[0]).toBe("#36a64f");
  expect(bars[1]).toBe(legibleColour("#1a1d21"));
  expect(bars[1]).not.toBe("#1a1d21");
  expect(bars[2]).toBe(theme.attachmentBar);
});

test("Block Kit blocks show headers, sections with fields, context, dividers, images and button labels", async () => {
  await start([
    {
      user: "U222222222",
      ts: "1762286402.000100",
      text: "Deploy finished (summary)",
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "Deploy finished" },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: "*All* green" },
          fields: [
            { type: "mrkdwn", text: "*Env:*\nproduction" },
            { type: "mrkdwn", text: "*Region:*\neu-west" },
          ],
        },
        { type: "divider" },
        {
          type: "image",
          image_url: "https://example.com/graph.png",
          alt_text: "Graph",
        },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: "took 3 minutes" }],
        },
        {
          type: "actions",
          elements: [
            { type: "button", text: { type: "plain_text", text: "Approve" } },
            { type: "button", text: { type: "plain_text", text: "Deny" } },
          ],
        },
      ],
    },
  ]);
  await app.waitForScreen("[Approve]", 5000);

  const lines = body();

  expect(lines[0]).toBe("Deploy finished");
  expect(lines[1]).toBe("All green");
  expect(lines[2]).toMatch(/^Env:\s+Region:$/);
  expect(lines[3]).toMatch(/^production\s+eu-west$/);
  expect(lines[4]).toBe("─".repeat(30));
  expect(lines[5]).toBe("Graph (https://example.com/graph.png)");
  expect(lines[6]).toBe("took 3 minutes");
  expect(lines[7]).toBe("[Approve] [Deny]");
  expect(app.screen()).not.toContain("(summary)");
  expect(
    messageRows()[0]!.runs.find((run) => run.text === "Deploy finished")?.bold,
  ).toBe(true);
  expect(
    messageRows()[6]!.runs.every(
      (run) =>
        run.text === "" ||
        run.color === theme.blockKitContextText ||
        run.color === theme.timestampText ||
        run.text === " " ||
        /^\d\d:\d\d$/.test(run.text) ||
        run.text.trim() === "",
    ),
  ).toBe(true);
});

test("rich messages keep unique row keys, reactions and the edited marker, and group with their neighbours", async () => {
  await start([
    await signupMessage({ reactions: [{ name: "tada", users: ["U1"], count: 1 }] }),
    await signupMessage({ ts: "1762286401.000400" }),
  ]);
  await app.waitForScreen("Converted_At", 5000);

  const rows = conversationRows(app.session, general, 100).rows;
  const keysSeen = rows.map((row) => row.key);

  expect(new Set(keysSeen).size).toBe(keysSeen.length);
  expect(rows.filter((row) => row.kind === "authorHeader")).toHaveLength(1);
  expect(rows.filter((row) => row.kind === "reactions")).toHaveLength(1);
  expect(rows.filter((row) => row.kind === "message")).toHaveLength(2 * 12);
});

test("blocks with unknown types or junk do not break the pane", async () => {
  await start([
    {
      user: "U222222222",
      ts: "1762286403.000100",
      text: "fallback text",
      blocks: [{ type: "future_block", mystery: 1 }, null, 7],
      attachments: ["junk", { fields: 4 }],
    },
  ]);
  await app.waitForScreen("fallback text", 5000);

  expect(body()).toEqual(["fallback text"]);
});
