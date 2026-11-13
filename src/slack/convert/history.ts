import type { Message, Reaction } from "../../session/events";
import { messageContent } from "./blocks";
import { botProfileName } from "./messages";
import { isObject, optionalString } from "./shared";

/** Reads the `reactions` of a history message; entries without a name are skipped. */
function convertReactions(raw: unknown): Reaction[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.flatMap((entry): Reaction[] => {
    if (
      !isObject(entry) ||
      typeof entry.name !== "string" ||
      entry.name === ""
    ) {
      return [];
    }

    const userIds = Array.isArray(entry.users)
      ? entry.users.filter((id): id is string => typeof id === "string")
      : [];
    const count =
      typeof entry.count === "number" && entry.count >= 0
        ? entry.count
        : userIds.length;

    return [
      { name: entry.name, userIds, count: Math.max(count, userIds.length) },
    ];
  });
}

/**
 * Turns a message from `conversations.history` or `conversations.replies`
 * into termslack's own type. Undefined when it has no `ts`.
 */
export function convertHistoryMessage(
  channelId: string,
  raw: unknown,
): Message | undefined {
  if (!isObject(raw) || typeof raw.ts !== "string" || raw.ts === "") {
    return undefined;
  }

  return {
    channelId,
    ts: raw.ts,
    threadTs: optionalString(raw.thread_ts),
    userId: optionalString(raw.user),
    botId: optionalString(raw.bot_id),
    botName: optionalString(raw.username) ?? botProfileName(raw),
    ...messageContent(raw),
    subtype: optionalString(raw.subtype),
    replyCount:
      typeof raw.reply_count === "number" && raw.reply_count >= 0
        ? raw.reply_count
        : undefined,
    reactions: convertReactions(raw.reactions),
    isEdited: isObject(raw.edited),
    isDeleted: false,
  };
}

export type MessagesPage = {
  /** In the order Slack sent them (history: newest first; replies: oldest first). */
  messages: Message[];
  /** Cursor for the next page; undefined on the last one. */
  nextCursor?: string;
  issues: string[];
};

/** Reads one page of `conversations.history` or `conversations.replies`. */
export function convertMessagesPage(
  channelId: string,
  response: Record<string, any>,
): MessagesPage {
  const issues: string[] = [];
  const entries = Array.isArray(response.messages) ? response.messages : [];

  if (!Array.isArray(response.messages)) {
    issues.push("missing messages");
  }

  const messages: Message[] = [];

  for (const entry of entries) {
    const message = convertHistoryMessage(channelId, entry);

    if (message) {
      messages.push(message);
    } else {
      issues.push("skipped a message without a ts");
    }
  }

  return {
    messages,
    nextCursor: optionalString(response.response_metadata?.next_cursor),
    issues,
  };
}

/** What Slack answered to `chat.postMessage`. */
export type PostedMessage = {
  ts: string;
  /** The message as Slack stored it, when the response included it. */
  message?: Message;
};

/** Reads the response to `chat.postMessage`. Undefined when it has no `ts`. */
export function convertPostedMessage(
  channelId: string,
  response: Record<string, any>,
): PostedMessage | undefined {
  const ts = optionalString(response.ts);

  if (ts === undefined) {
    return undefined;
  }

  return {
    ts,
    message: convertHistoryMessage(channelId, { ts, ...response.message }),
  };
}
