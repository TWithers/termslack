import type { Key } from "ink";
import type { MessageRef } from "../../session/messageActions";
import type { WorkspaceSession } from "../../session/workspaceSession";
import { emptyInput, inputOf, isBlank } from "../input/textInput";
import type { useDrafts } from "../input/useDrafts";
import { inputFor, type InputPane, type ListPane } from "./focus";
import { pressed } from "./shortcuts";
import { useConfirmPrompt } from "./useConfirmPrompt";

/** A message being edited, in the input of the pane it was picked in. */
export type Editing = MessageRef & {
  input: InputPane;
  /** The text the input started with, to tell whether saving changes anything. */
  original: string;
};

/**
 * Where the edited text lives. It is a draft of its own, so the draft that
 * was in the input before editing is never touched and is back when the edit
 * ends, saved or cancelled.
 */
export function editPlace(editing: Editing): string {
  return `edit:${editing.conversationId}:${editing.ts}`;
}

export type MessageActions = {
  /** What the status line asks while a key is awaited; undefined when nothing is. */
  prompt?: string;
  /**
   * Handles the keys that act on the selected message of a message list
   * (`e` edit, `d` delete, `r` react, and the answer to a pending question).
   * Returns whether the key was used. Other actions on a message are added to
   * this one place.
   */
  handleKey(pane: ListPane, input: string, key: Key): boolean;
  /** Cancels a pending question, as `n` does. */
  cancelPrompt(): void;
  /** Saves the edit with the text now in the input, or says why it can't be saved. */
  saveEdit(): void;
  /** Ends the edit without saving and returns to the list it began in. */
  cancelEdit(): void;
  /** Ends the edit without moving focus, for when the list or conversation changes. */
  discardEdit(): void;
};

/**
 * The actions on the selected message of either list: editing and deleting
 * the user's own messages, and reacting to any message. `report` is the status line's message line, for
 * hints and for why Slack refused.
 *
 * Deleting asks first (see `useConfirmPrompt`): `prompt` is shown and the next
 * key answers it, and nothing else sees that key.
 */
export function useMessageActions({
  session,
  conversationId,
  selectedTs,
  drafts,
  editing,
  setEditing,
  focusInput,
  focusList,
  startReaction,
  report,
}: {
  session: WorkspaceSession;
  /** The open conversation. */
  conversationId?: string;
  /** The selected message of `pane`, for each pane. */
  selectedTs(pane: ListPane): string | undefined;
  drafts: ReturnType<typeof useDrafts>;
  editing?: Editing;
  setEditing(editing: Editing | undefined): void;
  focusInput(input: InputPane): void;
  focusList(input: InputPane): void;
  /** Opens the emoji prompt for a message (see `useReactionPrompt`). */
  startReaction(message: MessageRef): void;
  report(message: string | undefined): void;
}): MessageActions {
  const confirmDelete = useConfirmPrompt<MessageRef>({
    confirmId: "delete.confirm",
    question: () => "Delete this message?",
    report,
    run(message) {
      void session.deleteMessage(message).then((result) => {
        report(result.ok ? undefined : result.message);
      });
    },
  });

  function discardEdit() {
    if (editing) {
      drafts.set(editPlace(editing), emptyInput);
      drafts.setMentions(editPlace(editing), []);
      setEditing(undefined);
    }
  }

  function startEdit(pane: ListPane, { conversationId, ts }: MessageRef) {
    const problem = session.modifyProblem({ conversationId, ts }, "edit");
    const draft = session.editDraft({ conversationId, ts });

    if (problem !== undefined || !draft) {
      report(problem ?? "That message can't be edited.");
      return;
    }

    discardEdit();
    report(undefined);

    const next: Editing = {
      conversationId,
      ts,
      input: inputFor(pane),
      original: draft.text,
    };

    drafts.set(editPlace(next), inputOf(draft.text));
    drafts.setMentions(editPlace(next), draft.mentions);
    setEditing(next);
    focusInput(next.input);
  }

  function startReact(message: MessageRef) {
    const { conversationId, ts } = message;
    const problem = session.reactionProblem(message);

    report(problem);

    if (problem === undefined) {
      startReaction(message);
    }
  }

  return {
    prompt: confirmDelete.prompt,
    cancelPrompt: confirmDelete.cancel,

    handleKey(pane, input, key) {
      if (confirmDelete.handleKey(input, key)) {
        return true;
      }

      const ts = selectedTs(pane);

      const is = (action: "edit" | "delete" | "react") =>
        pressed(`${pane}.${action}`, input, key);

      if (!(is("edit") || is("delete") || is("react"))) {
        return false;
      }

      if (!conversationId || !ts) {
        return false;
      }

      const message = { conversationId, ts };

      if (is("edit")) {
        startEdit(pane, message);
      } else if (is("delete")) {
        confirmDelete.ask(message, session.modifyProblem(message, "delete"));
      } else {
        startReact(message);
      }

      return true;
    },

    saveEdit() {
      if (!editing) {
        return;
      }

      const place = editPlace(editing);
      const { text } = drafts.get(place);

      if (isBlank(text)) {
        report("A message can't be empty. Esc cancels; d deletes the message.");
        return;
      }

      const mentions = drafts.mentions(place);
      const { conversationId, ts, input } = editing;

      discardEdit();
      focusList(input);
      report(undefined);

      void session
        .editMessage({ conversationId, ts, text, mentions })
        .then((result) => {
          if (!result.ok) {
            report(result.message);
          }
        });
    },

    cancelEdit() {
      if (editing) {
        const { input } = editing;

        discardEdit();
        focusList(input);
      }
    },

    discardEdit,
  };
}
