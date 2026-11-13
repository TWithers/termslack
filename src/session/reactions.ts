import type { WebClient } from "@slack/web-api";
import { slackErrorCode } from "../slack/errors";
import { addReaction, removeReaction } from "../slack/reactions";
import type { ChangeTracker } from "./changeTracker";
import { reactionName } from "./emoji";
import type { Message, ReactionEvent } from "./events";
import { describeReactionFailure } from "./messageActionText";
import {
  unsentProblem,
  type ActionResult,
  type MessageRef,
} from "./messageActions";

export type ReactionRequest = MessageRef & {
  /** The emoji as typed: `tada`, `:tada:` or `+1::skin-tone-2`. */
  name: string;
};

export type ReactionActions = {
  /** Why the message can't be reacted to (it isn't stored: still sending, or failed), or undefined when it can. */
  reactionProblem(message: MessageRef): string | undefined;
  /** Whether the current user has reacted to the message with that emoji, as far as the store knows. */
  hasReacted(message: MessageRef, name: string): boolean;
  addReaction(request: ReactionRequest): Promise<ActionResult>;
  removeReaction(request: ReactionRequest): Promise<ActionResult>;
  /**
   * Whether a live reaction event is only the echo of a removal already shown,
   * and so must not be applied. Adding twice counts once in the store, but
   * removing twice would lower the count of a reaction whose user list is
   * truncated a second time.
   */
  isEchoOfShownRemoval(event: ReactionEvent): boolean;
};

/** The parts of the workspace store reactions change. */
export type ReactionStore = {
  message(channelId: string, ts: string): Message | undefined;
  applyReactionEvent(event: ReactionEvent): void;
};

/**
 * Adding and removing the user's reactions.
 *
 * Like editing, both show at once by applying the same change a Slack event
 * would, then ask Slack. `already_reacted` and `no_reaction` mean the line is
 * already how the user wanted it, so they are successes. Any other refusal
 * takes the change back, but only if the line still shows it: a reaction event
 * that arrived meanwhile is newer than the guess.
 */
export function createReactionActions({
  client,
  changes,
  store,
  currentUserId,
  reactProblem,
}: {
  client: () => WebClient;
  changes: ChangeTracker;
  store: ReactionStore;
  currentUserId: () => string | undefined;
  /** Why reacting is off (the token lacks `reactions:write`), or undefined. */
  reactProblem: () => string | undefined;
}): ReactionActions {
  const shownRemovals = new Set<string>();

  const keyOf = (conversationId: string, ts: string, name: string) =>
    `${conversationId}/${ts}/${name}`;

  function hasReacted({ conversationId, ts }: MessageRef, typed: string) {
    const me = currentUserId();
    const name = reactionName(typed);

    return (
      me !== undefined &&
      (store
        .message(conversationId, ts)
        ?.reactions?.some(
          (reaction) => reaction.name === name && reaction.userIds.includes(me),
        ) ??
        false)
    );
  }

  function reactionProblem(message: MessageRef) {
    return reactProblem() ?? unsentProblem(store, message);
  }

  /** Applies the user's own reaction event to the store, as Slack's echo would. */
  function apply(
    action: ReactionEvent["action"],
    { conversationId, ts }: MessageRef,
    name: string,
  ): void {
    store.applyReactionEvent({
      kind: "reaction",
      action,
      channelId: conversationId,
      userId: currentUserId() ?? "",
      reaction: name,
      messageTs: ts,
      raw: {},
      issues: [],
    });
    changes.changed();
  }

  async function change(
    action: ReactionEvent["action"],
    request: ReactionRequest,
  ): Promise<ActionResult> {
    const { conversationId, ts } = request;
    const name = reactionName(request.name);
    const verb = action === "added" ? "add" : "remove";
    const problem = reactionProblem(request);

    if (problem !== undefined) {
      return { ok: false, message: problem };
    }

    if (name === "" || currentUserId() === undefined) {
      return { ok: false, message: "Type the name of an emoji to react with." };
    }

    const key = keyOf(conversationId, ts, name);
    const wanted = action === "added";

    if (hasReacted(request, name) !== wanted) {
      apply(action, request, name);

      if (!wanted) {
        shownRemovals.add(key);
      }
    }

    try {
      const call = wanted ? addReaction : removeReaction;

      await call(client(), { channelId: conversationId, ts, name });

      return { ok: true };
    } catch (error) {
      const code = slackErrorCode(error);

      if (code === (wanted ? "already_reacted" : "no_reaction")) {
        return { ok: true };
      }

      shownRemovals.delete(key);

      if (hasReacted(request, name) === wanted) {
        apply(wanted ? "removed" : "added", request, name);
      }

      return { ok: false, message: describeReactionFailure(error, verb) };
    }
  }

  return {
    reactionProblem,
    hasReacted,
    addReaction: (request) => change("added", request),
    removeReaction: (request) => change("removed", request),

    isEchoOfShownRemoval(event) {
      if (event.userId !== currentUserId()) {
        return false;
      }

      const key = keyOf(event.channelId, event.messageTs, event.reaction);

      if (event.action === "added") {
        shownRemovals.delete(key);

        return false;
      }

      return shownRemovals.delete(key);
    },
  };
}
