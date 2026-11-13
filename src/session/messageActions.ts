import type { WebClient } from "@slack/web-api";
import { slackErrorCode } from "../slack/errors";
import { deleteMessage, updateMessage } from "../slack/messages";
import type { ChangeTracker } from "./changeTracker";
import type { Message } from "./events";
import {
  fromSlackText,
  type Mention,
  type MentionDirectory,
  toSlackText,
} from "./mentions";
import {
  describeDeleteFailure,
  describeEditFailure,
} from "./messageActionText";

/** Never rejects: a refusal says why in words fit for the status bar. */
export type ActionResult = { ok: true } | { ok: false; message: string };

export type MessageRef = { conversationId: string; ts: string };

export type EditRequest = MessageRef & {
  /** What the user typed. */
  text: string;
  /** Mentions picked from the completion list. */
  mentions?: Mention[];
};

/** A message's text as the input shows it, with the mentions it holds. */
export type EditDraft = { text: string; mentions: Mention[] };

export type MessageActions = {
  /** Why the current user can't edit or delete the message (not theirs, not sent yet), or undefined when they can. */
  modifyProblem(
    message: MessageRef,
    action: "edit" | "delete",
  ): string | undefined;
  /** What to put in the input to edit a stored message; undefined if the store doesn't hold it. */
  editDraft(message: MessageRef): EditDraft | undefined;
  editMessage(request: EditRequest): Promise<ActionResult>;
  deleteMessage(request: MessageRef): Promise<ActionResult>;
};

/**
 * Why nothing can be done to a message: it isn't stored, so it is still
 * sending or its send failed. Undefined when the store holds it.
 */
export function unsentProblem(
  store: { message(channelId: string, ts: string): Message | undefined },
  { conversationId, ts }: MessageRef,
): string | undefined {
  return store.message(conversationId, ts)
    ? undefined
    : "That message hasn't been sent yet.";
}

/** The parts of the workspace store the actions change. */
export type ActionStore = {
  message(channelId: string, ts: string): Message | undefined;
  /** Puts a message in place whatever the stored one says; see `WorkspaceStore.replaceMessage`. */
  replaceMessage(message: Message): Message;
};

/**
 * Editing and deleting the user's own messages.
 *
 * Both show their result at once by changing the stored message, then ask
 * Slack. Slack's `message_changed` / `message_deleted` echo applies the same
 * change again, which the store takes as a no-op, so there's nothing to
 * reconcile when it arrives, before or after the response. If Slack refuses,
 * the message is put back as it was. That is only done while the stored
 * message is still the optimistic one: if an echo or another change replaced
 * it meanwhile, the newer state is right and is left alone. Reactions and
 * reply counts that moved meanwhile are kept either way.
 */
export function createMessageActions({
  client,
  changes,
  store,
  mentionDirectory,
  currentUserId,
  writeProblem,
}: {
  client: () => WebClient;
  changes: ChangeTracker;
  store: ActionStore;
  mentionDirectory: () => MentionDirectory;
  currentUserId: () => string | undefined;
  /** Why writing is off (the token lacks `chat:write`), or undefined. */
  writeProblem: () => string | undefined;
}): MessageActions {
  function modifyProblem(
    message: MessageRef,
    action: "edit" | "delete",
  ): string | undefined {
    if (writeProblem() !== undefined) {
      return writeProblem();
    }

    const unsent = unsentProblem(store, message);

    if (unsent !== undefined) {
      return unsent;
    }

    const userId = store.message(message.conversationId, message.ts)?.userId;
    const mine = userId !== undefined && userId === currentUserId();

    return mine ? undefined : `You can only ${action} your own messages.`;
  }

  /** Puts `before` back if the stored message is still `optimistic` (judged by `unchanged`). */
  function rollBack(
    before: Message,
    unchanged: (current: Message) => boolean,
  ): void {
    const current = store.message(before.channelId, before.ts);

    if (!current || !unchanged(current)) {
      return;
    }

    store.replaceMessage({
      ...before,
      reactions: current.reactions,
      replyCount: current.replyCount,
    });
    changes.changed();
  }

  return {
    modifyProblem,

    editDraft({ conversationId, ts }) {
      const message = store.message(conversationId, ts);

      return message
        ? fromSlackText(message.text, mentionDirectory())
        : undefined;
    },

    async editMessage({ conversationId, ts, text, mentions }) {
      const problem = modifyProblem({ conversationId, ts }, "edit");

      if (problem !== undefined) {
        return { ok: false, message: problem };
      }

      if (text.trim() === "") {
        return {
          ok: false,
          message: "A message can't be empty. Delete it with d instead.",
        };
      }

      const before = store.message(conversationId, ts)!;
      const slackText = toSlackText(text.trim(), mentionDirectory(), mentions);

      if (slackText === before.text) {
        return { ok: true };
      }

      const optimistic = store.replaceMessage({
        ...before,
        text: slackText,
        fallbackText: undefined,
        body: undefined,
        isEdited: true,
      });

      changes.changed();

      try {
        await updateMessage(client(), {
          channelId: conversationId,
          ts,
          text: slackText,
        });

        return { ok: true };
      } catch (error) {
        rollBack(
          before,
          (current) => current.isEdited && current.text === optimistic.text,
        );

        return { ok: false, message: describeEditFailure(error) };
      }
    },

    async deleteMessage({ conversationId, ts }) {
      const problem = modifyProblem({ conversationId, ts }, "delete");

      if (problem !== undefined) {
        return { ok: false, message: problem };
      }

      const before = store.message(conversationId, ts)!;

      store.replaceMessage({ ...before, isDeleted: true });
      changes.changed();

      try {
        await deleteMessage(client(), { channelId: conversationId, ts });

        return { ok: true };
      } catch (error) {
        // A message Slack no longer has is as deleted as it can be.
        if (!isMessageGone(error)) {
          rollBack(before, (current) => current.isDeleted);
        }

        return { ok: false, message: describeDeleteFailure(error) };
      }
    },
  };
}

function isMessageGone(error: unknown): boolean {
  return slackErrorCode(error) === "message_not_found";
}
