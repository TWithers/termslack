import type { Conversation, ConversationKind } from "../../session/events";
import { isObject, optionalString } from "./shared";

function booleanFlag(value: unknown): boolean {
  return value === true;
}

/**
 * Turns a conversation object from `users.conversations` or
 * `conversations.info` into termslack's own type. Returns undefined when it has no
 * usable ID.
 */
export function convertConversation(raw: unknown): Conversation | undefined {
  if (!isObject(raw) || typeof raw.id !== "string" || raw.id === "") {
    return undefined;
  }

  const kind: ConversationKind = booleanFlag(raw.is_im)
    ? "im"
    : booleanFlag(raw.is_mpim)
      ? "mpim"
      : booleanFlag(raw.is_private) || booleanFlag(raw.is_group)
        ? "group"
        : "channel";
  const isDirect = kind === "im" || kind === "mpim";

  return {
    id: raw.id,
    kind,
    name: optionalString(raw.name),
    isArchived: booleanFlag(raw.is_archived),
    isMember: isDirect || booleanFlag(raw.is_member),
    userId: kind === "im" ? optionalString(raw.user) : undefined,
    memberCount:
      typeof raw.num_members === "number" && raw.num_members >= 0
        ? raw.num_members
        : undefined,
    updated:
      typeof raw.updated === "number" && raw.updated > 0
        ? raw.updated
        : undefined,
  };
}

/** What Slack says about a channel, for the channel details popup. Text is Slack's markup as sent. */
export type ChannelDetails = {
  id: string;
  name?: string;
  isPrivate: boolean;
  /** Empty when there is none. */
  topic: string;
  /** Slack's "purpose"; empty when there is none. */
  description: string;
  creatorId?: string;
  /** When it was created (seconds since the epoch). */
  created?: number;
  memberCount?: number;
};

/** The channel a `conversations.info` response describes. Returns undefined when it has no usable channel. */
export function convertChannelDetails(
  response: Record<string, any>,
): ChannelDetails | undefined {
  const channel = convertConversation(response.channel);

  if (!channel || !isObject(response.channel)) {
    return undefined;
  }

  const raw = response.channel;
  const valueOf = (field: unknown) =>
    isObject(field) && typeof field.value === "string" ? field.value : "";

  return {
    id: channel.id,
    name: channel.name,
    isPrivate: channel.kind === "group",
    topic: valueOf(raw.topic),
    description: valueOf(raw.purpose),
    creatorId: optionalString(raw.creator),
    created:
      typeof raw.created === "number" && raw.created > 0
        ? raw.created
        : undefined,
    memberCount: channel.memberCount,
  };
}

/**
 * The DM a `conversations.open` response names. Slack answers with little
 * more than the ID, so the rest is what termslack asked for: a DM with `userId`.
 * Returns undefined when the response has no usable conversation.
 */
export function convertOpenedDirectMessage(
  response: Record<string, any>,
  userId: string,
): Conversation | undefined {
  return isObject(response.channel)
    ? convertConversation({ ...response.channel, is_im: true, user: userId })
    : undefined;
}

/**
 * The channel a `conversations.join` response names, which Slack answers with
 * in full, with a warning of `already_in_channel` when the user was in it.
 * Either way the user is now a member. Returns undefined when the response
 * has no usable channel.
 */
export function convertJoinedChannel(
  response: Record<string, any>,
): Conversation | undefined {
  const channel = convertConversation(response.channel);

  return channel && { ...channel, isMember: true };
}

export type ConversationsPage = {
  conversations: Conversation[];
  /** Cursor for the next page; undefined on the last one. */
  nextCursor?: string;
  issues: string[];
};

function readPage(response: Record<string, any>): ConversationsPage {
  const issues: string[] = [];
  const entries = Array.isArray(response.channels) ? response.channels : [];

  if (!Array.isArray(response.channels)) {
    issues.push("missing channels");
  }

  const conversations: Conversation[] = [];

  for (const entry of entries) {
    const conversation = convertConversation(entry);

    if (conversation) {
      conversations.push(conversation);
    } else {
      issues.push("skipped a conversation without an id");
    }
  }

  return {
    conversations,
    nextCursor: optionalString(response.response_metadata?.next_cursor),
    issues,
  };
}

/**
 * Reads one page of `conversations.list` for public channels: the ones that
 * aren't archived, each with whether the user is in it.
 */
export function convertPublicChannelsPage(
  response: Record<string, any>,
): ConversationsPage {
  const page = readPage(response);

  return {
    ...page,
    conversations: page.conversations.filter(
      ({ kind, isArchived }) => kind === "channel" && !isArchived,
    ),
  };
}

/** Reads one page of `users.conversations`; every conversation in it is one the user is in. */
export function convertConversationsPage(
  response: Record<string, any>,
): ConversationsPage {
  const page = readPage(response);

  return {
    ...page,
    conversations: page.conversations.map((conversation) => ({
      ...conversation,
      isMember: true,
    })),
  };
}

/** The member IDs from `conversations.members`. */
export function convertMemberIds(response: Record<string, any>): string[] {
  return Array.isArray(response.members)
    ? response.members.filter(
        (id: unknown): id is string => typeof id === "string" && id !== "",
      )
    : [];
}

/** What a `conversations.info` response says about the user's reading of a conversation. */
export type ReadState = {
  /** When the user last read it (none: never). */
  lastRead?: string;
  /**
   * How many messages are unread, when Slack says (DMs do; channels don't, and
   * group DMs aren't verified). Absent means unknown, not zero.
   */
  unreadCount?: number;
};

/** The `last_read` timestamp and unread count of a `conversations.info` response. */
export function convertReadState(response: Record<string, any>): ReadState {
  const lastRead = optionalString(response.channel?.last_read);
  const count =
    response.channel?.unread_count_display ?? response.channel?.unread_count;

  return {
    lastRead: lastRead === "" ? undefined : lastRead,
    unreadCount:
      typeof count === "number" && Number.isInteger(count) && count >= 0
        ? count
        : undefined,
  };
}
