import { styleText } from "node:util";
import type {
  Author,
  Bot,
  Conversation,
  ConversationEvent,
  ConversationKind,
  DndEvent,
  Message,
  MessageContent,
  MessageDeletedEvent,
  EmojiEvent,
  MessageEvent,
  ReactionEvent,
  SessionEvent,
  SlackEvent,
  User,
  UserEvent,
  UserGroupEvent,
} from "../session/events";
import { type MessageSegment, renderMessageText } from "../session/messageText";
import { emojify } from "../session/emoji";
import {
  conversationLabel,
  conversationTitle,
  personName,
} from "../session/people";
import type { WorkspaceSession } from "../session/workspaceSession";
import type { SocketStatus } from "../slack/socket";
import {
  type BodyPart,
  fileList,
  messageAuthor,
  messageBodyParts,
  type NameLookup,
  noText,
  oneLine,
  segmentStyle,
} from "./messageFormat";

export type { NameLookup };

function time(slackTimestamp?: string): string {
  const date = slackTimestamp
    ? new Date(Number.parseFloat(slackTimestamp) * 1000)
    : new Date();

  return styleText("dim", date.toLocaleTimeString("en-GB", { hour12: false }));
}

const noLookup: NameLookup = {};

function person(id: string | undefined, lookup: NameLookup): string {
  return personName(id ? lookup.user?.(id) : undefined, id ?? "");
}

/**
 * `#name` for channels, `@person` for DMs and `@a, b` for group DMs, falling
 * back to the raw ID for whatever isn't known.
 */
function channel(
  channelId: string,
  kind: ConversationKind | undefined,
  lookup: NameLookup,
): string {
  const conversation = lookup.conversation?.(channelId);
  const knownKind = conversation?.kind ?? kind;
  const name = conversation
    ? conversationLabel(conversation, {
        user: (id) => lookup.user?.(id),
        conversationMembers: (id) => lookup.conversationMembers?.(id),
        currentUserId: lookup.currentUserId,
      })
    : undefined;
  const label = name || channelId || "?";

  return styleText(
    "cyan",
    knownKind ? conversationTitle(knownKind, label) : label,
  );
}

/** The terminal colour name a kind of segment gets in the plain log, which is not themed. */
function logColour(segment: MessageSegment): "blue" | "cyan" | undefined {
  switch (segment.kind) {
    case "user":
    case "userGroup":
    case "broadcast":
      return "blue";
    case "channel":
      return "cyan";
    default:
      return undefined;
  }
}

function styleSegment(segment: MessageSegment): string {
  const { text, underline, trailing } = segmentStyle(segment);
  const color = logColour(segment);
  const colored = color ? styleText(color, text) : text;
  const styled = underline ? styleText("underline", colored) : colored;

  return trailing ? `${styled} ${styleText("dim", trailing)}` : styled;
}

function messageText(text: string, lookup: NameLookup): string {
  return renderMessageText(text, lookup).map(styleSegment).join("");
}

const snippetLength = 40;

function styleBodyPart(part: BodyPart): string {
  return part.kind === "files"
    ? styleText("dim", part.text)
    : part.segments.map(styleSegment).join("");
}

function messageBody(content: MessageContent, lookup: NameLookup): string {
  const parts = messageBodyParts(content, lookup).map(styleBodyPart);

  return parts.length > 0 ? parts.join(" ") : noText;
}

/** A short plain version of a message, to point at it; undefined when it has nothing to show. */
function snippet(
  content: MessageContent,
  lookup: NameLookup,
): string | undefined {
  const hasText = content.text.trim() !== "";
  const text = hasText ? content.text : (content.fallbackText ?? "");
  const rendered = oneLine(
    renderMessageText(text, lookup)
      .map((segment) => segment.text)
      .join(""),
  );
  const shown = rendered || fileList(content);

  if (shown === "") {
    return undefined;
  }

  return shown.length > snippetLength
    ? `${shown.slice(0, snippetLength - 1)}…`
    : shown;
}

function hasAuthor(source: Author): boolean {
  return !!(source.userId || source.botId || source.botName);
}

/** "reply in thread", or who the reply is to and what they said when the parent is stored. */
function replyLabel(event: MessageLine, lookup: NameLookup): string {
  const parent = event.threadTs
    ? lookup.message?.(event.channelId, event.threadTs)
    : undefined;

  if (!parent) {
    return "↳ reply in thread";
  }

  const parentSnippet = snippet(parent, lookup);

  return `↳ reply to ${messageAuthor(parent, lookup)}${parentSnippet ? ` ("${parentSnippet}")` : ""}`;
}

function describeDeleted(
  event: MessageDeletedEvent,
  lookup: NameLookup,
): string {
  const where = channel(event.channelId, event.channelKind, lookup);
  const known =
    lookup.message?.(event.channelId, event.messageTs) ?? event.previous;
  const who =
    known && hasAuthor(known) ? messageAuthor(known, lookup) : undefined;
  const text = known ? snippet(known, lookup) : undefined;

  if (!who && !text) {
    return `${where} message ${event.messageTs} deleted`;
  }

  return `${where} deleted message${who ? ` by ${who}` : ""}${text ? `: "${text}"` : ""}`;
}

/** The message a reaction is on: its author and a snippet when stored, else its ts. */
function reactionTarget(event: ReactionEvent, lookup: NameLookup): string {
  const target = lookup.message?.(event.channelId, event.messageTs);
  const text = target ? snippet(target, lookup) : undefined;

  return target && text
    ? `${messageAuthor(target, lookup)}: "${text}"`
    : event.messageTs;
}

const conversationVerbs: Record<ConversationEvent["action"], string> = {
  created: "created",
  renamed: "renamed",
  archived: "archived",
  unarchived: "unarchived",
  deleted: "deleted",
  left: "left",
  memberLeft: "left",
  joined: "joined",
};

/** Subtypes whose content or label already says what they are. */
const handledSubtypes = new Set(["file_share", "thread_broadcast"]);

/** What the log needs to show a message: a live event or a stored one. */
type MessageLine = MessageContent &
  Author & {
    channelId: string;
    channelKind?: ConversationKind;
    ts: string;
    threadTs?: string;
    subtype?: string;
    replyCount?: number;
  };

function replyCountLabel(replyCount: number | undefined): string {
  if (!replyCount) {
    return "";
  }

  return ` ${styleText("dim", `[${replyCount} ${replyCount === 1 ? "reply" : "replies"}]`)}`;
}

function describeMessage(event: MessageLine, lookup: NameLookup): string {
  const where = channel(event.channelId, event.channelKind, lookup);
  const who = styleText("yellow", messageAuthor(event, lookup));
  const isReply = event.threadTs && event.threadTs !== event.ts;
  const reply = isReply
    ? ` ${styleText("dim", replyLabel(event, lookup))}`
    : "";
  const isNoted = event.subtype && !handledSubtypes.has(event.subtype);
  const subtype = isNoted ? styleText("dim", ` (${event.subtype})`) : "";

  const replies = replyCountLabel(event.replyCount);

  return `${where} ${who}${subtype}${reply}${replies}: ${messageBody(event, lookup)}`;
}

function describeUser(event: UserEvent, lookup: NameLookup): string {
  const name = person(event.userId, lookup);

  switch (event.action) {
    case "joined":
      return `${name} joined the workspace`;
    case "statusChanged": {
      const { emoji = "", text = "" } =
        lookup.user?.(event.userId)?.status ?? {};
      const status = [emojify(emoji, lookup), text].filter(Boolean).join(" ");

      return status
        ? `${name} status: ${status}`
        : `${name} cleared their status`;
    }
    case "profileChanged":
      return `${name} updated their profile`;
    case "changed":
      return `${name} was updated`;
  }
}

function describeUserGroup(event: UserGroupEvent, lookup: NameLookup): string {
  const group = lookup.userGroup?.(event.userGroupId);
  const name = `@${group?.handle ?? event.userGroupId}`;
  const people = (ids: string[]) =>
    ids.map((id) => person(id, lookup)).join(", ");

  switch (event.action) {
    case "selfAdded":
      return `you joined ${name}`;
    case "selfRemoved":
      return `you left ${name}`;
    case "membersChanged":
      return [
        `${name} members changed`,
        event.addedUserIds.length > 0 && `added ${people(event.addedUserIds)}`,
        event.removedUserIds.length > 0 &&
          `removed ${people(event.removedUserIds)}`,
      ]
        .filter(Boolean)
        .join(", ");
  }
}

function describeEmoji(event: EmojiEvent): string {
  const names = event.names.map((name) => `:${name}:`).join(" ");

  return event.action === "renamed"
    ? `emoji renamed :${event.oldName}: to ${names}`
    : `emoji ${event.action}: ${names}`;
}

function describeDnd({ status }: DndEvent): string {
  if (status.snoozeEndTs !== undefined) {
    return `snoozed until ${new Date(status.snoozeEndTs * 1000).toLocaleTimeString()}`;
  }

  return status.scheduleEnabled ? "scheduled" : "off";
}

function describe(
  event: SlackEvent,
  lookup: NameLookup,
): { type: string; text: string } {
  switch (event.kind) {
    case "message":
      return { type: "message", text: describeMessage(event, lookup) };
    case "messageEdited":
      return {
        type: "message",
        text: `${channel(event.channelId, event.channelKind, lookup)} ${messageAuthor(event, lookup)} edited: ${messageBody(event, lookup)}`,
      };
    case "messageDeleted":
      return {
        type: "message",
        text: describeDeleted(event, lookup),
      };
    case "reaction":
      return {
        type: `reaction_${event.action}`,
        text: `${channel(event.channelId, undefined, lookup)} ${person(event.userId, lookup)} ${event.action === "added" ? "+" : "-"}${emojify(`:${event.reaction}:`, lookup)} on ${reactionTarget(event, lookup)}`,
      };
    case "emoji":
      return { type: "emoji_changed", text: describeEmoji(event) };
    case "conversation":
      return {
        type: event.eventType,
        text: `${channel(event.channelId, event.channelKind, lookup)} ${conversationVerbs[event.action]}${event.userId ? ` by ${person(event.userId, lookup)}` : ""}`,
      };
    case "user":
      return { type: event.eventType, text: describeUser(event, lookup) };
    case "userGroup":
      return { type: event.eventType, text: describeUserGroup(event, lookup) };
    case "dnd":
      return {
        type: event.eventType,
        text: `${person(event.userId, lookup)} Do Not Disturb ${describeDnd(event)}`,
      };
    case "unrecognized":
      return {
        type: event.eventType ?? "",
        text: JSON.stringify(event.event),
      };
  }
}

export function logSlackEvent(
  event: SlackEvent,
  raw: boolean,
  lookup: NameLookup = noLookup,
): void {
  if (raw) {
    console.log(JSON.stringify(event.raw));
    return;
  }

  if (event.kind === "unrecognized" && !event.event) {
    console.log(
      `${time()} ${styleText("magenta", event.envelopeType.padEnd(16))} ${JSON.stringify(event.raw)}`,
    );
    return;
  }

  const { type, text } = describe(event, lookup);

  console.log(
    `${time(event.timestamp)} ${styleText("magenta", type.padEnd(16))} ${text}`,
  );
}

/** Prints a stored message (from history) the way its live event was printed. */
export function logMessage(
  message: Message,
  lookup: NameLookup = noLookup,
): void {
  console.log(
    `${time(message.ts)} ${styleText("magenta", "message".padEnd(16))} ${describeMessage(message, lookup)}`,
  );
}

function printSessionEvent(
  event: SessionEvent,
  raw: boolean,
  session: WorkspaceSession,
): void {
  if (event.kind === "connection") {
    logStatus(event.status, event.error);
    return;
  }

  logSlackEvent(event, raw, session);
}

/** Prints every session event, formatted (or as raw JSON with `raw`). */
export function logSession(
  session: WorkspaceSession,
  raw: boolean,
): () => void {
  return session.subscribe((event) => printSessionEvent(event, raw, session));
}

/**
 * Like `logSession`, but keeps events back until `release`, so something else
 * (history) can print first. `release` takes a test for events not to print
 * after all, such as live messages the history already showed.
 */
export function logSessionHeld(
  session: WorkspaceSession,
  raw: boolean,
): { release(skip?: (event: SessionEvent) => boolean): void } {
  let held: SessionEvent[] | undefined = [];

  session.subscribe((event) => {
    if (held) {
      held.push(event);
      return;
    }

    printSessionEvent(event, raw, session);
  });

  return {
    release(skip = () => false) {
      const pending = held ?? [];

      held = undefined;

      for (const event of pending) {
        if (!skip(event)) {
          printSessionEvent(event, raw, session);
        }
      }
    },
  };
}

export function logStatus(status: SocketStatus, error?: Error): void {
  const detail = error ? `: ${error.message}` : "";

  console.log(styleText("dim", `${time()} ── ${status}${detail}`));
}

export function logInfo(message: string): void {
  console.log(styleText("dim", message));
}
