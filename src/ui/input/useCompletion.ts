import { useState } from "react";
import {
  type CompletionEntry,
  completionEntries,
  type Mention,
  type MentionDirectory,
} from "../../session/mentions";
import { useChoice } from "./useChoice";
import { applyCompletion, completionTrigger } from "./completion";
import type { InputKey } from "./inputKeys";
import type { InputState } from "./textInput";

/** What a key press did to the completion list. */
export type CompletionKeyResult =
  /** The list is closed, or the key isn't one it uses: the input handles it. */
  | { kind: "pass" }
  /** The list used the key (moved, or closed). */
  | { kind: "handled" }
  /** An entry was chosen: the input's new state and the mention to remember. */
  | { kind: "complete"; state: InputState; mention: Mention };

/**
 * The completion list of an input: open while the cursor is at the end of an
 * `@` or `#` word that something matches. While open it takes Up/Down (choose),
 * Tab and Enter (complete) and Esc (close the list, not the input). `place`
 * names what is being written (a draft key), so a dismissal doesn't carry
 * over to another conversation. `directory` is only called when a list is
 * needed.
 */
export function useCompletion(
  place: string | undefined,
  state: InputState,
  directory: () => MentionDirectory,
): {
  entries: CompletionEntry[];
  selected: number;
  onKey(input: string, key: InputKey & { tab?: boolean }): CompletionKeyResult;
} {
  const [dismissed, setDismissed] = useState<string>();
  const trigger = completionTrigger(state);
  const signature =
    trigger && `${place}:${trigger.start}:${trigger.sigil}${trigger.query}`;
  const spot = trigger && `${place}:${trigger.start}`;
  const entries =
    trigger && spot !== dismissed
      ? completionEntries(directory(), trigger.sigil, trigger.query)
      : [];
  const { selected, move } = useChoice(signature ?? "", entries.length);

  return {
    entries,
    selected,
    onKey(_input, key) {
      if (entries.length === 0 || !trigger || !signature) {
        return { kind: "pass" };
      }

      if (key.upArrow || key.downArrow) {
        move(key.downArrow ? 1 : -1);

        return { kind: "handled" };
      }

      if (key.escape) {
        setDismissed(spot);

        return { kind: "handled" };
      }

      const plainEnter = key.return && !key.shift && !key.meta;

      if (key.tab || plainEnter) {
        const entry = entries[selected]!;

        return {
          kind: "complete",
          state: applyCompletion(state, trigger, entry),
          mention: { label: entry.label, slack: entry.slack },
        };
      }

      return { kind: "pass" };
    },
  };
}
