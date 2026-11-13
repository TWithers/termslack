import type { Key } from "ink";
import { useState } from "react";
import type { WorkspaceSession } from "../../session/workspaceSession";
import { handleInputKey } from "../input/inputKeys";
import { emptyInput } from "../input/textInput";
import { pressed } from "./shortcuts";
import type { ChannelRef } from "./useConfirmPrompt";

export type SectionPrompt = {
  isOpen: boolean;
  input: { text: string; cursor: number };
  /** Why the last Enter was refused; cleared by the next key. */
  refusal?: string;
  /** Rows the prompt takes at the bottom of the screen; 0 while closed. */
  height: number;
  open(channel: ChannelRef): void;
  close(): void;
  /** Handles a key while the prompt is open. */
  onKey(input: string, key: Key): void;
};

/**
 * The prompt "New section…" in the channel menu's Move to section list opens:
 * a one-line input for the new section's name. It reuses the input's text
 * model and key handling, and sits at the bottom like the reaction prompt.
 * Enter creates the section after the user's others and moves the channel
 * in; an empty or repeated name is refused (`refusal` says why) and the
 * prompt stays open. Esc cancels, leaving nothing open.
 */
export function useSectionPrompt({
  session,
}: {
  session: WorkspaceSession;
}): SectionPrompt {
  const [channel, setChannel] = useState<ChannelRef>();
  const [input, setInput] = useState(emptyInput);
  const [refusal, setRefusal] = useState<string>();

  function close() {
    setChannel(undefined);
    setInput(emptyInput);
    setRefusal(undefined);
  }

  function submit(target: ChannelRef) {
    const name = input.text.trim();
    const added = session.addSection(name);

    if (!added.ok) {
      setRefusal(added.reason);
      return;
    }

    const moved = session.moveToSection(target.id, name);

    if (!moved.ok) {
      setRefusal(moved.reason);
      return;
    }

    close();
  }

  return {
    isOpen: channel !== undefined,
    input,
    refusal,
    height: channel === undefined ? 0 : 1,

    open(next) {
      setInput(emptyInput);
      setRefusal(undefined);
      setChannel(next);
    },
    close,

    onKey(typed, key) {
      if (!channel) {
        return;
      }

      if (pressed("section.cancel", typed, key)) {
        close();
        return;
      }

      if (pressed("section.submit", typed, key)) {
        if (!key.shift && !key.meta) {
          submit(channel);
        }

        return;
      }

      const action = handleInputKey(input, typed, key);

      if (action.kind !== "edit" || /[\r\n]/.test(action.state.text)) {
        return;
      }

      setRefusal(undefined);
      setInput(action.state);
    },
  };
}
