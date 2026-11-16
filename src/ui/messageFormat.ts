import type { StyledSegment } from "../session/content";
import type { Author, Bot, Message, MessageContent } from "../session/events";
import {
  type MessageSegment,
  type MessageTextLookup,
  renderMessageText,
} from "../session/messageText";
import { personName } from "../session/people";
import { theme } from "./theme";

/** What a view may ask the store for. Everything is optional; unknown things show as raw IDs. */
export type NameLookup = MessageTextLookup & {
  bot?(id: string): Bot | undefined;
  message?(channelId: string, ts: string): Message | undefined;
};

/** How a segment is drawn; each view turns this into its own styling. */
export type SegmentStyle = {
  text: string;
  color?: string;
  backgroundColor?: string;
  underline?: boolean;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  /** Dim text drawn after the segment: a link's address when it differs from its label. */
  trailing?: string;
  /** Where the segment, and its trailing address, link to. */
  url?: string;
};

/** Says how each kind of segment looks; the renderer only says what the pieces are. `currentUserId` is who is looking, so a mention of them stands out. */
export function segmentStyle(
  segment: StyledSegment,
  currentUserId?: string,
): SegmentStyle {
  const style = segment.style;
  const base = kindStyle(segment, currentUserId);

  if (!style) {
    return base;
  }

  return {
    ...base,
    ...(base.color === undefined && style.code ? inlineCodeStyle() : {}),
    bold: style.bold,
    italic: style.italic,
    strikethrough: style.strike,
  };
}

const inlineCodeStyle = () => ({
  color: theme.inlineCodeText,
  backgroundColor: theme.inlineCodeBackground,
});

function kindStyle(
  segment: MessageSegment,
  currentUserId?: string,
): SegmentStyle {
  switch (segment.kind) {
    case "text":
    case "emoji":
      return { text: segment.text };
    case "user":
      return segment.userId === currentUserId
        ? {
            text: segment.text,
            color: theme.mentionOfYouText,
            backgroundColor: theme.mentionOfYouBackground,
          }
        : {
            text: segment.text,
            color: theme.mentionText,
            backgroundColor: theme.mentionBackground,
          };
    case "userGroup":
      return {
        text: segment.text,
        color: theme.mentionText,
        backgroundColor: theme.mentionBackground,
      };
    case "broadcast":
      return {
        text: segment.text,
        color: theme.broadcastText,
        backgroundColor: theme.broadcastBackground,
      };
    case "channel":
      return { text: segment.text, color: theme.channelLinkText };
    case "link":
      return {
        text: segment.text,
        color: theme.linkText,
        underline: true,
        url: segment.url,
        ...(segment.text === segment.url
          ? {}
          : { trailing: `(${segment.url})` }),
      };
  }
}

/** A message author: the person's name, else the bot's name, else the raw ID. */
export function messageAuthor(source: Author, lookup: NameLookup): string {
  if (source.userId) {
    const user = lookup.user?.(source.userId);

    if (user || !source.botName) {
      return personName(user, source.userId);
    }
  }

  if (source.botName) {
    return source.botName;
  }

  return (
    (source.botId && lookup.bot?.(source.botId)?.name) || source.botId || "?"
  );
}

export const noText = "[no text]";

/** One part of a message body: rendered text, rendered fallback text (on one line), or the file names. */
export type BodyPart =
  | { kind: "text"; segments: MessageSegment[] }
  | { kind: "fallback"; segments: MessageSegment[] }
  | { kind: "files"; text: string };

export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function fileList(content: MessageContent): string {
  return content.files.length > 0 ? `[files: ${content.files.join(", ")}]` : "";
}

/** Collapses whitespace across segments as `oneLine` does for a string. */
function onOneLine(segments: MessageSegment[]): MessageSegment[] {
  return segments
    .map((segment, index) => {
      let text = segment.text.replace(/\s+/g, " ");

      if (index === 0) {
        text = text.trimStart();
      }

      if (index === segments.length - 1) {
        text = text.trimEnd();
      }

      return { ...segment, text };
    })
    .filter((segment) => segment.text !== "");
}

/**
 * What a message says: its text, else the plain-text version of its
 * attachments and blocks, followed by its file names. Empty when it has none
 * of those (views show `noText`).
 */
export function messageBodyParts(
  content: MessageContent,
  lookup: NameLookup,
): BodyPart[] {
  const hasText = content.text.trim() !== "";
  const fallback = !hasText && content.fallbackText?.trim();
  const files = fileList(content);
  const parts: BodyPart[] = [];

  if (hasText) {
    parts.push({
      kind: "text",
      segments: renderMessageText(content.text, lookup),
    });
  }

  if (fallback) {
    const segments = onOneLine(renderMessageText(fallback, lookup));

    if (segments.length > 0) {
      parts.push({ kind: "fallback", segments });
    }
  }

  if (files) {
    parts.push({ kind: "files", text: files });
  }

  return parts;
}
