import type { WebClient } from "@slack/web-api";
import type { Conversation } from "../session/events";
import type { LookupResult } from "../session/nameResolver";
import {
  convertChannelDetails,
  convertConversation,
  convertConversationsPage,
  convertReadState,
  convertMemberIds,
  convertOpenedDirectMessage,
  convertJoinedChannel,
  convertPublicChannelsPage,
  type ChannelDetails,
  type ConversationsPage,
  type ReadState,
} from "./convert";
import { slackErrorCode } from "./errors";
import { lookup } from "./lookup";

const noAccessErrors = new Set([
  "channel_not_found",
  "no_permission",
  "channel_is_limited_access",
]);

export const conversationTypes = "public_channel,private_channel,mpim,im";

/** One page of the conversations the user is in. Rejects with Slack's error. */
export async function fetchConversationsPage(
  client: WebClient,
  cursor?: string,
): Promise<ConversationsPage> {
  return convertConversationsPage(
    await client.users.conversations({
      types: conversationTypes,
      limit: 200,
      cursor,
    }),
  );
}

/**
 * One page of the workspace's public channels that aren't archived, whether
 * or not the user is in them. Rejects with Slack's error.
 */
export async function fetchPublicChannelsPage(
  client: WebClient,
  cursor?: string,
): Promise<ConversationsPage> {
  return convertPublicChannelsPage(
    await client.conversations.list({
      types: "public_channel",
      exclude_archived: true,
      limit: 200,
      cursor,
    }),
  );
}

/** Looks up a single conversation; not found and no access are definite answers. */
export async function fetchConversation(
  client: WebClient,
  id: string,
): Promise<LookupResult<Conversation>> {
  return lookup(
    async () =>
      convertConversation(
        (await client.conversations.info({ channel: id })).channel,
      ),
    noAccessErrors,
  );
}

/**
 * Asks Slack for a channel's topic, purpose, creator, creation time and
 * member count. Rejects with Slack's error (`channel_not_found`,
 * `missing_scope`, ...).
 */
export async function fetchChannelDetails(
  client: WebClient,
  id: string,
): Promise<ChannelDetails> {
  const details = convertChannelDetails(
    await client.conversations.info({
      channel: id,
      include_num_members: true,
    }),
  );

  if (!details) {
    throw new Error("Slack didn't describe that channel");
  }

  return details;
}

/**
 * Opens the DM with a person, which Slack creates if there is none and
 * otherwise answers with the existing one. Rejects with Slack's error
 * (`user_not_found`, `user_disabled`, `missing_scope`, ...).
 */
export async function openDirectMessage(
  client: WebClient,
  userId: string,
): Promise<Conversation> {
  const conversation = convertOpenedDirectMessage(
    await client.conversations.open({ users: userId }),
    userId,
  );

  if (!conversation) {
    throw new Error("Slack didn't say which conversation it opened");
  }

  return conversation;
}

/**
 * Joins a public channel. Slack answers with the channel, and joining one
 * the user is already in is fine (`already_in_channel` is only a warning).
 * Rejects with Slack's error (`is_archived`, `missing_scope`,
 * `method_not_supported_for_channel_type`, ...).
 */
export async function joinChannel(
  client: WebClient,
  id: string,
): Promise<Conversation> {
  const channel = convertJoinedChannel(
    await client.conversations.join({ channel: id }),
  );

  if (!channel) {
    throw new Error("Slack didn't say which channel it joined");
  }

  return channel;
}

/**
 * Leaves a public or private channel. Leaving one the user is already out of
 * is fine (Slack answers `not_in_channel: true`), so any answer without an
 * error means the user is out. Rejects with Slack's error (`cant_leave_general`,
 * `last_member`, `missing_scope`, ...).
 */
export async function leaveChannel(
  client: WebClient,
  id: string,
): Promise<void> {
  await client.conversations.leave({ channel: id });
}

/** A conversation's member IDs, as `conversations.members` lists them. */
export type ConversationMembers = {
  id: string;
  memberIds: string[];
};

/**
 * The members of a group DM. One page is enough: group DMs hold at most nine
 * people. No access is a definite answer.
 */
export async function fetchConversationMembers(
  client: WebClient,
  id: string,
): Promise<LookupResult<ConversationMembers>> {
  return lookup(async () => {
    const response = await client.conversations.members({
      channel: id,
      limit: 100,
    });

    return { id, memberIds: convertMemberIds(response) };
  }, noAccessErrors);
}

/** How the user has read a conversation (see `ReadState`). */
export type ConversationReadState =
  ({ status: "found" } & ReadState) | { status: "gone" } | { status: "failed" };

/** Asks `conversations.info` how the user has read a conversation. Never rejects. */
export async function fetchReadState(
  client: WebClient,
  id: string,
): Promise<ConversationReadState> {
  try {
    const response = await client.conversations.info({ channel: id });

    return { status: "found", ...convertReadState(response) };
  } catch (error) {
    return noAccessErrors.has(slackErrorCode(error) ?? "")
      ? { status: "gone" }
      : { status: "failed" };
  }
}

/** Errors that mean Slack won't let this token mark conversations read, however often it's asked. */
const markUnsupportedErrors = new Set([
  "missing_scope",
  "not_allowed_token_type",
  "invalid_auth",
  "token_revoked",
  "account_inactive",
  "access_denied",
]);

export type MarkResult = "marked" | "unsupported" | "failed";

/** Marks a conversation read up to `ts` (`conversations.mark`). Never rejects. */
export async function markConversationRead(
  client: WebClient,
  id: string,
  ts: string,
): Promise<MarkResult> {
  try {
    await client.conversations.mark({ channel: id, ts });

    return "marked";
  } catch (error) {
    return markUnsupportedErrors.has(slackErrorCode(error) ?? "")
      ? "unsupported"
      : "failed";
  }
}
