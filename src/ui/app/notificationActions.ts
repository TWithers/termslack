/** Where a click on a desktop notification leads. */
export type ActivationTarget = {
  conversationId: string;
  /** The thread to open, for a notification about a thread reply. */
  threadTs?: string;
};

/**
 * What the app and the terminal's notifications say to each other: the app
 * hears of clicks, and tells which conversation was read so its notification
 * can go.
 */
export type NotificationActions = {
  onActivate(listener: (target: ActivationTarget) => void): () => void;
  dismiss(conversationId: string): void;
  /** Hears of the terminal window coming back into focus. */
  onWindowFocus(listener: () => void): () => void;
};

/** Actions that exist from the start; the notifier chosen later feeds them through `activate`. */
export function createNotificationActions(): NotificationActions & {
  activate(target: ActivationTarget): void;
  /** Where `dismiss` goes once a notifier is chosen. */
  useDismisser(dismiss: (conversationId: string) => void): void;
  windowFocused(): void;
} {
  const listeners = new Set<(target: ActivationTarget) => void>();
  const focusListeners = new Set<() => void>();
  let dismisser: (conversationId: string) => void = () => {};

  return {
    onActivate(listener) {
      listeners.add(listener);

      return () => void listeners.delete(listener);
    },
    dismiss: (conversationId) => dismisser(conversationId),
    useDismisser(dismiss) {
      dismisser = dismiss;
    },
    onWindowFocus(listener) {
      focusListeners.add(listener);

      return () => void focusListeners.delete(listener);
    },
    windowFocused() {
      focusListeners.forEach((listener) => listener());
    },
    activate(target) {
      listeners.forEach((listener) => listener(target));
    },
  };
}
