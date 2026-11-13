import type { Key } from "ink";
import {
  deleteBack,
  deleteForward,
  deleteWordBack,
  type InputState,
  insertText,
  lineDown,
  lineEnd,
  lineStart,
  lineUp,
  moveLeft,
  moveRight,
  wordLeft,
  wordRight,
} from "./textInput";

/** The part of Ink's `Key` the input reads, so tests can pass only what matters. */
export type InputKey = Partial<
  Pick<
    Key,
    | "return"
    | "escape"
    | "ctrl"
    | "meta"
    | "shift"
    | "backspace"
    | "delete"
    | "leftArrow"
    | "rightArrow"
    | "upArrow"
    | "downArrow"
    | "home"
    | "end"
    | "pageUp"
    | "pageDown"
  >
>;

/** What a key press asks of the input's owner. */
export type InputAction =
  /** The text or cursor changed. */
  | { kind: "edit"; state: InputState }
  /** Enter: the owner sends (or saves) the text. */
  | { kind: "send" }
  /** Escape: the owner takes focus away. */
  | { kind: "leave" }
  /** Ctrl+T: the owner toggles sending a reply to the channel as well; inputs that aren't replies ignore it. */
  | { kind: "alsoToChannel" }
  | { kind: "ignore" };

const edit = (state: InputState): InputAction => ({ kind: "edit", state });

/**
 * What one key press does in an input. Enter sends; Shift+Enter (terminals
 * with the kitty keyboard protocol), Alt+Enter and Ctrl+J insert a newline.
 * Ctrl+J needs no case of its own: a terminal sends it as a bare `\n`, which
 * is typed like any other text. Ctrl+T asks to also send a reply to the channel (Ctrl+B is taken: it moves left). Ctrl+C and Tab are the app's, not the input's.
 */
export function handleInputKey(
  state: InputState,
  input: string,
  key: InputKey,
): InputAction {
  if (key.escape) {
    return { kind: "leave" };
  }

  if (key.return) {
    return key.shift || key.meta
      ? edit(insertText(state, "\n"))
      : { kind: "send" };
  }

  if (key.leftArrow) {
    return edit(key.meta || key.ctrl ? wordLeft(state) : moveLeft(state));
  }

  if (key.rightArrow) {
    return edit(key.meta || key.ctrl ? wordRight(state) : moveRight(state));
  }

  if (key.upArrow) {
    return edit(lineUp(state));
  }

  if (key.downArrow) {
    return edit(lineDown(state));
  }

  if (key.home) {
    return edit(lineStart(state));
  }

  if (key.end) {
    return edit(lineEnd(state));
  }

  if (key.backspace) {
    return edit(key.meta ? deleteWordBack(state) : deleteBack(state));
  }

  if (key.delete) {
    return edit(deleteForward(state));
  }

  if (key.ctrl) {
    return ctrlKey(state, input);
  }

  if (key.meta) {
    return input === "b"
      ? edit(wordLeft(state))
      : input === "f"
        ? edit(wordRight(state))
        : { kind: "ignore" };
  }

  if (input === "" || key.pageUp || key.pageDown) {
    return { kind: "ignore" };
  }

  return edit(insertText(state, input));
}

/** The shell-style Ctrl shortcuts. */
function ctrlKey(state: InputState, input: string): InputAction {
  switch (input) {
    case "a":
      return edit(lineStart(state));
    case "e":
      return edit(lineEnd(state));
    case "b":
      return edit(moveLeft(state));
    case "f":
      return edit(moveRight(state));
    case "d":
      return edit(deleteForward(state));
    case "w":
      return edit(deleteWordBack(state));
    case "t":
      return { kind: "alsoToChannel" };
    default:
      return { kind: "ignore" };
  }
}
