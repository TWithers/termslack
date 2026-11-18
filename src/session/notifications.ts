import type { Clock } from "./clock";
import {
  type Author,
  type ConversationKind,
  type MessageContent,
} from "./events";
import type { ContentBlock, StyledSegment } from "./content";
import { type MessageTextLookup, renderMessageBody } from "./messageText";

/**
 * How long notifications are gathered before one goes out. Bursts within it
 * make a single notification.
 */
export const defaultNotificationWindowMs = 1000;

/**
 * The least time between two notifications. What arrives sooner than this
 * after one went out is held, and goes out together when it is up.
 */
export const notificationIntervalMs = 5000;

/** One message that earned a notification. */
export type NotifiedMessage = Author & {
  conversationId: string;
  conversationKind?: ConversationKind;
  ts: string;
  threadTs?: string;
  /** The message as plain text: mentions by name, links by label, whitespace collapsed; its file names when it has no text. */
  text: string;
};

/**
 * What views are told when messages call for the user's attention: the bell
 * rings, a desktop notification shows. Messages arriving close together come
 * as one notification.
 */
export type Notification = {
  /** Every message in the burst, oldest first. */
  messages: NotifiedMessage[];
  /** The last of them. */
  newest: NotifiedMessage;
  /** How many messages: `messages.length`. */
  count: number;
  /** Whether more than one message is in it. */
  isBurst: boolean;
};

export type NotificationListener = (notification: Notification) => void;

/** What the session knows about a new message that mentions the user. */
export type NotifyingMessage = MessageContent &
  Author & {
    channelId: string;
    channelKind?: ConversationKind;
    ts: string;
    threadTs?: string;
    subtype?: string;
  };

function blockText(block: ContentBlock<StyledSegment>): string[] {
  const inline = (segments: StyledSegment[]) =>
    segments.map((segment) => segment.text).join("");

  switch (block.kind) {
    case "list":
      return block.items.map(inline);
    case "divider":
      return [];
    case "fields":
      return block.fields.flatMap((field) => field.blocks.flatMap(blockText));
    case "attachment":
      return [...block.pretext, ...block.blocks].flatMap(blockText);
    default:
      return [inline(block.inline)];
  }
}

/**
 * A message as plain text: formatting stripped, mentions and channels by name
 * (looked up now), links by label, whitespace collapsed; just its file names
 * when it says nothing else.
 */
export function plainText(
  content: MessageContent,
  lookup: MessageTextLookup,
): string {
  const text = renderMessageBody(content, lookup)
    .flatMap(blockText)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (text !== "") {
    return text;
  }

  return content.files.length > 0 ? `[files: ${content.files.join(", ")}]` : "";
}

/**
 * Gathers items and hands them over together: the first starts a wait, and
 * everything that arrives before it ends goes out as one batch. The wait is
 * `windowMs`, or longer when the last batch went out less than `intervalMs`
 * ago: it ends `intervalMs` after that one (a batch `deliver` drops doesn't count). The one place that decides how
 * notifications are grouped and spaced.
 */
export function createCoalescer<T>({
  clock,
  windowMs,
  intervalMs = 0,
  deliver,
}: {
  clock: Clock;
  windowMs: number;
  intervalMs?: number;
  /** Returns whether the batch went out; only then does the interval start. */
  deliver: (batch: T[]) => boolean;
}): { add(item: T): void; drop(): void } {
  let batch: T[] = [];
  let cancel: (() => void) | undefined;
  let lastDeliveredAt: number | undefined;

  function waitMs(): number {
    if (lastDeliveredAt === undefined) {
      return windowMs;
    }

    return Math.max(windowMs, lastDeliveredAt + intervalMs - clock.now());
  }

  return {
    add(item) {
      batch.push(item);

      cancel ??= clock.setTimer(() => {
        const ready = batch;

        batch = [];
        cancel = undefined;

        if (deliver(ready)) {
          lastDeliveredAt = clock.now();
        }
      }, waitMs());
    },
    drop() {
      cancel?.();
      cancel = undefined;
      batch = [];
    },
  };
}

export type Notifications = {
  /** Calls `listener` with each notification. Returns an unsubscribe function. */
  subscribe(listener: NotificationListener): () => void;
  /**
   * Considers a new live message that should notify (a mention, or any new
   * message in a channel set to notify for all of them). It is
   * dropped while Do Not Disturb is on or the terminal is known to be focused;
   * otherwise it goes out with the next notification (see `notificationIntervalMs`).
   */
  consider(message: NotifyingMessage): void;
  /**
   * Whether the terminal window has the focus; undefined when the terminal
   * hasn't said. Gaining the focus drops what is being held.
   */
  setTerminalFocused(focused: boolean | undefined): void;
  /** Tells it Do Not Disturb may have changed; what is being held is dropped if it is on. */
  doNotDisturbChanged(): void;
  /** Drops what is waiting. */
  stop(): void;
};

/**
 * Decides which messages notify and when. Whether a message *deserves*
 * attention is `messageAttention`'s call; this adds the user's situation:
 * Do Not Disturb, whether they are looking at termslack, and not notifying more
 * than once an interval.
 */
export function createNotifications({
  clock,
  windowMs = defaultNotificationWindowMs,
  intervalMs = notificationIntervalMs,
  isDoNotDisturb,
  isStopped,
  lookup,
}: {
  clock: Clock;
  windowMs?: number;
  intervalMs?: number;
  isDoNotDisturb: () => boolean;
  isStopped: () => boolean;
  lookup: MessageTextLookup;
}): Notifications {
  const listeners = new Set<NotificationListener>();
  let focused: boolean | undefined;

  const pending = createCoalescer<NotifyingMessage>({
    clock,
    windowMs,
    intervalMs,
    deliver(messages) {
      if (isStopped() || isDoNotDisturb()) {
        return false;
      }

      const notified = messages.map((message): NotifiedMessage => ({
        conversationId: message.channelId,
        conversationKind: message.channelKind,
        userId: message.userId,
        botId: message.botId,
        botName: message.botName,
        ts: message.ts,
        threadTs: message.threadTs,
        text: plainText(message, lookup),
      }));
      const newest = notified.at(-1)!;

      for (const listener of [...listeners]) {
        listener({
          messages: notified,
          newest,
          count: notified.length,
          isBurst: notified.length > 1,
        });
      }

      return true;
    },
  });

  return {
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    consider(message) {
      if (isStopped() || isDoNotDisturb() || focused === true) {
        return;
      }

      pending.add(message);
    },
    setTerminalFocused(next) {
      focused = next;

      if (next === true) {
        pending.drop();
      }
    },
    doNotDisturbChanged() {
      if (isDoNotDisturb()) {
        pending.drop();
      }
    },
    stop() {
      pending.drop();
    },
  };
}
