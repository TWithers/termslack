import type {
  ContentBlock,
  ContentField,
  Span,
  SpanAction,
  TextStyle,
} from "../../session/content";
import type { MessageContent } from "../../session/events";
import { parseMrkdwn } from "../../session/mrkdwn";
import { isObject, optionalString, presentString } from "./shared";

function escapeMarkup(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** A Block Kit text object as Slack markup: `mrkdwn` is already escaped, `plain_text` isn't. */
function textObject(value: unknown): string | undefined {
  if (!isObject(value) || typeof value.text !== "string") {
    return undefined;
  }

  return value.type === "plain_text" ? escapeMarkup(value.text) : value.text;
}

/** A rich text element as Slack markup, so the message renderer can resolve mentions. */
function richTextElement(element: unknown): string {
  if (!isObject(element)) {
    return "";
  }

  const id = (field: string) => optionalString(element[field]);

  switch (element.type) {
    case "text":
      return escapeMarkup(presentString(element.text) ?? "");
    case "link": {
      const label = optionalString(element.text);
      const url = id("url");

      return url
        ? label
          ? `<${url}|${escapeMarkup(label)}>`
          : `<${url}>`
        : (label ?? "");
    }
    case "user":
      return id("user_id") ? `<@${id("user_id")}>` : "";
    case "channel":
      return id("channel_id") ? `<#${id("channel_id")}>` : "";
    case "usergroup":
      return id("usergroup_id") ? `<!subteam^${id("usergroup_id")}>` : "";
    case "broadcast":
      return id("range") ? `<!${id("range")}>` : "";
    case "emoji":
      return id("name") ? `:${id("name")}:` : "";
    default:
      return Array.isArray(element.elements)
        ? element.elements.map(richTextElement).join("")
        : "";
  }
}

/** An element's `style` ({bold, italic, strike, code}); undefined when none is on. */
function elementStyle(element: Record<string, any>): TextStyle | undefined {
  if (!isObject(element.style)) {
    return undefined;
  }

  const style: TextStyle = {};

  for (const [flag, name] of [
    ["bold", "bold"],
    ["italic", "italic"],
    ["strike", "strike"],
    ["code", "code"],
  ] as const) {
    if (element.style[flag] === true) {
      style[name] = true;
    }
  }

  return Object.keys(style).length > 0 ? style : undefined;
}

/** A container's inline elements as spans; one trailing line break is dropped, since the block ends there. */
function richTextSpans(container: Record<string, any>): Span[] {
  const elements = Array.isArray(container.elements) ? container.elements : [];
  const spans = elements
    .filter(isObject)
    .map((element): Span => {
      const style = elementStyle(element);

      return style
        ? { markup: richTextElement(element), style }
        : { markup: richTextElement(element) };
    })
    .filter((span) => span.markup !== "");
  const last = spans.at(-1);

  if (last?.markup.endsWith("\n")) {
    spans[spans.length - 1] = { ...last, markup: last.markup.slice(0, -1) };
  }

  return spans.filter((span) => span.markup !== "");
}

/** The display blocks of a `rich_text` block: sections, preformatted text, quotes and lists. Other elements are skipped. */
function richTextBlocks(block: Record<string, any>): ContentBlock[] {
  const elements = Array.isArray(block.elements) ? block.elements : [];

  return elements.filter(isObject).flatMap((element): ContentBlock[] => {
    switch (element.type) {
      case "rich_text_section":
        return [{ kind: "paragraph", inline: richTextSpans(element) }];
      case "rich_text_quote":
        return [{ kind: "quote", inline: richTextSpans(element) }];
      case "rich_text_preformatted":
        return [{ kind: "code", inline: richTextSpans(element) }];
      case "rich_text_list": {
        const items = Array.isArray(element.elements) ? element.elements : [];

        return [
          {
            kind: "list",
            ordered: element.style === "ordered",
            indent:
              typeof element.indent === "number" && element.indent > 0
                ? Math.floor(element.indent)
                : 0,
            start:
              typeof element.offset === "number" && element.offset > 0
                ? Math.floor(element.offset) + 1
                : 1,
            items: items.filter(isObject).map(richTextSpans),
          },
        ];
      }
      default:
        return [];
    }
  });
}

/** The text a block holds, best effort; blocks termslack doesn't understand contribute nothing. */
function blockPlainText(block: unknown): (string | undefined)[] {
  if (!isObject(block)) {
    return [];
  }

  const elements = Array.isArray(block.elements) ? block.elements : [];
  const fields = Array.isArray(block.fields) ? block.fields : [];

  switch (block.type) {
    case "header":
      return [textObject(block.text)];
    case "section":
      return [textObject(block.text), ...fields.map(textObject)];
    case "context":
      return elements.map(textObject);
    case "rich_text":
      return elements.map(richTextElement);
    default:
      return [];
  }
}

function filled(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** A link in Slack markup. Characters that would end the markup early are percent-encoded. */
function link(url: string, label?: string): string {
  const safe = url.replace(/>/g, "%3E").replace(/\|/g, "%7C");

  return label ? `<${safe}|${escapeMarkup(label)}>` : `<${safe}>`;
}

/** A Block Kit text object as display blocks: `mrkdwn` is formatted, `plain_text` is taken as typed. */
function textBlocks(value: unknown): ContentBlock[] {
  if (!isObject(value) || !filled(value.text)) {
    return [];
  }

  return value.type === "plain_text"
    ? [{ kind: "paragraph", inline: [{ markup: escapeMarkup(value.text) }] }]
    : parseMrkdwn(value.text);
}

/** The inline content of text blocks, paragraphs separated by a line break. */
function inlineOf(blocks: ContentBlock[]): Span[] {
  return blocks
    .flatMap((block): Span[][] =>
      block.kind === "paragraph" || block.kind === "quote"
        ? [block.inline]
        : [],
    )
    .flatMap((inline, index): Span[] =>
      index === 0 ? inline : [{ markup: "\n" }, ...inline],
    );
}

/** What an interactive or image element shows as, or undefined when it has no label. */
function elementLabel(element: unknown): string | undefined {
  if (!isObject(element)) {
    return undefined;
  }

  const text = (value: unknown) => {
    const shownText = isObject(value) ? value.text : undefined;

    return filled(shownText) ? shownText : undefined;
  };
  const type = typeof element.type === "string" ? element.type : "";

  if (type === "overflow") {
    return "⋯";
  }

  if (type === "image") {
    return text({ text: element.alt_text });
  }

  if (/select$/.test(type)) {
    const chosen = Array.isArray(element.initial_options)
      ? element.initial_options
          .map((option) => text(option?.text))
          .find(Boolean)
      : text(element.initial_option?.text);
    const label = chosen ?? text(element.placeholder) ?? "Select";

    return `${label} ▾`;
  }

  if (type === "datepicker") {
    return (
      (filled(element.initial_date) ? element.initial_date : undefined) ??
      text(element.placeholder) ??
      "Select date"
    );
  }

  if (type === "timepicker") {
    return (
      (filled(element.initial_time) ? element.initial_time : undefined) ??
      text(element.placeholder) ??
      "Select time"
    );
  }

  if (type === "datetimepicker") {
    return "Select date and time";
  }

  if (type === "checkboxes" || type === "radio_buttons") {
    const options = Array.isArray(element.options) ? element.options : [];

    return (
      options
        .map((option) => text(option?.text))
        .filter(Boolean)
        .join(", ") || undefined
    );
  }

  return text(element.text) ?? text(element.placeholder);
}

/** An element's link (a button's `url`), when it has one. */
function elementAction(element: Record<string, any>): SpanAction {
  return filled(element.url) ? { url: element.url } : {};
}

/** An element's label in brackets; interactive ones (not images) carry their action. */
function labelSpan(element: unknown): Span[] {
  const label = elementLabel(element);

  if (!label || !isObject(element)) {
    return [];
  }

  const markup = `[${escapeMarkup(label)}]`;

  return element.type === "image"
    ? [{ markup }]
    : [{ markup, action: elementAction(element) }];
}

function spacedSpans(groups: Span[][]): Span[] {
  return groups
    .filter((group) => group.length > 0)
    .flatMap((group, index): Span[] =>
      index === 0 ? group : [{ markup: " " }, ...group],
    );
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Text a block of a type termslack doesn't know holds in the places Block Kit puts it. */
function unknownBlockText(block: Record<string, any>): ContentBlock[] {
  return [
    ...textBlocks(block.text),
    ...arrayOf(block.fields).flatMap(textBlocks),
    ...arrayOf(block.elements).flatMap(textBlocks),
  ];
}

/** The display blocks of a Block Kit block other than `rich_text`. Never throws. */
function layoutBlocks(block: Record<string, any>): ContentBlock[] {
  switch (block.type) {
    case "header": {
      const inline = inlineOf(textBlocks(block.text)).map((span): Span => ({
        ...span,
        style: { ...span.style, bold: true },
      }));

      return inline.length > 0 ? [{ kind: "header", inline }] : [];
    }
    case "section": {
      const fields = arrayOf(block.fields)
        .map((field): ContentField => ({
          blocks: textBlocks(field),
          wide: false,
        }))
        .filter((field) => field.blocks.length > 0);
      const accessory = labelSpan(block.accessory);

      return [
        ...textBlocks(block.text),
        ...(fields.length > 0 ? [{ kind: "fields" as const, fields }] : []),
        ...(accessory.length > 0
          ? [{ kind: "actions" as const, inline: accessory }]
          : []),
      ];
    }
    case "context": {
      const inline = spacedSpans(
        arrayOf(block.elements).map((element) =>
          isObject(element) && element.type === "image"
            ? labelSpan(element).map((span) => ({
                markup: span.markup.slice(1, -1),
              }))
            : inlineOf(textBlocks(element)),
        ),
      );

      return inline.length > 0 ? [{ kind: "context", inline }] : [];
    }
    case "divider":
      return [{ kind: "divider" }];
    case "image": {
      const alt =
        elementLabel({ type: "image", alt_text: block.alt_text }) ??
        (isObject(block.title) && filled(block.title.text)
          ? block.title.text
          : "");
      const inline: Span[] = filled(block.image_url)
        ? [{ markup: link(block.image_url, alt || undefined) }]
        : alt
          ? [{ markup: escapeMarkup(alt) }]
          : [];

      return inline.length > 0 ? [{ kind: "image", inline }] : [];
    }
    case "actions": {
      const inline = spacedSpans(arrayOf(block.elements).map(labelSpan));

      return inline.length > 0 ? [{ kind: "actions", inline }] : [];
    }
    default:
      return unknownBlockText(block);
  }
}

/** The display blocks of any Block Kit block. Never throws. */
function displayBlocks(block: unknown): ContentBlock[] {
  if (!isObject(block)) {
    return [];
  }

  return block.type === "rich_text"
    ? richTextBlocks(block)
    : layoutBlocks(block);
}

/** A legacy attachment button or menu as a label, menus marked with ▾. */
function legacyActionSpan(action: unknown): Span[] {
  if (!isObject(action) || !filled(action.text)) {
    return [];
  }

  const label = action.type === "select" ? `${action.text} ▾` : action.text;

  return [
    { markup: `[${escapeMarkup(label)}]`, action: elementAction(action) },
  ];
}

function attachmentColor(value: unknown): string | undefined {
  if (value === "good" || value === "warning" || value === "danger") {
    return value;
  }

  const hex =
    typeof value === "string" ? /^#?([0-9a-f]{6})$/i.exec(value) : null;

  return hex ? `#${hex[1]!.toLowerCase()}` : undefined;
}

function formattedBlocks(value: unknown): ContentBlock[] {
  return filled(value) ? parseMrkdwn(value) : [];
}

const boldSpan = (markup: string): Span => ({ markup, style: { bold: true } });

/** `2026-11-04 19:48 UTC` as a date markup whose label is that, so the renderer shows it without a time zone lookup. */
function timestampMarkup(seconds: number): string {
  const label = `${new Date(seconds * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;

  return `<!date^${Math.floor(seconds)}^{date_short} {time}|${label}>`;
}

function attachmentField(field: unknown): ContentField | undefined {
  if (!isObject(field)) {
    return undefined;
  }

  const title: ContentBlock[] = filled(field.title)
    ? [{ kind: "paragraph", inline: [boldSpan(escapeMarkup(field.title))] }]
    : [];
  const blocks = [...title, ...formattedBlocks(field.value)];

  return blocks.length > 0 ? { blocks, wide: field.short !== true } : undefined;
}

/** A legacy attachment as a display block; undefined when it has nothing to show beyond its fallback. */
function attachmentBlock(attachment: unknown): ContentBlock | undefined {
  if (!isObject(attachment)) {
    return undefined;
  }

  const author: ContentBlock[] = filled(attachment.author_name)
    ? [
        {
          kind: "context",
          inline: [
            {
              markup: filled(attachment.author_link)
                ? link(attachment.author_link, attachment.author_name)
                : escapeMarkup(attachment.author_name),
            },
          ],
        },
      ]
    : [];
  const title: ContentBlock[] = filled(attachment.title)
    ? [
        {
          kind: "paragraph",
          inline: [
            boldSpan(
              filled(attachment.title_link)
                ? link(attachment.title_link, attachment.title)
                : escapeMarkup(attachment.title),
            ),
          ],
        },
      ]
    : [];
  const fields = arrayOf(attachment.fields)
    .map(attachmentField)
    .filter((field): field is ContentField => field !== undefined);
  const images: ContentBlock[] = (
    [
      ["Image", attachment.image_url],
      ["Thumbnail", attachment.thumb_url],
    ] as const
  ).flatMap(([label, url]): ContentBlock[] =>
    filled(url)
      ? [{ kind: "image", inline: [{ markup: `${label}: ${link(url)}` }] }]
      : [],
  );
  const footerText = [
    filled(attachment.footer) ? escapeMarkup(attachment.footer) : undefined,
    typeof attachment.ts === "number" && Number.isFinite(attachment.ts)
      ? timestampMarkup(attachment.ts)
      : undefined,
  ].filter((part): part is string => part !== undefined);
  const footer: ContentBlock[] =
    footerText.length > 0
      ? [{ kind: "context", inline: [{ markup: footerText.join(" · ") }] }]
      : [];
  const actions = spacedSpans(
    arrayOf(attachment.actions).map(legacyActionSpan),
  );
  const pretext = formattedBlocks(attachment.pretext);
  const blocks: ContentBlock[] = [
    ...author,
    ...title,
    ...formattedBlocks(attachment.text),
    ...(fields.length > 0 ? [{ kind: "fields" as const, fields }] : []),
    ...arrayOf(attachment.blocks).flatMap(displayBlocks),
    ...(actions.length > 0
      ? [{ kind: "actions" as const, inline: actions }]
      : []),
    ...images,
    ...footer,
  ];

  if (pretext.length === 0 && blocks.length === 0) {
    return undefined;
  }

  return {
    kind: "attachment",
    color: attachmentColor(attachment.color),
    fallback: filled(attachment.fallback) ? attachment.fallback : undefined,
    pretext,
    blocks,
  };
}

function attachmentPlainText(attachment: unknown): string | undefined {
  if (!isObject(attachment)) {
    return undefined;
  }

  const summary = [
    attachment.fallback,
    attachment.text,
    attachment.pretext,
    attachment.title,
  ].find((text) => typeof text === "string" && text.trim() !== "");

  if (summary !== undefined) {
    return summary;
  }

  const blockText = arrayOf(attachment.blocks)
    .flatMap(blockPlainText)
    .filter(filled)
    .join("\n");

  return blockText || undefined;
}

function fileName(file: unknown): string | undefined {
  return isObject(file)
    ? (optionalString(file.name) ?? optionalString(file.title))
    : undefined;
}

/** What a message says: its text, plus plain-text stand-ins for its attachments, blocks and files. */
export function messageContent(message: Record<string, any>): MessageContent {
  const blocks = Array.isArray(message.blocks) ? message.blocks : [];
  const attachments = Array.isArray(message.attachments)
    ? message.attachments
    : [];
  const files = Array.isArray(message.files)
    ? message.files
    : message.file
      ? [message.file]
      : [];
  const fallbackText = [
    ...blocks.flatMap(blockPlainText),
    ...attachments.map(attachmentPlainText),
  ]
    .filter((part): part is string => !!part && part.trim() !== "")
    .join("\n");

  const body = [
    ...blocks.flatMap(displayBlocks),
    ...attachments.flatMap((attachment) => attachmentBlock(attachment) ?? []),
  ];

  return {
    text: typeof message.text === "string" ? message.text : "",
    fallbackText: fallbackText || undefined,
    body: body.length > 0 ? body : undefined,
    files: files.map(fileName).filter((name): name is string => !!name),
  };
}
