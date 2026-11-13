import {
  inputKeyHints,
  messageKeyHints,
  sidebarKeyHints,
  threadInputKeyHints,
  threadKeyHints,
} from "./StatusBar";

/** The two lists of messages, whose selected message keys act on. */
export type ListPane = "messages" | "thread";

/** The two inputs: the conversation's and the one under the thread. */
export type InputPane = "input" | "threadInput";

/**
 * Which pane keys go to. Tab walks the panes that are on screen in the order
 * `focusOrder` gives.
 */
export type Focus = "sidebar" | ListPane | InputPane;

/** The input under a list. */
export function inputFor(pane: ListPane): InputPane {
  return pane === "thread" ? "threadInput" : "input";
}

/** The list an input sits under. */
export function listFor(input: InputPane): ListPane {
  return input === "threadInput" ? "thread" : "messages";
}

export function isInputPane(focus: Focus): focus is InputPane {
  return focus === "input" || focus === "threadInput";
}

export function isListPane(focus: Focus): focus is ListPane {
  return focus === "messages" || focus === "thread";
}

/**
 * The panes on screen, in Tab order. A narrow terminal shows the thread
 * instead of the conversation.
 */
export function focusOrderOf({
  hasConversation,
  showsMessages,
  hasThread,
}: {
  hasConversation: boolean;
  showsMessages: boolean;
  hasThread: boolean;
}): Focus[] {
  if (!hasConversation) {
    return ["sidebar"];
  }

  if (!showsMessages) {
    return ["sidebar", "thread", "threadInput"];
  }

  return hasThread
    ? ["sidebar", "messages", "input", "thread", "threadInput"]
    : ["sidebar", "messages", "input"];
}

/**
 * The pane focus lands on: the one asked for if it's on screen, else the
 * nearest pane, never into an input where letters would type.
 */
export function resolveFocus(requested: Focus, order: Focus[]): Focus {
  if (order.includes(requested)) {
    return requested;
  }

  if (order.includes("thread")) {
    return "thread";
  }

  return order.includes("messages") ? "messages" : "sidebar";
}

/** The key hints of each pane that has any. */
export const paneKeyHints: Partial<Record<Focus, string>> = {
  sidebar: sidebarKeyHints(),
  input: inputKeyHints,
  messages: messageKeyHints,
  thread: threadKeyHints,
  threadInput: threadInputKeyHints,
};
