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
