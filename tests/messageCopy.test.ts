import { afterEach, describe, expect, test } from "bun:test";
import { messageContent } from "../src/slack/convert/blocks";
import { clipboardSequence } from "../src/ui/clipboard";
import { messageCopyText } from "../src/ui/messageCopyText";
import { type AppHarness, keys, startAppHarness } from "./support/appHarness";
import { waitFor } from "./support/fakeSlack";
import { statusLine } from "./support/panes";

const copied = (raw: Record<string, unknown>) =>
  messageCopyText(messageContent(raw), {});

const plainText = (text: string) => ({ type: "plain_text", text });
const mrkdwn = (text: string) => ({ type: "mrkdwn", text });
const button = (text: string, extra: Record<string, unknown> = {}) => ({
  type: "button",
  text: plainText(text),
  ...extra,
});

describe("clipboardSequence", () => {
  test("is OSC 52 for the system clipboard with the text in base64", () => {
    expect(clipboardSequence("héllo 🎉")).toBe(
      `\u001b]52;c;${Buffer.from("héllo 🎉").toString("base64")}\u001b\\`,
    );
  });
});

describe("messageCopyText", () => {
  test("drops styling and keeps names, channels and emoji as shown", () => {
    expect(
      copied({
        text: "*Hi* <@U1|alice> in <#C1|general> :tada: `code` ~gone~ _it_",
      }),
    ).toBe("Hi @alice in #general 🎉 code gone it");
  });

  test("a link keeps its address after a label that differs from it", () => {
    expect(
      copied({ text: "see <https://example.com|the docs> and <https://x.io>" }),
    ).toBe("see the docs (https://example.com) and https://x.io");
  });

  test("quotes and code blocks lose their bar and indent but keep their lines", () => {
    expect(copied({ text: "> quoted\n```\n  indented\ncode\n```" })).toBe(
      "quoted\n  indented\ncode",
    );
  });

  test("line breaks and blank lines inside text are kept", () => {
    expect(copied({ text: "line one\nline two\n\nnew para" })).toBe(
      "line one\nline two\n\nnew para",
    );
  });

  test("lists keep their markers and nesting", () => {
    const section = (text: string) => ({
      type: "rich_text_section",
      elements: [{ type: "text", text }],
    });

    expect(
      copied({
        text: "",
        blocks: [
          {
            type: "rich_text",
            elements: [
              {
                type: "rich_text_list",
                style: "bullet",
                indent: 0,
                elements: [section("top"), section("next")],
              },
              {
                type: "rich_text_list",
                style: "ordered",
                indent: 1,
                elements: [section("nested")],
              },
            ],
          },
        ],
      }),
    ).toBe("• top\n• next\n  1. nested");
  });

  test("Block Kit: a line per block and per field, a divider as one blank line, no buttons", () => {
    expect(
      copied({
        text: "summary for notifications",
        blocks: [
          { type: "header", text: plainText("Deploy") },
          { type: "divider" },
          {
            type: "section",
            text: mrkdwn("*All* green"),
            fields: [mrkdwn("*Env:*\nprod"), plainText("Plain")],
            accessory: button("Approve"),
          },
          {
            type: "actions",
            elements: [button("Go", { url: "https://example.com" })],
          },
          { type: "divider" },
          { type: "divider" },
          { type: "context", elements: [mrkdwn("by bot")] },
        ],
      }),
    ).toBe("Deploy\n\nAll green\nEnv:\nprod\nPlain\n\nby bot");
  });

  test("attachments: pretext, then the text beside the bar, without the bar", () => {
    expect(
      copied({
        text: "Task created",
        attachments: [
          {
            color: "good",
            pretext: "Heads up",
            title: "Fix it",
            title_link: "https://example.com/t/1",
            text: "body",
            fields: [{ title: "Priority", value: "High", short: true }],
            footer: "Tracker",
          },
        ],
      }),
    ).toBe(
      "Task created\nHeads up\nFix it (https://example.com/t/1)\nbody\nPriority\nHigh\nTracker",
    );
  });

  test("attachment blocks leave out a row of buttons entirely", () => {
    expect(
      copied({
        text: "",
        attachments: [
          {
            blocks: [
              { type: "section", text: mrkdwn("in attachment") },
              { type: "actions", elements: [button("View")] },
            ],
          },
        ],
      }),
    ).toBe("in attachment");
  });

  test("a message with only files has no text", () => {
    expect(copied({ text: "", files: [{ name: "a.png" }] })).toBe("");
  });
});

describe("y in the panes", () => {
  let app: AppHarness | undefined;
  const clipboard: string[] = [];

  afterEach(async () => {
    await app?.stop();
    app = undefined;
    clipboard.length = 0;
  });

  const parentTs = "1600000000.000001";
  const filesTs = "1600000050.000001";
  const mineTs = "1600000100.000001";

  const parent = {
    type: "message",
    user: "U222222222",
    text: "the *parent* <https://example.com|link>",
    ts: parentTs,
    thread_ts: parentTs,
    reply_count: 1,
  };
  const reply = {
    type: "message",
    user: "U222222222",
    text: "> a quoted reply",
    ts: "1600000010.000001",
    thread_ts: parentTs,
  };
  const filesOnly = {
    type: "message",
    user: "U222222222",
    text: "",
    files: [{ id: "F1", name: "photo.png" }],
    ts: filesTs,
  };
  const mine = {
    type: "message",
    user: "U123ABC456",
    text: "my _own_ words",
    ts: mineTs,
  };

  async function start() {
    app = await startAppHarness({
      columns: 160,
      rows: 30,
      copyToClipboard: (text) => clipboard.push(text),
      prepare: (slack) => {
        slack.respond("conversations.history", () => ({
          ok: true,
          messages: [mine, filesOnly, parent],
          has_more: false,
        }));
        slack.respond("conversations.replies", () => ({
          ok: true,
          messages: [parent, reply],
          has_more: false,
        }));
      },
    });
    await app.waitForScreen("#general", 5000);
    await app.press(keys.enter);
    await app.waitForScreen("my own words");
    await waitFor(() => app!.session.currentUserId);
    await app.press(keys.tab);
  }

  const messageStatus = () => statusLine(app!.screen(), 32, 96);

  test("copies the selected message's text and says so", async () => {
    await start();
    await app!.press("y");

    expect(clipboard).toEqual(["my own words"]);
    expect(messageStatus()).toContain("Copied the message's text.");
  });

  test("copies the message moved to, not the newest", async () => {
    await start();
    await app!.press("k");
    await app!.press("k");
    await app!.press("y");

    expect(clipboard).toEqual(["the parent link (https://example.com)"]);
  });

  test("a message with no text copies nothing and says why", async () => {
    await start();
    await app!.press("k");
    await app!.press("y");

    expect(clipboard).toEqual([]);
    expect(messageStatus()).toContain("That message has no text to copy.");
  });

  test("copies the selected reply in the thread pane", async () => {
    await start();
    await app!.press("k");
    await app!.press("k");
    await app!.press(keys.enter);
    await app!.waitForScreen("a quoted reply");
    await app!.press("j");
    await app!.press("y");

    expect(clipboard).toEqual(["a quoted reply"]);
  });

  test("y still answers the delete prompt instead of copying", async () => {
    await start();
    await app!.press("d");
    await app!.press("y");
    await waitFor(() =>
      app!.slack.calls.find((call) => call.method === "chat.delete"),
    );

    expect(clipboard).toEqual([]);
  });
});
