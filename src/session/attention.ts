import {
  isDirectMessage,
  replyParentOf,
  type ConversationKind,
  type MessageContent,
  type Author,
} from "./events";
import { mentionedIds } from "./messageText";

/** How much a new message should call for the user's attention. */
export type Attention = "none" | "unread" | "mention";

/** What decides a message's attention. Shared by the sidebar markers and, later, notifications. */
export type AttentionContext = {
  currentUserId: string;
  /** The conversation's kind, when known. DMs and group DMs always mention. */
  conversationKind?: ConversationKind;
  /** Whether the current user belongs to a user group. */
  isInUserGroup(id: string): boolean;
};

export type AttentionMessage = MessageContent &
  Author & {
    ts: string;
    threadTs?: string;
    subtype?: string;
  };

/*
 * Subtypes that are somebody saying something. They mark a conversation
 * unread; every other subtype only counts when it mentions the user or
 * arrives in a DM.
 */
const spokenSubtypes = new Set([
  undefined,
  "file_share",
  "thread_broadcast",
  "bot_message",
  "me_message",
]);

/*
 * Membership and channel-housekeeping messages. They never mark anything,
 * whatever they mention and wherever they arrive.
 */
const noiseSubtypes = new Set([
  "channel_join",
  "channel_leave",
  "group_join",
  "group_leave",
  "channel_topic",
  "channel_purpose",
  "channel_name",
  "channel_archive",
  "channel_unarchive",
  "channel_convert_to_private",
  "channel_convert_to_public",
  "group_topic",
  "group_purpose",
  "group_name",
  "group_archive",
  "group_unarchive",
  "pinned_item",
  "unpinned_item",
  "message_changed",
  "message_deleted",
  "message_replied",
  "bot_add",
  "bot_remove",
  "ekm_access_denied",
]);

function mentionsIn(message: AttentionMessage) {
  return mentionedIds(
    [message.text, message.fallbackText].filter(Boolean).join(" "),
  );
}

/** Whether a new message is one a person would call "a new message": not an edit, a join, or a reply buried in a thread. */
export function isNewTalk(message: AttentionMessage): boolean {
  if (!spokenSubtypes.has(message.subtype)) {
    return false;
  }

  const isThreadReply = replyParentOf(message) !== undefined;

  return !isThreadReply || message.subtype === "thread_broadcast";
}

/**
 * Whether a new message mentions the user: `<@me>`, a user group they are in,
 * `@here`, `@channel` or `@everyone`, or anything said in a DM or group DM.
 */
export function mentionsUser(
  message: AttentionMessage,
  context: AttentionContext,
): boolean {
  if (isDirectMessage(context.conversationKind)) {
    return true;
  }

  const { userIds, userGroupIds, broadcasts } = mentionsIn(message);

  return (
    userIds.includes(context.currentUserId) ||
    broadcasts.length > 0 ||
    userGroupIds.some(context.isInUserGroup)
  );
}

/**
 * What a newly arrived message deserves, ignoring whether its conversation is open.
 * A mention (or anything in a DM) counts in threads and for any subtype but
 * membership noise; plain talk only marks unread when it is in the conversation itself.
 */
export function messageAttention(
  message: AttentionMessage,
  context: AttentionContext,
): Attention {
  if (
    message.userId === context.currentUserId ||
    noiseSubtypes.has(message.subtype ?? "")
  ) {
    return "none";
  }

  if (mentionsUser(message, context)) {
    return "mention";
  }

  return isNewTalk(message) ? "unread" : "none";
}

/** Whether a message mentions any user group (so membership matters before judging it). */
export function mentionsUserGroup(message: AttentionMessage): boolean {
  return mentionsIn(message).userGroupIds.length > 0;
}
