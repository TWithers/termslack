import type { WebClient } from "@slack/web-api";
import { joinChannel } from "../slack/conversations";
import {
  callSlack,
  type ConversationResult,
  dedupeByKey,
} from "./conversationCommand";
import type { Conversation } from "./events";
import { describeFailure } from "./failureText";
import { missingScopeText, type Scopes } from "./scopes";

export type ChannelJoins = {
  /** Joins a public channel (see `WorkspaceSession.joinChannel`). */
  join(conversationId: string): Promise<ConversationResult>;
};

const joinFailures: Record<string, string> = {
  is_archived: "That channel is archived, so it can't be joined.",
  method_not_supported_for_channel_type:
    "Slack doesn't allow joining that kind of channel.",
  restricted_action:
    "Your workspace's settings don't let you join that channel.",
  user_is_restricted:
    "Your account's restrictions don't let you join channels.",
};

/** Why joining a channel was refused, in words for the status bar. */
export function describeJoinFailure(error: unknown): string {
  return describeFailure(error, {
    failures: joinFailures,
    missingScope: missingScopeText("join", "join channels"),
    refused: "Slack refused to let you join the channel",
    couldnt: "Couldn't join the channel",
  });
}

/** The parts of the workspace store joining a channel uses. */
export type ChannelJoinStore = {
  conversation(id: string): Conversation | undefined;
  setConversation(conversation: Conversation): void;
};

/**
 * Joining a public channel. Slack's `conversations.join` answers with the
 * whole channel, also when the user was already in it, so the store keeps one
 * entry for the channel however the `member_joined_channel` echo races the
 * answer. A channel the store knows the user is in isn't asked about again.
 */
export function createChannelJoins({
  client,
  scopes,
  store,
}: {
  client: () => WebClient;
  scopes: Pick<Scopes, "problem">;
  store: ChannelJoinStore;
}): ChannelJoins {
  async function run(id: string): Promise<ConversationResult> {
    if (store.conversation(id)?.isMember) {
      return { ok: true, conversationId: id };
    }

    const joined = await callSlack({
      problem: scopes.problem("join"),
      call: () => joinChannel(client(), id),
      describe: describeJoinFailure,
    });

    if (!joined.ok) {
      return joined;
    }

    const channel = joined.value;

    store.setConversation({ ...store.conversation(channel.id), ...channel });

    return { ok: true, conversationId: channel.id };
  }

  return { join: dedupeByKey(run) };
}
