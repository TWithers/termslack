import type { CompletionEntry } from "../../session/mentions";
import type { InputState } from "./textInput";

/** The `@name` or `#channel` being typed at the cursor, which the completion list is for. */
export type CompletionTrigger = {
  sigil: "@" | "#";
  /** What follows the sigil so far. */
  query: string;
  /** Where the sigil is in the text. */
  start: number;
};

/**
 * Whether the cursor is at the end of a word that starts with `@` or `#`, and
 * so wants completing. The sigil must not be glued to a word, so
 * `ada@example.com` never opens a list.
 */
export function completionTrigger(
  state: InputState,
): CompletionTrigger | undefined {
  const match = /(?<![\p{L}\p{N}_.\-+])([@#])([\p{L}\p{N}_.\-]*)$/u.exec(
    state.text.slice(0, state.cursor),
  );

  if (!match) {
    return undefined;
  }

  return {
    sigil: match[1] as "@" | "#",
    query: match[2] ?? "",
    start: match.index,
  };
}

/** The input with the word being typed replaced by the chosen entry and a space after it. */
export function applyCompletion(
  state: InputState,
  trigger: CompletionTrigger,
  entry: CompletionEntry,
): InputState {
  const after = state.text.slice(state.cursor);
  const inserted = `${entry.label} `;
  const rest = after.startsWith(" ") ? after.slice(1) : after;

  return {
    text: state.text.slice(0, trigger.start) + inserted + rest,
    cursor: trigger.start + inserted.length,
  };
}
