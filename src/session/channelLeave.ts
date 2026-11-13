import type { WebClient } from "@slack/web-api";
import { leaveChannel } from "../slack/conversations";
import {
  callSlack,
  type CommandResult,
  dedupeByKey,
} from "./conversationCommand";
import { type Conversation, isChannel } from "./events";
import { describeFailure } from "./failureText";
import { missingScopeText, type ScopedFeature, type Scopes } from "./scopes";

export type LeaveChannelResult = CommandResult;

export type ChannelLeaves = {
  /** Leaves a public or private channel (see `WorkspaceSession.leaveChannel`). */
  leave(conversationId: string): Promise<LeaveChannelResult>;
  /** Why the conversation can't be left without asking Slack (not a channel, or a missing scope), in words for the status bar; undefined when it can. */
  problem(conversationId: string): string | undefined;
};

const leaveFailures: Record<string, string> = {
  cant_leave_general: "Everyone is in #general, so it can't be left.",
  last_member: "You're the last member of that channel, so you can't leave it.",
  method_not_supported_for_channel_type:
    "Slack doesn't allow leaving that kind of conversation.",
  restricted_action:
    "Your workspace's settings don't let you leave that channel.",
  user_is_restricted:
    "Your account's restrictions don't let you leave channels.",
};

function leaveFeature(isPrivate: boolean): ScopedFeature {
  return isPrivate ? "leavePrivate" : "leave";
}

/** Why leaving a channel was refused, in words for the status bar. */
export function describeLeaveFailure(
  error: unknown,
  { isPrivate }: { isPrivate: boolean } = { isPrivate: false },
): string {
  return describeFailure(error, {
    failures: leaveFailures,
    missingScope: missingScopeText(
      leaveFeature(isPrivate),
      `leave ${isPrivate ? "private " : ""}channels`,
    ),
    refused: "Slack refused to let you leave the channel",
    couldnt: "Couldn't leave the channel",
  });
}

/** The parts of the workspace store leaving a channel uses. */
export type ChannelLeaveStore = {
  conversation(id: string): Conversation | undefined;
  setConversation(conversation: Conversation): void;
};

/**
 * Leaving a public or private channel. The store keeps the channel as one
 * the user isn't in (public channels then show in the switcher as ones they
 * can join), however the `channel_left` echo races the answer; applying
 * both is harmless. A channel the store knows the user is out of isn't asked
 * about again.
 */
export function createChannelLeaves({
  client,
  scopes,
  store,
}: {
  client: () => WebClient;
  scopes: Pick<Scopes, "problem">;
  store: ChannelLeaveStore;
}): ChannelLeaves {
  function problem(id: string): string | undefined {
    const conversation = store.conversation(id);

    if (!conversation || !isChannel(conversation.kind)) {
      return "Only channels can be left, not direct messages.";
    }

    return scopes.problem(leaveFeature(conversation.kind === "group"));
  }

  async function run(id: string): Promise<LeaveChannelResult> {
    const conversation = store.conversation(id);

    if (conversation && !conversation.isMember) {
      return { ok: true };
    }

    const left = await callSlack({
      problem: problem(id),
      call: () => leaveChannel(client(), id),
      describe: (error) =>
        describeLeaveFailure(error, {
          isPrivate: conversation?.kind === "group",
        }),
    });

    if (!left.ok) {
      return left;
    }

    const current = store.conversation(id);

    if (current) {
      store.setConversation({ ...current, isMember: false });
    }

    return { ok: true };
  }

  return { problem, leave: dedupeByKey(run) };
}
