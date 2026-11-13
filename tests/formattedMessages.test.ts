import { afterEach, expect, test } from "bun:test";
import { conversationRows } from "../src/ui/app/paneRows";
import { theme } from "../src/ui/theme";
import { waitFor } from "./support/fakeSlack";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";

let app: AppHarness;

afterEach(() => app.stop());

const general = "C012AB3CD";
const ts = "1762286400.000100";

type Raw = Record<string, unknown>;

async function start(message: Raw, columns = 100) {
  app = await startAppHarness({
    columns,
    rows: 30,
    prepare: (slack) =>
      slack.respondPaged("conversations.history", [
        {
          ok: true,
          messages: [{ type: "message", user: "U222222222", ts, ...message }],
          has_more: false,
        },
      ]),
  });
  await app.waitForScreen("#general", 5000);
  await app.press(keys.enter);
  await waitFor(() => rows().length > 0, 5000);
}

const rows = (width = 100) =>
  conversationRows(app.session, general, width).rows.filter(
    (row) => row.kind === "message",
  );
const textOf = (row: { runs: { text: string }[] }) =>
  row.runs.map((run) => run.text).join("");

const run = (row: ReturnType<typeof rows>[number], text: string) =>
  row.runs.find((candidate) => candidate.text === text);

test("mrkdwn styles show as terminal styles, and the markers are gone", async () => {
  await start({ text: "a *bold* _it_ ~gone~ `code` <https://x.test/a_b_c|l>" });
  await app.waitForScreen("bold", 5000);

  const [row] = rows();

  expect(app.screen()).not.toContain("*bold*");
  expect(run(row!, "bold")?.bold).toBe(true);
  expect(run(row!, "it")?.italic).toBe(true);
  expect(run(row!, "gone")?.strikethrough).toBe(true);
  expect(run(row!, "code")).toMatchObject({
    color: theme.inlineCodeText,
    backgroundColor: theme.inlineCodeBackground,
  });
  expect(run(row!, "l")?.underline).toBe(true);
});

test("a code block keeps its lines and indentation in the code colour", async () => {
  await start({
    text: "see:\n```\nif (*x*) {\n    go();\n}\n```\nthen *done*",
  });
  await app.waitForScreen("then", 5000);

  const lines = rows().map(textOf);

  expect(lines.some((line) => line.endsWith("      if (*x*) {"))).toBe(true);
  expect(lines.some((line) => line.endsWith("          go();"))).toBe(true);

  const code = rows().find((row) => textOf(row).includes("go();"))!;

  expect(code.runs.at(-1)).toMatchObject({
    color: theme.codeBlockText,
    backgroundColor: theme.codeBlockBackground,
  });
});

test("long code lines wrap to the pane width without joining lines", async () => {
  await start({ text: `\`\`\`\n${"x".repeat(60)}\nshort\n\`\`\`` }, 60);
  await app.waitForScreen("short", 5000);

  const all = rows(40);

  expect(all.length).toBe(3);
  expect(textOf(all.at(-1)!).trim()).toBe("short");

  for (const row of all) {
    expect(Bun.stringWidth(textOf(row))).toBeLessThanOrEqual(40);
  }
});

test("quotes get a bar on every line, and lists get markers with aligned continuation", async () => {
  await start({
    text: "&gt; quoted *line*\n- one\n  - nested item that is long enough to wrap onto a second line\n2. two",
  });
  await app.waitForScreen("quoted", 5000);

  const lines = rows(40).map(textOf);
  const body = lines.map((line) => line.slice(8));

  expect(body[0]).toBe("▎ quoted line");
  expect(body).toContain("• one");
  expect(body.some((line) => line.startsWith("  ◦ nested item"))).toBe(true);
  expect(body.some((line) => /^ {4}\S/.test(line))).toBe(true);
  expect(body).toContain("2. two");

  const keysSeen = rows(40).map((row) => row.key);

  expect(new Set(keysSeen).size).toBe(keysSeen.length);
  expect(keysSeen[1]).toBe(`${ts}:1`);
});

test("rich_text blocks look the same as the text they came from", async () => {
  await start({
    text: "ignored summary",
    blocks: [
      {
        type: "rich_text",
        elements: [
          {
            type: "rich_text_section",
            elements: [
              { type: "text", text: "hi ", style: { bold: true } },
              { type: "user", user_id: "U222222222" },
              { type: "text", text: " " },
              { type: "emoji", name: "tada" },
            ],
          },
          {
            type: "rich_text_list",
            style: "ordered",
            indent: 0,
            elements: [
              {
                type: "rich_text_section",
                elements: [{ type: "text", text: "first" }],
              },
              {
                type: "rich_text_section",
                elements: [
                  { type: "text", text: "second", style: { code: true } },
                ],
              },
            ],
          },
          {
            type: "rich_text_quote",
            elements: [{ type: "text", text: "wise words" }],
          },
        ],
      },
    ],
  });
  await app.waitForScreen("wise words", 5000);

  const lines = rows().map((row) => textOf(row).slice(8));

  expect(app.screen()).not.toContain("ignored summary");
  expect(lines[0]).toMatch(/^hi @[\w ]+ 🎉$/);
  expect(lines.slice(1)).toEqual(["1. first", "2. second", "▎ wise words"]);
  expect(run(rows()[0]!, "hi ")?.bold).toBe(true);
  expect(run(rows()[2]!, "second")?.color).toBe(theme.inlineCodeText);
});

test("a formatted message keeps its reactions and reply count below the body", async () => {
  await start({
    text: "- a\n- b",
    reply_count: 2,
    reactions: [{ name: "tada", users: ["U1"], count: 1 }],
  });
  await app.waitForScreen("2 replies", 5000);

  expect(
    conversationRows(app.session, general, 100).rows.map((row) => row.kind),
  ).toEqual([
    "daySeparator",
    "authorHeader",
    "message",
    "message",
    "reactions",
    "replyCount",
  ]);
});
