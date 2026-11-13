import type { ConversationKind, SlackEvent } from "../../session/events";
import { messageContent } from "./blocks";
import { isObject, optionalString, required, timestampOf } from "./shared";

const conversationKinds = new Set<string>(["channel", "group", "im", "mpim"]);

function conversationKind(value: unknown): ConversationKind | undefined {
  return typeof value === "string" && conversationKinds.has(value)
    ? (value as ConversationKind)
    : undefined;
}

export function convertMessage(
  body: Record<string, any>,
  event: Record<string, any>,
): SlackEvent {
  const issues: string[] = [];
  const base = {
    channelId: required(event, "channel", issues),
    channelKind: conversationKind(event.channel_type),
    timestamp: timestampOf(event),
    raw: body,
    issues,
  };

  if (event.subtype === "message_changed") {
    const message = isObject(event.message) ? event.message : {};

    if (!isObject(event.message)) {
      issues.push("missing message");
    }

    return {
      kind: "messageEdited",
      ...base,
      userId: optionalString(message.user),
      botId: optionalString(message.bot_id),
      botName: optionalString(message.username) ?? botProfileName(message),
      ...messageContent(message),
      threadTs: optionalString(message.thread_ts),
      messageTs: required(message, "ts", issues, "message.ts"),
    };
  }

  if (event.subtype === "message_deleted") {
    const previous = isObject(event.previous_message)
      ? event.previous_message
      : undefined;

    return {
      kind: "messageDeleted",
      ...base,
      messageTs: required(event, "deleted_ts", issues),
      previous: previous && {
        userId: optionalString(previous.user),
        botId: optionalString(previous.bot_id),
        botName: optionalString(previous.username) ?? botProfileName(previous),
        threadTs: optionalString(previous.thread_ts),
        ...messageContent(previous),
      },
    };
  }

  const threadTs = optionalString(event.thread_ts);

  return {
    kind: "message",
    ...base,
    userId: optionalString(event.user),
    botId: optionalString(event.bot_id),
    botName: optionalString(event.username) ?? botProfileName(event),
    ...messageContent(event),
    ts: required(event, "ts", issues),
    threadTs,
    subtype: optionalString(event.subtype),
    clientMsgId: optionalString(event.client_msg_id),
  };
}

export function botProfileName(event: Record<string, any>): string | undefined {
  return isObject(event.bot_profile)
    ? optionalString(event.bot_profile.name)
    : undefined;
}
