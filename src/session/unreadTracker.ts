import type { ChangeTracker } from "./changeTracker";
import type { Attention } from "./attention";

/** What the sidebar shows for a conversation. A mention is also unread. */
export type ConversationMarkers = {
  isUnread: boolean;
  /** Messages since startup (or since it was last open) that mention the user. */
  mentions: number;
};

const none: ConversationMarkers = { isUnread: false, mentions: 0 };

export type UnreadTracker = {
  markers(conversationId: string): ConversationMarkers;
  /** Records what a new message deserves. Nothing is recorded for the open conversation. */
  record(conversationId: string, attention: Attention): void;
  /**
   * Records what was already unread in Slack before startup. Ignored for a
   * conversation that has been opened since, or that live messages already marked.
   * `count` is how many messages are unread, when known (a mention counts each).
   */
  recordExisting(
    conversationId: string,
    attention: Attention,
    count?: number,
  ): void;
  /** Whether the conversation has been open at any point this session. */
  wasOpened(conversationId: string): boolean;
  /** Tells the tracker which conversation the user is looking at. Its markers stay until `clear`. */
  setOpen(conversationId: string | undefined): void;
  /** Clears a conversation's markers, once what it holds has been shown. */
  clear(conversationId: string): void;
  isOpen(conversationId: string): boolean;
};

/**
 * Unread state kept by termslack itself, since Socket Mode doesn't deliver Slack's
 * read markers. It only lasts as long as the session.
 */
export function createUnreadTracker(changes: ChangeTracker): UnreadTracker {
  const markers = new Map<string, ConversationMarkers>();
  const opened = new Set<string>();
  let open: string | undefined;

  return {
    markers: (id) => markers.get(id) ?? none,
    isOpen: (id) => open === id,

    record(id, attention) {
      if (attention === "none" || id === open) {
        return;
      }

      const current = markers.get(id) ?? none;

      markers.set(id, {
        isUnread: true,
        mentions: current.mentions + (attention === "mention" ? 1 : 0),
      });
      changes.changed();
    },

    wasOpened: (id) => opened.has(id),

    recordExisting(id, attention, count = 1) {
      if (attention === "none" || opened.has(id) || markers.get(id)?.isUnread) {
        return;
      }

      markers.set(id, {
        isUnread: true,
        mentions: attention === "mention" ? count : 0,
      });
      changes.changed();
    },

    setOpen(id) {
      open = id;

      if (id !== undefined) {
        opened.add(id);
      }
    },

    clear(id) {
      if (markers.delete(id)) {
        changes.changed();
      }
    },
  };
}
