import { describe, expect, test } from "bun:test";
import type { ContentBlock, StyledSegment } from "../src/session/content";
import { renderMessageBody } from "../src/session/messageText";
import { messageContent } from "../src/slack/convert/blocks";
import { loadPayload } from "./support/fixtures";

type Block = ContentBlock<StyledSegment>;
type Raw = Record<string, any>;

const plain = (segments: StyledSegment[]) =>
  segments.map((segment) => segment.text).join("");

function lines(block: Block): string[] {
  switch (block.kind) {
    case "divider":
      return ["---"];
    case "fields":
      return block.fields.map((field) => field.blocks.flatMap(lines).join("|"));
    case "attachment":
      return [...block.pretext, ...block.blocks].flatMap(lines);
    case "list":
      return block.items.map(plain);
    default:
      return [plain(block.inline)];
  }
}

const shownLines = (raw: Raw) =>
  renderMessageBody(messageContent(raw), {}).flatMap(lines);

const attachmentOf = (raw: Raw) =>
  renderMessageBody(messageContent(raw), {}).find(
    (block) => block.kind === "attachment",
  );

describe("legacy attachments", () => {
  test("show pretext, author, title, text, fields, images and footer in order", () => {
    const raw = {
      text: "",
      attachments: [
        {
          fallback: "fallback",
          color: "#36a64f",
          pretext: "Before the bar",
          author_name: "Bobby Tables",
          author_link: "https://example.com/bobby",
          title: "Slack API",
          title_link: "https://example.com/api",
          text: "Some *bold* text",
          fields: [
            { title: "Priority", value: "High", short: true },
            { title: "Notes", value: "Long value", short: false },
          ],
          image_url: "https://example.com/chart.png",
          thumb_url: "https://example.com/thumb.png",
          footer: "Slack API",
          ts: 123456789,
        },
      ],
    };
    const [attachment] = renderMessageBody(messageContent(raw), {});

    expect(attachment).toMatchObject({ kind: "attachment", color: "#36a64f" });
    expect(shownLines(raw)).toEqual([
      "Before the bar",
      "Bobby Tables",
      "Slack API",
      "Some bold text",
      "Priority|High",
      "Notes|Long value",
      "Image: https://example.com/chart.png",
      "Thumbnail: https://example.com/thumb.png",
      "Slack API · 1973-11-29 21:33 UTC",
    ]);
  });

  test("the title is a link when the attachment has a title link, and mrkdwn applies", () => {
    const [attachment] = renderMessageBody(
      messageContent({
        attachments: [
          {
            title: "Docs",
            title_link: "https://example.com/docs",
            text: "*bold*",
          },
        ],
      }),
      {},
    );

    expect(attachment).toMatchObject({
      kind: "attachment",
      blocks: [
        {
          kind: "paragraph",
          inline: [
            {
              kind: "link",
              text: "Docs",
              url: "https://example.com/docs",
              style: { bold: true },
            },
          ],
        },
        {
          kind: "paragraph",
          inline: [{ text: "bold", style: { bold: true } }],
        },
      ],
    });
  });

  test("short fields are two-column candidates and long ones are wide", () => {
    const attachment = attachmentOf({
      attachments: [
        {
          fields: [
            { title: "A", value: "1", short: true },
            { title: "B", value: "2" },
          ],
        },
      ],
    });

    expect(attachment).toMatchObject({
      blocks: [
        {
          kind: "fields",
          fields: [{ wide: false }, { wide: true }],
        },
      ],
    });
  });

  test.each([
    ["good", "good"],
    ["warning", "warning"],
    ["danger", "danger"],
    ["#2EB886", "#2eb886"],
    ["2eb886", "#2eb886"],
    ["nonsense", undefined],
  ])("colour %s is read as %s", (color, expected) => {
    const attachment = attachmentOf({
      attachments: [{ color, title: "x" }],
    });

    expect(attachment).toMatchObject({ kind: "attachment" });
    expect((attachment as { color?: string }).color).toBe(expected);
  });

  test("an attachment with nothing to show contributes no block", () => {
    const content = messageContent({
      text: "",
      attachments: [{ id: 1, fallback: "only a fallback" }, "nope", null, 4],
    });

    expect(content.body).toBeUndefined();
    expect(content.fallbackText).toBe("only a fallback");
    expect(renderMessageBody(content, {})).toMatchObject([
      { kind: "paragraph" },
    ]);
  });

  test("malformed attachments and fields never throw", () => {
    expect(() =>
      messageContent({
        attachments: [
          { title: 4, fields: "x", color: 7, ts: "soon", footer: {} },
          { fields: [null, 3, { title: {}, value: [] }, { value: "v" }] },
        ],
      }),
    ).not.toThrow();
  });
});

describe("summary text that repeats the attachment", () => {
  const attachment = {
    fallback: "New Account",
    title: "New Account - Signup Form",
  };

  test("is dropped when it equals the fallback, ignoring case, spacing and markup", () => {
    expect(
      shownLines({ text: "*new  account*", attachments: [attachment] }),
    ).toEqual(["New Account - Signup Form"]);
  });

  test("is dropped when it equals the title or the pretext", () => {
    expect(
      shownLines({
        text: "Pretext here",
        attachments: [{ pretext: "Pretext here", title: "T" }],
      }),
    ).toEqual(["Pretext here", "T"]);
  });

  test("is kept, above the attachment, when it says something else", () => {
    expect(
      shownLines({ text: "Look at this", attachments: [attachment] }),
    ).toEqual(["Look at this", "New Account - Signup Form"]);
  });
});

describe("the signup bot message", () => {
  test("shows the summary once, then the attachment with its nine fields", async () => {
    const { event } = await loadPayload("message-attachment-signup");
    const blocks = renderMessageBody(messageContent(event), {});

    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "attachment",
    ]);
    expect(shownLines(event).slice(0, 4)).toEqual([
      "New Account",
      "New Account - Signup Form",
      "User.id|101",
      "User.name|Jane Example",
    ]);
    expect(attachmentOf(event)).toMatchObject({ color: "#2eb886" });
    expect(messageContent(event).fallbackText).toContain("New Account");
  });
});

describe("attachments built from Block Kit blocks", () => {
  /** Shaped like a ClickUp "Task created" message, with placeholder names and links. */
  const taskCreated = {
    subtype: "bot_message",
    text: "*Task created* by ClickBot",
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: "*Task created* by ClickBot" },
      },
    ],
    attachments: [
      {
        id: 1,
        color: "#5f55ee",
        fallback: "[no preview available]",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*<https://example.com/t/1|Move account 100 from Ann to Bo>*",
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "image",
                image_url: "https://example.com/logo.png",
                alt_text: "Team / Space / Escalations",
              },
              { type: "mrkdwn", text: "in Escalations" },
              {
                type: "image",
                image_url: "https://example.com/status.png",
                alt_text: "Status",
              },
              { type: "mrkdwn", text: "(dev) Inbox" },
            ],
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "View task" },
                url: "https://example.com/t/1",
              },
              {
                type: "button",
                text: { type: "plain_text", text: "Edit task" },
                value: "{}",
              },
            ],
          },
        ],
      },
    ],
  };

  test("show the blocks inside the attachment, beside its colour bar", () => {
    expect(attachmentOf(taskCreated)).toMatchObject({
      kind: "attachment",
      color: "#5f55ee",
      blocks: [{ kind: "paragraph" }, { kind: "context" }, { kind: "actions" }],
    });
    expect(shownLines(taskCreated)).toEqual([
      "Task created by ClickBot",
      "Move account 100 from Ann to Bo",
      "Team / Space / Escalations in Escalations Status (dev) Inbox",
      "[View task] [Edit task]",
    ]);
  });

  test("come after the attachment's own title, text and fields", () => {
    expect(
      shownLines({
        attachments: [
          {
            title: "Title",
            text: "Text",
            fields: [{ title: "F", value: "1" }],
            blocks: [
              { type: "section", text: { type: "mrkdwn", text: "Block" } },
            ],
          },
        ],
      }),
    ).toEqual(["Title", "Text", "F|1", "Block"]);
  });

  test("give the plain text when the attachment has no fallback, text, pretext or title", () => {
    const content = messageContent({
      text: "",
      attachments: [
        {
          blocks: [
            { type: "section", text: { type: "mrkdwn", text: "From a block" } },
          ],
        },
      ],
    });

    expect(content.fallbackText).toBe("From a block");
  });

  test("malformed attachment blocks never throw", () => {
    expect(() =>
      messageContent({
        attachments: [
          { blocks: "x" },
          { blocks: [null, 3, { type: {} }, { type: "section", text: 4 }] },
        ],
      }),
    ).not.toThrow();
  });
});

describe("legacy attachment buttons", () => {
  test("show as labels after the attachment's content, menus marked with ▾", () => {
    expect(
      shownLines({
        attachments: [
          {
            text: "Pick one",
            actions: [
              { name: "go", text: "Approve", type: "button", value: "yes" },
              { name: "no", text: "Reject", type: "button", style: "danger" },
              { name: "who", text: "Choose someone", type: "select" },
              { name: "bad", type: "button" },
              "nope",
            ],
          },
        ],
      }),
    ).toEqual(["Pick one", "[Approve] [Reject] [Choose someone ▾]"]);
  });
});

describe("interactive element labels", () => {
  const spansOf = (block: Raw) => {
    const [shown] = messageContent({ blocks: [block] }).body ?? [];

    return shown?.kind === "actions" ? shown.inline : [];
  };

  test("a button carries its address, and one without an address an empty action", () => {
    expect(
      spansOf({
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Open" },
            url: "https://example.com",
          },
          { type: "button", text: { type: "plain_text", text: "Do" } },
          {
            type: "static_select",
            placeholder: { type: "plain_text", text: "Pick" },
          },
        ],
      }),
    ).toEqual([
      { markup: "[Open]", action: { url: "https://example.com" } },
      { markup: " " },
      { markup: "[Do]", action: {} },
      { markup: " " },
      { markup: "[Pick ▾]", action: {} },
    ]);
  });

  test("a section's image accessory is no button", () => {
    expect(
      spansOf({
        type: "section",
        accessory: {
          type: "image",
          image_url: "https://example.com/a.png",
          alt_text: "A picture",
        },
      }),
    ).toEqual([{ markup: "[A picture]" }]);
  });

  test("a legacy button carries its address", () => {
    const [attachment] = messageContent({
      attachments: [
        {
          text: "t",
          actions: [
            { type: "button", text: "Go", url: "https://example.com/go" },
          ],
        },
      ],
    }).body!;

    expect(attachment).toMatchObject({
      blocks: [
        { kind: "paragraph" },
        {
          kind: "actions",
          inline: [
            { markup: "[Go]", action: { url: "https://example.com/go" } },
          ],
        },
      ],
    });
  });
});
