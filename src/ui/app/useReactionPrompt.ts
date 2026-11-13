import type { Key } from "ink";
import { useState } from "react";
import { emojiCompletions, reactionName } from "../../session/emoji";
import type { CompletionEntry } from "../../session/mentions";
import type { MessageRef } from "../../session/messageActions";
import type { WorkspaceSession } from "../../session/workspaceSession";
import { completionListChrome } from "../input/CompletionList";
import { handleInputKey } from "../input/inputKeys";
import { emptyInput, type InputState } from "../input/textInput";
import { useChoice } from "../input/useChoice";
import { pressed } from "./shortcuts";

/** What picking would do right now. */
export type ReactionChoice = {
  /** The name Slack gets: `tada`, `+1::skin-tone-2`. */
  name: string;
  /** Whether the user already reacted with it, so picking takes it back. */
  removes: boolean;
};

export type ReactionPrompt = {
  isOpen: boolean;
  input: InputState;
  /** The matches for what is typed, as the completion list shows them. */
  entries: CompletionEntry[];
  selected: number;
  /** What Enter would do; undefined while nothing usable is typed. */
  choice?: ReactionChoice;
  /** Rows the prompt takes at the bottom of the screen; 0 while closed. */
  height: number;
  open(target: MessageRef): void;
  close(): void;
  /** Handles a key while the prompt is open. */
  onKey(input: string, key: Key): void;
};

/**
 * The prompt `r` opens: a one-line input for an emoji name with the
 * completion list above it. It reuses the input's text model and key
 * handling, and the completion list view, rather than being an input of its
 * own. Up/Down choose a match, Tab copies it into the input (to add a skin
 * tone, say), Enter reacts with the chosen match, or with exactly what was
 * typed when nothing matches; Esc cancels. Reacting removes the reaction
 * instead when the user already has it, which `choice` says beforehand.
 * `report` is the status bar's message line, for why Slack refused.
 */
export function useReactionPrompt({
  session,
  report,
}: {
  session: WorkspaceSession;
  report(message: string | undefined): void;
}): ReactionPrompt {
  const [target, setTarget] = useState<MessageRef>();
  const [input, setInput] = useState(emptyInput);

  const entries = target ? emojiCompletions(input.text, session) : [];
  const query = reactionName(input.text);
  const { selected, move, reset } = useChoice(query, entries.length);
  const name = entries[selected]?.slack ?? query;
  const choice: ReactionChoice | undefined =
    target && name !== ""
      ? {
          name,
          removes: session.hasReacted(target, name),
        }
      : undefined;

  function close() {
    setTarget(undefined);
    setInput(emptyInput);
    reset();
  }

  function submit() {
    if (!target || !choice) {
      return;
    }

    const request = { ...target, name: choice.name };
    const react = choice.removes ? session.removeReaction : session.addReaction;

    close();
    report(undefined);

    void react(request).then((result) => {
      report(result.ok ? undefined : result.message);
    });
  }

  return {
    isOpen: target !== undefined,
    input,
    entries,
    selected,
    choice,
    height:
      target === undefined
        ? 0
        : 1 + (entries.length > 0 ? entries.length + completionListChrome : 0),

    open(next) {
      setInput(emptyInput);
      reset();
      setTarget(next);
    },
    close,

    onKey(typed, key) {
      if (pressed("reaction.cancel", typed, key)) {
        close();
        return;
      }

      if (pressed("reaction.choose", typed, key)) {
        move(key.downArrow ? 1 : -1);
        return;
      }

      if (pressed("reaction.fill", typed, key)) {
        const entry = entries[selected];

        if (entry) {
          setInput({ text: entry.slack, cursor: entry.slack.length });
        }

        return;
      }

      if (pressed("reaction.submit", typed, key)) {
        if (!key.shift && !key.meta) {
          submit();
        }

        return;
      }

      const action = handleInputKey(input, typed, key);

      if (action.kind === "edit" && !/\s/.test(action.state.text)) {
        setInput(action.state);
      }
    },
  };
}
