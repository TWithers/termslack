import type { WebClient } from "@slack/web-api";
import { openDirectMessage } from "../slack/conversations";
import type { Clock } from "./clock";
import {
  callSlack,
  type ConversationResult,
  dedupeByKey,
} from "./conversationCommand";
import type { DmActivity } from "./dmActivity";
import type { Conversation } from "./events";
import { describeFailure } from "./failureText";
import { missingScopeText, type Scopes } from "./scopes";

export type DirectMessages = {
  /** Opens the DM with a person, creating it if there is none (see `WorkspaceSession.startDirectMessage`). */
  start(userId: string): Promise<ConversationResult>;
};

const startFailures: Record<string, string> = {
  user_not_found: "Slack can't find that person.",
  user_disabled:
    "That person's account is deactivated, so you can't message them.",
  cannot_dm_bot: "Slack doesn't allow direct messages with that bot.",
};

/** Why starting a DM was refused, in words for the status bar. */
export function describeStartFailure(error: unknown): string {
  return describeFailure(error, {
    failures: startFailures,
    missingScope: missingScopeText("dm", "start direct messages"),
    refused: "Slack refused to start the direct message",
    couldnt: "Couldn't start the direct message",
  });
}

/** The parts of the workspace store starting a DM uses. */
export type DirectMessageStore = {
  conversations(): Conversation[];
  conversation(id: string): Conversation | undefined;
  setConversation(conversation: Conversation): void;
};

/**
 * Starting a DM with a person. Slack's `conversations.open` creates the DM
 * or answers with the one that exists, including one the store hasn't heard
 * of, so the store keeps one entry per conversation either way. The DM
 * counts as active now, which puts it in the sidebar's recent DMs.
 */
export function createDirectMessages({
  client,
  scopes,
  clock,
  store,
  dms,
}: {
  client: () => WebClient;
  scopes: Pick<Scopes, "problem">;
  clock: Clock;
  store: DirectMessageStore;
  dms: Pick<DmActivity, "observe">;
}): DirectMessages {
  async function open(userId: string): Promise<ConversationResult> {
    const known = store
      .conversations()
      .find(
        (conversation) =>
          conversation.kind === "im" && conversation.userId === userId,
      );

    if (known) {
      return { ok: true, conversationId: known.id };
    }

    const opened = await callSlack({
      problem: scopes.problem("dm"),
      call: () => openDirectMessage(client(), userId),
      describe: describeStartFailure,
    });

    if (!opened.ok) {
      return opened;
    }

    const conversation = opened.value;

    if (!store.conversation(conversation.id)) {
      store.setConversation(conversation);
    }

    dms.observe(conversation.id, (clock.now() / 1000).toFixed(6));

    return { ok: true, conversationId: conversation.id };
  }

  return { start: dedupeByKey(open) };
}
