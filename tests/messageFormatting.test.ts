import { describe, expect, test } from "bun:test";
import type { ContentBlock } from "../src/session/content";
import { parseMrkdwn } from "../src/session/mrkdwn";
import { mentionedIds, renderMessageBody } from "../src/session/messageText";
import { messageContent } from "../src/slack/convert/blocks";

/** The inline content of the first block as `text` / `[style]text` pieces. */
function pieces(blocks: ContentBlock[]): string[] {
  const block = blocks[0];

  if (!block || !("inline" in block)) {
    throw new Error("expected an inline block");
  }

  return block.inline.map((span) => {
    const flags = Object.keys(span.style ?? {}).join("+");

    return flags ? `[${flags}]${span.markup}` : span.markup;
  });
}

const inline = (text: string) => pieces(parseMrkdwn(text));

describe("mrkdwn inline styles", () => {
  test("bold, italic, strike and code", () => {
    expect(inline("a *b* _c_ ~d~ `e`")).toEqual([
      "a ",
      "[bold]b",
      " ",
      "[italic]c",
      " ",
      "[strike]d",
      " ",
      "[code]e",
    ]);
  });

  test("markers only apply at word boundaries", () => {
    expect(inline("snake_case_name and 2*3*4")).toEqual([
      "snake_case_name and 2*3*4",
    ]);
    expect(inline("(*bold*) and *bold*, done")).toEqual([
      "(",
      "[bold]bold",
      ") and ",
      "[bold]bold",
      ", done",
    ]);
  });

  test("markers need non-space inside", () => {
    expect(inline("a * b * c")).toEqual(["a * b * c"]);
  });

  test("unclosed and doubled markers stay literal", () => {
    expect(inline("*unclosed and _also")).toEqual(["*unclosed and _also"]);
    expect(inline("**not bold**")).toEqual(["**not bold**"]);
  });

  test("styles nest and sit side by side", () => {
    expect(inline("*bold _both_ bold* *x*")).toEqual([
      "[bold]bold ",
      "[bold+italic]both",
      "[bold] bold",
      " ",
      "[bold]x",
    ]);
    expect(inline("_*x*_")).toEqual(["[italic+bold]x"]);
  });

  test("nothing inside code is interpreted", () => {
    expect(inline("`*not bold* _x_ ~y~` *real*")).toEqual([
      "[code]*not bold* _x_ ~y~",
      " ",
      "[bold]real",
    ]);
  });

  test("entities are never mangled or formatted inside", () => {
    expect(inline("*<https://example.com/a_b_c|a_b>* &amp; _<@U1>_")).toEqual([
      "[bold]<https://example.com/a_b_c|a_b>",
      " &amp; ",
      "[italic]<@U1>",
    ]);
  });
});

describe("mrkdwn blocks", () => {
  test("fenced code is one preformatted block, markup untouched", () => {
    const blocks = parseMrkdwn("before\n```\n  *x*\n  y\n```\nafter");

    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "code",
      "paragraph",
    ]);
    expect(blocks[1]).toEqual({
      kind: "code",
      inline: [{ markup: "  *x*\n  y" }],
    });
  });

  test("an unclosed fence is literal text", () => {
    expect(parseMrkdwn("```oops").map((block) => block.kind)).toEqual([
      "paragraph",
    ]);
  });

  test("consecutive quote lines make one quote, escaped or not", () => {
    const blocks = parseMrkdwn("&gt; one\n> two *b*\nplain");

    expect(blocks.map((block) => block.kind)).toEqual(["quote", "paragraph"]);
    expect(pieces(blocks)).toEqual(["one", "\n", "two ", "[bold]b"]);
  });

  test("lists keep their kind, indent and starting number", () => {
    const blocks = parseMrkdwn("- a\n- b\n  - nested\n3. c\n4. d");

    expect(blocks).toEqual([
      {
        kind: "list",
        ordered: false,
        indent: 0,
        start: 1,
        items: [[{ markup: "a" }], [{ markup: "b" }]],
      },
      {
        kind: "list",
        ordered: false,
        indent: 1,
        start: 1,
        items: [[{ markup: "nested" }]],
      },
      {
        kind: "list",
        ordered: true,
        indent: 0,
        start: 3,
        items: [[{ markup: "c" }], [{ markup: "d" }]],
      },
    ]);
  });

  test("never throws on odd input", () => {
    for (const text of ["", "`", "```", "*", ">", "- ", "<", "<>", "`*`*_"]) {
      expect(() => parseMrkdwn(text)).not.toThrow();
    }
  });
});

describe("rich_text blocks", () => {
  const richText = {
    type: "rich_text",
    elements: [
      {
        type: "rich_text_section",
        elements: [
          { type: "text", text: "Hi ", style: { bold: true } },
          { type: "user", user_id: "U222222222" },
          { type: "text", text: " & ", style: { italic: true, strike: true } },
          {
            type: "link",
            url: "https://example.com",
            text: "docs",
            style: { code: true },
          },
          { type: "text", text: "\n" },
        ],
      },
      {
        type: "rich_text_list",
        style: "ordered",
        indent: 1,
        offset: 2,
        elements: [
          {
            type: "rich_text_section",
            elements: [{ type: "text", text: "three" }],
          },
        ],
      },
      {
        type: "rich_text_quote",
        elements: [{ type: "text", text: "quoted" }],
      },
      {
        type: "rich_text_preformatted",
        elements: [{ type: "text", text: "a  b\n  c" }],
      },
    ],
  };

  test("converts sections, lists, quotes and preformatted text with styles", () => {
    const { body } = messageContent({ text: "ignored", blocks: [richText] });

    expect(body).toEqual([
      {
        kind: "paragraph",
        inline: [
          { markup: "Hi ", style: { bold: true } },
          { markup: "<@U222222222>" },
          { markup: " &amp; ", style: { italic: true, strike: true } },
          { markup: "<https://example.com|docs>", style: { code: true } },
        ],
      },
      {
        kind: "list",
        ordered: true,
        indent: 1,
        start: 3,
        items: [[{ markup: "three" }]],
      },
      { kind: "quote", inline: [{ markup: "quoted" }] },
      { kind: "code", inline: [{ markup: "a  b\n  c" }] },
    ]);
  });

  test("rich_text wins over text; text wins over fallback; mentions still count", () => {
    const content = messageContent({ text: "plain", blocks: [richText] });
    const shown = renderMessageBody(content, {});

    expect(shown[0]).toMatchObject({ kind: "paragraph" });
    expect(
      shown[0]!.kind === "paragraph" &&
        shown[0]!.inline.map((segment) => segment.text).join(""),
    ).toBe("Hi @U222222222 & docs");
    expect(mentionedIds(content.fallbackText ?? "").userIds).toEqual([
      "U222222222",
    ]);

    const textOnly = renderMessageBody(
      messageContent({ text: "*hi* :tada:" }),
      {},
    );

    expect(textOnly[0]).toMatchObject({
      kind: "paragraph",
      inline: [
        { text: "hi", style: { bold: true } },
        { kind: "text" },
        { kind: "emoji" },
      ],
    });
  });

  test("code spans and blocks keep shortcodes as typed", () => {
    const [block] = renderMessageBody({ text: "`:tada:` :tada:" }, {});

    expect(block).toMatchObject({
      inline: [
        { kind: "text", text: ":tada:" },
        { kind: "text" },
        { kind: "emoji" },
      ],
    });
  });

  test("unknown elements are skipped without throwing", () => {
    expect(() =>
      messageContent({
        text: "",
        blocks: [
          { type: "rich_text", elements: [{ type: "mystery" }, 5, null] },
        ],
      }),
    ).not.toThrow();
  });
});
