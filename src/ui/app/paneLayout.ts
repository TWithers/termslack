/** The panes area narrower than this shows the thread instead of the conversation, not beside it. */
export const minSplitWidth = 100;

export type PaneWidths = {
  /** Width of the message pane (still the full area when it is hidden, so its rows keep a sane wrap). */
  message: number;
  /** Width of the thread pane; 0 while no thread is open. */
  thread: number;
  /** Whether the message pane is drawn: false when a thread replaces it on a narrow terminal. */
  showMessages: boolean;
};

/**
 * Splits the space beside the sidebar. With a thread open it is shared
 * between the message pane (the left half) and the thread pane when there is
 * room for both; otherwise the thread takes the message pane's place.
 */
export function paneWidths(width: number, threadOpen: boolean): PaneWidths {
  if (!threadOpen) {
    return { message: width, thread: 0, showMessages: true };
  }

  if (width < minSplitWidth) {
    return { message: width, thread: width, showMessages: false };
  }

  const message = Math.floor(width / 2);

  return { message, thread: width - message, showMessages: true };
}
