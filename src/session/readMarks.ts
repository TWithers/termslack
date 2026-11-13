import type { WebClient } from "@slack/web-api";
import { markConversationRead } from "../slack/conversations";
import type { UnreadTracker } from "./unreadTracker";
import { compareTs } from "./workspaceStore";

export const defaultReadMarkDebounceMs = 750;

export type ReadMarks = {
  /** Marks the open conversation read in Slack soon, coalescing requests made meanwhile. */
  schedule(conversationId: string): void;
  /** Cancels the wait and sends what is pending now. Never rejects. */
  flush(): Promise<void>;
};

/**
 * Marks the open conversation read in Slack, up to its newest loaded message,
 * and only once its history has loaded. Stops trying for good once Slack says the token can't mark.
 */
export function createReadMarks({
  client,
  unread,
  isLoaded,
  newestLoadedTs,
  canMark,
  debounceMs,
  isStopped,
}: {
  client: () => WebClient;
  unread: UnreadTracker;
  /** Whether the conversation's history has loaded, so what it shows can be told to Slack as seen. */
  isLoaded: (conversationId: string) => boolean;
  /** The `ts` of the newest message in the store for a conversation. */
  newestLoadedTs: (conversationId: string) => string | undefined;
  /** Whether Slack can be told the conversation is read: not one the user isn't in. */
  canMark: (conversationId: string) => boolean;
  debounceMs: number;
  isStopped: () => boolean;
}): ReadMarks {
  const markedTs = new Map<string, string>();
  const pendingMarks = new Set<string>();
  let timer: Timer | undefined;
  let unsupported = false;

  /** Marks each requested conversation read up to its newest loaded message. Failures are not fatal. */
  async function sendMarks(): Promise<void> {
    const ids = [...pendingMarks];

    pendingMarks.clear();

    for (const id of ids) {
      const ts = newestLoadedTs(id);
      const alreadyMarked = markedTs.get(id);

      if (
        unsupported ||
        ts === undefined ||
        (alreadyMarked !== undefined && compareTs(alreadyMarked, ts) >= 0)
      ) {
        continue;
      }

      const result = await markConversationRead(client(), id, ts);

      if (result === "marked") {
        markedTs.set(id, ts);
      }

      if (result === "unsupported") {
        unsupported = true;
      }
    }
  }

  return {
    schedule(id) {
      if (
        unsupported ||
        isStopped() ||
        !unread.isOpen(id) ||
        !canMark(id) ||
        !isLoaded(id)
      ) {
        return;
      }

      pendingMarks.add(id);

      timer ??= setTimeout(() => {
        timer = undefined;
        void sendMarks();
      }, debounceMs);
    },
    async flush() {
      clearTimeout(timer);
      timer = undefined;
      await sendMarks().catch(() => undefined);
    },
  };
}
