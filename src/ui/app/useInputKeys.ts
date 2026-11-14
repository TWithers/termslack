import type { Key } from "ink";
import { addMention } from "../../session/mentions";
import type { WorkspaceSession } from "../../session/workspaceSession";
import { handleInputKey } from "../input/inputKeys";
import { emptyInput, inputOf, isBlank } from "../input/textInput";
import type { Composer } from "../input/useComposer";
import type { useDrafts } from "../input/useDrafts";
import { type Focus, type InputPane, listFor } from "./focus";
import type { Editing, MessageActions } from "./useMessageActions";
import type { ThreadPane } from "./useThreadPane";

/**
 * What the keys do while an input has the focus: choosing from its
 * completion list, editing the draft, sending it (or saving the edit it
 * holds), Ctrl+T for "also send to channel", and leaving for its list.
 * `report` is the status line's message line, for why a send failed.
 */
export function useInputKeys({
  session,
  drafts,
  openId,
  composers,
  thread,
  resetMessages,
  actions,
  focusedEdit,
  writeProblem,
  requestFocus,
  nextFocus,
  report,
}: {
  session: WorkspaceSession;
  drafts: ReturnType<typeof useDrafts>;
  /** The open conversation. */
  openId?: string;
  composers: Record<InputPane, Composer>;
  thread: ThreadPane;
  /** Puts the conversation's list back at the newest message, as after sending. */
  resetMessages(): void;
  actions: MessageActions;
  /** The edit open in the focused input, if any: Enter and Esc there save or cancel it. */
  focusedEdit?: Editing;
  /** Why writing is off (the token lacks `chat:write`), or undefined. */
  writeProblem?: string;
  requestFocus(focus: Focus): void;
  nextFocus(): Focus;
  report(message: string | undefined): void;
}): (pane: InputPane, input: string, key: Key) => void {
  /**
   * Sends what a composer holds. A failure puts the text (and mentions) back
   * so nothing is lost, with `restore` undoing whatever the send reset.
   */
  function sendFrom(
    from: Composer,
    to: { conversationId: string; threadTs?: string; broadcast?: boolean },
    { reset, restore }: { reset: () => void; restore: () => void },
  ) {
    const { place, draft } = from;

    if (place === undefined || isBlank(draft.text)) {
      return;
    }

    const { text } = draft;
    const mentions = drafts.mentions(place);

    drafts.set(place, emptyInput);
    reset();
    report(undefined);

    void session.sendMessage({ ...to, text, mentions }).then((result) => {
      if (result.ok) {
        return;
      }

      const current = drafts.get(place);

      const restored = current.text === "" ? text : `${text}\n${current.text}`;
      const kept = [...mentions, ...drafts.mentions(place)];

      drafts.set(place, inputOf(restored));
      drafts.setMentions(place, kept);
      restore();
      report(result.message);
    });
  }

  function sendDraft() {
    if (openId === undefined) {
      return;
    }

    sendFrom(
      composers.input,
      { conversationId: openId },
      { reset: resetMessages, restore: () => {} },
    );
  }

  function sendReply() {
    if (thread.conversationId === undefined || thread.threadTs === undefined) {
      return;
    }

    const broadcast = thread.alsoToChannel;

    sendFrom(
      composers.threadInput,
      {
        conversationId: thread.conversationId,
        threadTs: thread.threadTs,
        broadcast,
      },
      {
        reset() {
          thread.selection.reset();
          thread.setAlsoToChannel(false);
        },
        restore: () => thread.setAlsoToChannel(broadcast),
      },
    );
  }

  return (pane, input, key) => {
    const { place, draft, completion } = composers[pane];
    const completed = completion.onKey(input, key);

    if (completed.kind === "handled") {
      return;
    }

    if (completed.kind === "complete" && place !== undefined) {
      drafts.setMentions(
        place,
        addMention(draft.text, drafts.mentions(place), completed.mention),
      );
      drafts.set(place, completed.state);
      return;
    }

    if (key.tab) {
      requestFocus(nextFocus());
      return;
    }

    const action = handleInputKey(draft, input, key);

    if (writeProblem !== undefined && action.kind !== "leave") {
      report(writeProblem);
      return;
    }

    if (place !== undefined && action.kind === "edit") {
      drafts.set(place, action.state);
    }

    if (action.kind === "send") {
      focusedEdit
        ? actions.saveEdit()
        : pane === "input"
          ? sendDraft()
          : sendReply();
    }

    if (
      action.kind === "alsoToChannel" &&
      pane === "threadInput" &&
      !focusedEdit
    ) {
      thread.setAlsoToChannel(!thread.alsoToChannel);
    }

    if (action.kind === "leave" && focusedEdit) {
      actions.cancelEdit();
      return;
    }

    if (action.kind === "leave") {
      requestFocus(listFor(pane));
    }
  };
}
