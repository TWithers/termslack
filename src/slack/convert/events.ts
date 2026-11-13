import type {
  ConversationAction,
  ConversationKind,
  SlackEvent,
  UserAction,
} from "../../session/events";
import { convertDndEvent } from "./dnd";
import { convertEmojiEvent } from "./emoji";
import { convertMessage } from "./messages";
import { convertUser } from "./users";
import { convertUserGroupEvent } from "./userGroups";
import {
  isObject,
  optionalString,
  required,
  timestampOf,
  unrecognized,
} from "./shared";

/**
 * The only module that reads raw Slack socket payloads. Never throws: fields
 * that are missing fall back to empty values and are listed in `issues`.
 */
export function convertEnvelope(
  envelopeType: string,
  body: Record<string, any>,
): SlackEvent {
  try {
    return convert(envelopeType, body);
  } catch (error) {
    return unrecognized(envelopeType, body, [
      `conversion failed: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
}

function convert(envelopeType: string, body: Record<string, any>): SlackEvent {
  if (envelopeType !== "events_api" || !isObject(body.event)) {
    return unrecognized(envelopeType, body);
  }

  const event = body.event;

  if (event.type === "message") {
    return convertMessage(body, event);
  }

  if (event.type === "reaction_added" || event.type === "reaction_removed") {
    const issues: string[] = [];
    const item = isObject(event.item) ? event.item : {};

    if (item.type !== undefined && item.type !== "message") {
      return unrecognized(envelopeType, body);
    }

    return {
      kind: "reaction",
      action: event.type === "reaction_added" ? "added" : "removed",
      channelId: required(item, "channel", issues, "item.channel"),
      userId: required(event, "user", issues),
      reaction: required(event, "reaction", issues),
      messageTs: required(item, "ts", issues, "item.ts"),
      timestamp: timestampOf(event),
      raw: body,
      issues,
    };
  }

  if (event.type === "emoji_changed") {
    return convertEmojiEvent(envelopeType, body, event);
  }

  if (event.type === "dnd_updated" || event.type === "dnd_updated_user") {
    return convertDndEvent(body, event);
  }

  if (userGroupActions.has(String(event.type))) {
    return convertUserGroupEvent(body, event);
  }

  const userAction = userActions[String(event.type)];

  if (userAction) {
    return convertUserEvent(body, event, userAction);
  }

  const conversationAction = conversationActions[String(event.type)];

  if (conversationAction) {
    return convertConversationEvent(body, event, conversationAction);
  }

  return unrecognized(envelopeType, body);
}

const conversationActions: Record<string, ConversationAction> = {
  channel_created: "created",
  channel_rename: "renamed",
  channel_archive: "archived",
  channel_unarchive: "unarchived",
  channel_deleted: "deleted",
  channel_left: "left",
  group_rename: "renamed",
  group_archive: "archived",
  group_unarchive: "unarchived",
  group_deleted: "deleted",
  group_left: "left",
  member_joined_channel: "joined",
  member_left_channel: "memberLeft",
};

const userGroupActions = new Set([
  "subteam_members_changed",
  "subteam_self_added",
  "subteam_self_removed",
]);

const userActions: Record<string, UserAction> = {
  user_change: "changed",
  user_profile_changed: "profileChanged",
  user_status_changed: "statusChanged",
  team_join: "joined",
};

function convertUserEvent(
  body: Record<string, any>,
  event: Record<string, any>,
  action: UserAction,
): SlackEvent {
  const issues: string[] = [];
  const user = convertUser(event.user);

  if (!user) {
    issues.push("missing user.id");
  }

  return {
    kind: "user",
    action,
    eventType: String(event.type),
    userId: user?.id ?? "",
    user: user ?? { id: "" },
    timestamp: timestampOf(event),
    raw: body,
    issues,
  };
}

function convertConversationEvent(
  body: Record<string, any>,
  event: Record<string, any>,
  action: ConversationAction,
): SlackEvent {
  const issues: string[] = [];
  const type = String(event.type);
  const channelKind: ConversationKind =
    type.startsWith("group_") || event.channel_type === "G"
      ? "group"
      : "channel";

  // Created and renamed events carry a channel object; the rest, just its ID.
  const channel = event.channel;
  let channelId: string;
  let name: string | undefined;

  if (isObject(channel)) {
    channelId = required(channel, "id", issues, "channel.id");
    name = optionalString(channel.name);
  } else if (typeof channel === "string") {
    channelId = channel;
  } else {
    channelId = "";
    issues.push("missing channel.id");
  }

  if ((action === "created" || action === "renamed") && !name) {
    issues.push("missing channel.name");
  }

  return {
    kind: "conversation",
    action,
    eventType: type,
    channelId,
    channelKind,
    name,
    userId: optionalString(event.user ?? event.actor_id),
    timestamp: timestampOf(event),
    raw: body,
    issues,
  };
}
