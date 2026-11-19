import type { ContentBlock, Span, StyledSegment } from "./content";
import { type EmojiLookup, splitEmoji } from "./emoji";
import type {
  Conversation,
  ConversationKind,
  MessageContent,
  User,
  UserGroup,
} from "./events";
import { parseMrkdwn } from "./mrkdwn";
import { conversationLabel, conversationTitle, personName } from "./people";

/**
 * One piece of a rendered message. Every segment carries the `text` it
 * displays as (mentions include their `@` or `#`), so a view that doesn't
 * care about styling can simply join them. Views style by `kind`.
 */
export type MessageSegment =
  | { kind: "text"; text: string }
  | { kind: "user"; text: string; userId: string }
  | { kind: "channel"; text: string; conversationId: string }
  | { kind: "broadcast"; text: string; target: BroadcastTarget }
  | { kind: "userGroup"; text: string; userGroupId: string }
  | { kind: "link"; text: string; url: string }
  /** A standard emoji as its character; a custom one as its `:shortcode:`. `shortcode` is what the text said. */
  | { kind: "emoji"; text: string; shortcode: string };

export type BroadcastTarget = "here" | "channel" | "everyone";

/** What the renderer may ask the store for, at render time. Unknown things fall back to the label Slack sent, then the raw ID. */
export type MessageTextLookup = EmojiLookup & {
  conversation?(id: string): Conversation | undefined;
  user?(id: string): User | undefined;
  userGroup?(id: string): UserGroup | undefined;
  conversationMembers?(id: string): string[] | undefined;
  readonly currentUserId?: string;
};

type Token =
  | { kind: "text"; text: string }
  | { kind: "user"; id: string; label?: string }
  | { kind: "channel"; id: string; label?: string }
  | { kind: "broadcast"; target: BroadcastTarget }
  | { kind: "userGroup"; id: string; label?: string }
  | { kind: "link"; url: string; label?: string };

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">" };

/** Decodes the three entities Slack escapes, in one pass so `&amp;lt;` becomes `&lt;`. */
function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt);/g, (_, name: string) => entities[name]!);
}

const broadcastTargets = new Set<string>(["here", "channel", "everyone"]);

function splitLabel(inner: string): [string, string | undefined] {
  const bar = inner.indexOf("|");

  return bar === -1
    ? [inner, undefined]
    : [inner.slice(0, bar), inner.slice(bar + 1)];
}

/** What a `<...>` holds, or undefined when it isn't markup termslack understands. */
function classify(inner: string): Token | undefined {
  const [head, label] = splitLabel(inner);

  if (/^@[A-Z0-9]+$/.test(head)) {
    return { kind: "user", id: head.slice(1), label };
  }

  if (/^#[A-Z0-9]+$/.test(head)) {
    return { kind: "channel", id: head.slice(1), label };
  }

  if (head.startsWith("!")) {
    const command = head.slice(1);
    const group = /^subteam\^([A-Z0-9]+)$/.exec(command);

    if (broadcastTargets.has(command)) {
      return { kind: "broadcast", target: command as BroadcastTarget };
    }

    if (group) {
      return { kind: "userGroup", id: group[1]!, label };
    }

    if (command.startsWith("date^") && label) {
      return { kind: "text", text: decodeEntities(label) };
    }

    return undefined;
  }

  if (/^[a-z][a-z0-9+.-]*:\S/i.test(head)) {
    return { kind: "link", url: decodeEntities(head), label };
  }

  return undefined;
}

function parse(text: string): Token[] {
  const tokens: Token[] = [];

  function addText(value: string): void {
    const last = tokens.at(-1);

    if (value === "") {
      return;
    }

    if (last?.kind === "text") {
      last.text += value;
      return;
    }

    tokens.push({ kind: "text", text: value });
  }

  let position = 0;

  for (const match of text.matchAll(/<([^<>]*)>/g)) {
    const token = classify(match[1]!);

    addText(decodeEntities(text.slice(position, match.index)));
    position = match.index + match[0].length;

    if (!token) {
      addText(match[0]);
    } else if (token.kind === "text") {
      addText(token.text);
    } else {
      tokens.push(token);
    }
  }

  addText(decodeEntities(text.slice(position)));

  return tokens;
}

/** The user, channel and user-group IDs a message mentions, so they can be looked up before it's shown. */
export function mentionedIds(text: string): {
  userIds: string[];
  conversationIds: string[];
  userGroupIds: string[];
  broadcasts: BroadcastTarget[];
} {
  const tokens = parse(text);
  const idsOf = (kind: "user" | "channel" | "userGroup") => [
    ...new Set(
      tokens.flatMap((token) => (token.kind === kind ? [token.id] : [])),
    ),
  ];

  return {
    userIds: idsOf("user"),
    conversationIds: idsOf("channel"),
    userGroupIds: idsOf("userGroup"),
    broadcasts: [
      ...new Set(
        tokens.flatMap((token) =>
          token.kind === "broadcast" ? [token.target] : [],
        ),
      ),
    ],
  };
}

const withoutAt = (label: string | undefined) =>
  label?.replace(/^@/, "") || undefined;

function renderChannel(
  id: string,
  label: string | undefined,
  lookup: MessageTextLookup,
): string {
  const conversation = lookup.conversation?.(id);

  if (!conversation) {
    return `#${label?.replace(/^#/, "") || id}`;
  }

  const name = conversationLabel(conversation, {
    user: (userId) => lookup.user?.(userId),
    conversationMembers: (conversationId) =>
      lookup.conversationMembers?.(conversationId),
    currentUserId: lookup.currentUserId,
  });

  return conversationTitle(
    conversation.kind,
    name || label?.replace(/^#/, "") || id,
  );
}

/**
 * Turns Slack's message markup into display segments. Names come from
 * `lookup` right now, so a rename shows up the next time a message renders.
 * Markup it doesn't understand stays in the text as sent. Never throws.
 */
export function renderMessageText(
  text: string,
  lookup: MessageTextLookup = {},
): MessageSegment[] {
  return withEmoji(renderTokens(parse(text), lookup), lookup);
}

/** Spans of `text` inside `` `inline` `` or ```fenced``` code. Mentions and links count as one character each. */
function codeRanges(text: string): [number, number][] {
  return [...text.matchAll(/```[\s\S]*?```|`[^`\n]+`/g)].map((match) => [
    match.index,
    match.index + match[0].length,
  ]);
}

/** Replaces shortcodes in the plain text of a message, leaving mentions, links and code alone. */
function withEmoji(
  segments: MessageSegment[],
  lookup: MessageTextLookup,
): MessageSegment[] {
  const flat = segments
    .map((segment) => (segment.kind === "text" ? segment.text : "\u0000"))
    .join("");
  const code = codeRanges(flat);
  let offset = 0;

  return segments.flatMap((segment): MessageSegment[] => {
    const start = offset;

    offset += segment.kind === "text" ? segment.text.length : 1;

    if (segment.kind !== "text") {
      return [segment];
    }

    const local = code.map(([from, to]): [number, number] => [
      from - start,
      to - start,
    ]);

    return splitEmoji(segment.text, lookup, local);
  });
}

function renderTokens(
  tokens: Token[],
  lookup: MessageTextLookup,
): MessageSegment[] {
  return tokens.map((token): MessageSegment => {
    switch (token.kind) {
      case "text":
        return token;
      case "user": {
        const user = lookup.user?.(token.id);
        const name = user
          ? personName(user, token.id)
          : withoutAt(token.label) || token.id;

        return { kind: "user", text: `@${name}`, userId: token.id };
      }
      case "channel":
        return {
          kind: "channel",
          text: renderChannel(token.id, token.label, lookup),
          conversationId: token.id,
        };
      case "broadcast":
        return {
          kind: "broadcast",
          text: `@${token.target}`,
          target: token.target,
        };
      case "userGroup": {
        const handle =
          lookup.userGroup?.(token.id)?.handle ??
          withoutAt(token.label) ??
          token.id;

        return {
          kind: "userGroup",
          text: `@${handle}`,
          userGroupId: token.id,
        };
      }
      case "link":
        return {
          kind: "link",
          text: token.label || token.url.replace(/^mailto:/i, ""),
          url: token.url,
        };
    }
  });
}

/** Resolves spans into styled segments. Shortcodes in code stay as typed, and so do they in `inCode` blocks. */
function renderInline(
  spans: Span[],
  lookup: MessageTextLookup,
  inCode = false,
): StyledSegment[] {
  return spans.flatMap((span): StyledSegment[] => {
    const tokens = renderTokens(parse(span.markup), lookup);
    const segments =
      span.style?.code || inCode
        ? tokens
        : tokens.flatMap((segment): MessageSegment[] =>
            segment.kind === "text"
              ? splitEmoji(segment.text, lookup)
              : [segment],
          );

    return segments.map((segment) => ({
      ...segment,
      ...(span.style ? { style: span.style } : {}),
      ...(span.action ? { action: span.action } : {}),
    }));
  });
}

/** Resolves a block's mentions, links and emoji, ready to lay out. */
export function renderBlock(
  block: ContentBlock,
  lookup: MessageTextLookup = {},
): ContentBlock<StyledSegment> {
  switch (block.kind) {
    case "list":
      return {
        ...block,
        items: block.items.map((item) => renderInline(item, lookup)),
      };
    case "code":
      return { ...block, inline: renderInline(block.inline, lookup, true) };
    case "divider":
      return block;
    case "fields":
      return {
        ...block,
        fields: block.fields.map((field) => ({
          ...field,
          blocks: field.blocks.map((inner) => renderBlock(inner, lookup)),
        })),
      };
    case "attachment":
      return {
        ...block,
        pretext: block.pretext.map((inner) => renderBlock(inner, lookup)),
        blocks: block.blocks.map((inner) => renderBlock(inner, lookup)),
      };
    case "paragraph":
    case "quote":
    case "header":
    case "context":
    case "actions":
    case "image":
      return { ...block, inline: renderInline(block.inline, lookup) };
  }
}

/** The one line of plain text a message shows when it has only a fallback. */
function fallbackBlock(
  text: string,
  lookup: MessageTextLookup,
): ContentBlock<StyledSegment>[] {
  const segments = renderMessageText(text, lookup)
    .map((segment, index, all) => {
      let shown = segment.text.replace(/\s+/g, " ");

      if (index === 0) {
        shown = shown.trimStart();
      }

      if (index === all.length - 1) {
        shown = shown.trimEnd();
      }

      return { ...segment, text: shown };
    })
    .filter((segment) => segment.text !== "");

  return segments.length > 0 ? [{ kind: "paragraph", inline: segments }] : [];
}

/** Text for comparing summaries: no markup characters, case or spacing differences. */
function comparable(text: string): string {
  return text
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The plain text of the blocks that carry inline text, one entry per block. */
function plainTexts(blocks: ContentBlock<StyledSegment>[]): string[] {
  return blocks.flatMap((block): string[] => {
    switch (block.kind) {
      case "paragraph":
      case "quote":
      case "header":
      case "context":
        return [block.inline.map((segment) => segment.text).join("")];
      default:
        return [];
    }
  });
}

/** Whether a message's summary text only repeats an attachment's fallback, pretext, title or text. */
function repeatsAttachment(
  text: string,
  attachments: ContentBlock<StyledSegment>[],
  lookup: MessageTextLookup,
): boolean {
  const summary = comparable(
    renderMessageText(text, lookup)
      .map((segment) => segment.text)
      .join(""),
  );

  return attachments.some((attachment) => {
    if (attachment.kind !== "attachment") {
      return false;
    }

    const candidates = [
      ...(attachment.fallback
        ? [
            renderMessageText(attachment.fallback, lookup)
              .map((segment) => segment.text)
              .join(""),
          ]
        : []),
      ...plainTexts(attachment.pretext),
      ...plainTexts(attachment.blocks),
    ];

    return candidates.some((candidate) => comparable(candidate) === summary);
  });
}

/**
 * What a message says, as display blocks, in the order Slack shows them:
 * the message's blocks (`body`: `rich_text` and Block Kit layout), then its
 * attachments. A message with block content shows that and not its `text`,
 * which is only the notification summary there. Otherwise its `text` is read
 * as mrkdwn and shown before the attachments, unless it just repeats one of
 * them (as bots often do), when it is left out so the summary isn't shown
 * twice. A message with neither shows its fallback text from attachments and
 * blocks as one plain line. Never throws.
 */
export function renderMessageBody(
  content: Pick<MessageContent, "text" | "fallbackText" | "body">,
  lookup: MessageTextLookup = {},
): ContentBlock<StyledSegment>[] {
  const rendered = (content.body ?? []).map((block) =>
    renderBlock(block, lookup),
  );
  const attachments = rendered.filter((block) => block.kind === "attachment");
  const layout = rendered.filter((block) => block.kind !== "attachment");
  const hasText = content.text.trim() !== "";
  const lead =
    layout.length === 0 &&
    hasText &&
    !repeatsAttachment(content.text, attachments, lookup)
      ? parseMrkdwn(content.text).map((block) => renderBlock(block, lookup))
      : layout;
  const shown = [...lead, ...attachments];

  if (shown.length > 0) {
    return shown;
  }

  return content.fallbackText?.trim()
    ? fallbackBlock(content.fallbackText, lookup)
    : [];
}
