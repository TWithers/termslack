import { describe, expect, test } from "bun:test";
import type { ContentBlock, StyledSegment } from "../src/session/content";
import { renderMessageBody } from "../src/session/messageText";
import { messageContent } from "../src/slack/convert/blocks";

type Block = ContentBlock<StyledSegment>;

const plain = (segments: StyledSegment[]) =>
  segments.map((segment) => segment.text).join("");

const shown = (blocks: unknown[], text = ""): Block[] =>
  renderMessageBody(messageContent({ text, blocks }), {});

const plainText = (text: string) => ({ type: "plain_text", text });
const mrkdwn = (text: string) => ({ type: "mrkdwn", text });

describe("Block Kit layout blocks", () => {
  test("a header is bold text", () => {
    expect(shown([{ type: "header", text: plainText("Deploy <1>") }])).toEqual([
      {
        kind: "header",
        inline: [{ kind: "text", text: "Deploy <1>", style: { bold: true } }],
      },
    ]);
  });

  test("a section shows its text with mrkdwn, then its fields, then its accessory", () => {
    const blocks = shown([
      {
        type: "section",
        text: mrkdwn("*All* green"),
        fields: [mrkdwn("*Env:*\nproduction"), plainText("Plain")],
        accessory: { type: "button", text: plainText("Approve") },
      },
    ]);

    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "fields",
      "actions",
    ]);
    expect(blocks[0]).toMatchObject({
      inline: [{ text: "All", style: { bold: true } }, { text: " green" }],
    });
    expect(blocks[1]).toMatchObject({
      fields: [
        { wide: false, blocks: [{ kind: "paragraph" }] },
        { wide: false, blocks: [{ kind: "paragraph" }] },
      ],
    });
    expect(blocks[2]).toMatchObject({
      inline: [{ text: "[Approve]" }],
    });
  });

  test("a context block joins its text and image alt text", () => {
    const [context] = shown([
      {
        type: "context",
        elements: [
          {
            type: "image",
            image_url: "https://example.com/i.png",
            alt_text: "cat",
          },
          mrkdwn("took *3* minutes"),
        ],
      },
    ]);

    expect(context).toMatchObject({ kind: "context" });
    expect(context!.kind === "context" && plain(context.inline)).toBe(
      "cat took 3 minutes",
    );
  });

  test("a divider is a divider", () => {
    expect(shown([{ type: "divider" }])).toEqual([{ kind: "divider" }]);
  });

  test("an image block shows its alt text as a link to the image", () => {
    const [image] = shown([
      {
        type: "image",
        image_url: "https://example.com/i.png",
        alt_text: "A cat",
      },
    ]);

    expect(image).toMatchObject({
      kind: "image",
      inline: [
        { kind: "link", text: "A cat", url: "https://example.com/i.png" },
      ],
    });
  });

  test("an image block without alt text shows the address, and without an address the alt text", () => {
    expect(
      shown([{ type: "image", image_url: "https://example.com/i.png" }]),
    ).toMatchObject([
      { kind: "image", inline: [{ text: "https://example.com/i.png" }] },
    ]);
    expect(shown([{ type: "image", alt_text: "only alt" }])).toMatchObject([
      { kind: "image", inline: [{ text: "only alt" }] },
    ]);
  });
});

describe("interactive elements", () => {
  test("show as bracketed labels and keep their order", () => {
    const [actions] = shown([
      {
        type: "actions",
        elements: [
          { type: "button", text: plainText("Approve"), action_id: "a" },
          {
            type: "static_select",
            placeholder: plainText("Pick one"),
            options: [],
          },
          { type: "overflow", options: [] },
          { type: "datepicker", initial_date: "2026-11-04" },
          { type: "datepicker" },
        ],
      },
    ]);

    expect(actions!.kind === "actions" && plain(actions.inline)).toBe(
      "[Approve] [Pick one ▾] [⋯] [2026-11-04] [Select date]",
    );
  });

  test("a select shows its chosen option", () => {
    const [actions] = shown([
      {
        type: "actions",
        elements: [
          {
            type: "static_select",
            placeholder: plainText("Pick"),
            initial_option: { text: plainText("Two"), value: "2" },
          },
        ],
      },
    ]);

    expect(actions!.kind === "actions" && plain(actions.inline)).toBe(
      "[Two ▾]",
    );
  });

  test("an image accessory shows its alt text", () => {
    const blocks = shown([
      {
        type: "section",
        text: mrkdwn("hi"),
        accessory: {
          type: "image",
          image_url: "https://x.test/a.png",
          alt_text: "avatar",
        },
      },
    ]);

    expect(blocks.at(-1)).toMatchObject({
      kind: "actions",
      inline: [{ text: "[avatar]" }],
    });
  });
});

describe("unknown and malformed blocks", () => {
  test("an unknown block shows any text it contains", () => {
    expect(
      shown([
        {
          type: "future_block",
          text: mrkdwn("*hello*"),
          fields: [plainText("f")],
        },
      ]),
    ).toMatchObject([
      { kind: "paragraph", inline: [{ text: "hello", style: { bold: true } }] },
      { kind: "paragraph", inline: [{ text: "f" }] },
    ]);
  });

  test("unknown blocks without text, unknown elements and junk are skipped", () => {
    expect(shown([{ type: "future_block" }, null, 4, "x", {}])).toEqual([]);
    expect(
      shown([
        {
          type: "actions",
          elements: [
            { type: "mystery" },
            null,
            { type: "mystery", text: plainText("Go") },
          ],
        },
      ]),
    ).toMatchObject([{ kind: "actions", inline: [{ text: "[Go]" }] }]);
  });

  test("malformed fields never throw", () => {
    expect(() =>
      messageContent({
        text: "",
        blocks: [
          { type: "section", text: 4, fields: "x", accessory: [] },
          { type: "context", elements: "x" },
          { type: "actions", elements: [[]] },
          { type: "image", image_url: 3, alt_text: {} },
          { type: "header", text: null },
          { type: "divider", extra: true },
        ],
      }),
    ).not.toThrow();
  });
});

describe("summary text and blocks", () => {
  test("text is not shown beside blocks that show content", () => {
    expect(
      shown([{ type: "header", text: plainText("Deploy") }], "Deploy finished"),
    ).toMatchObject([{ kind: "header" }]);
  });

  test("text is shown when the blocks have nothing to show", () => {
    expect(shown([{ type: "future_block" }], "Hello")).toMatchObject([
      { kind: "paragraph", inline: [{ text: "Hello" }] },
    ]);
  });

  test("blocks keep their message order around rich text", () => {
    const blocks = shown([
      { type: "header", text: plainText("H") },
      {
        type: "rich_text",
        elements: [
          {
            type: "rich_text_section",
            elements: [{ type: "text", text: "body" }],
          },
        ],
      },
      { type: "divider" },
    ]);

    expect(blocks.map((block) => block.kind)).toEqual([
      "header",
      "paragraph",
      "divider",
    ]);
  });
});
