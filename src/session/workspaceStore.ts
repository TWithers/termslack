import type {
  Bot,
  Conversation,
  ConversationEvent,
  Message,
  MessageDeletedEvent,
  MessageEditedEvent,
  Reaction,
  ReactionEvent,
  CustomEmoji,
  EmojiEvent,
  User,
  UserEvent,
  UserGroup,
  UserGroupEvent,
} from "./events";
import { replyParentOf } from "./events";
import { type ChangeTracker, createChangeTracker } from "./changeTracker";

/**
 * What termslack knows about the workspace. Only the session's update functions
 * change it; views read through the session.
 */
export type WorkspaceStore = {
  conversation(id: string): Conversation | undefined;
  conversations(): Conversation[];
  /** Adds or replaces a conversation, and forgets any earlier "unresolvable" verdict. */
  setConversation(conversation: Conversation): void;
  /** Applies a conversation event. `currentUserId` decides whether a join is the user's own. */
  applyConversationEvent(
    event: ConversationEvent,
    currentUserId?: string,
  ): void;
  /** The members of a group DM, once learned. */
  conversationMembers(id: string): string[] | undefined;
  setConversationMembers(id: string, memberIds: string[]): void;
  user(id: string): User | undefined;
  users(): User[];
  /** Adds or replaces a user, and forgets any earlier "unresolvable" verdict. */
  setUser(user: User): void;
  /** Adds a user only if the store doesn't have them yet (used by the bulk listing, which may be stale). */
  addUserIfAbsent(user: User): void;
  /** Merges what a user event says over what's known, so a status change keeps the name. */
  applyUserEvent(event: UserEvent): void;
  userGroup(id: string): UserGroup | undefined;
  userGroups(): UserGroup[];
  /** Adds or replaces a group's name and handle. Membership is kept apart: see `loadUserGroups`. */
  setUserGroup(group: UserGroup): void;
  /**
   * Stores groups from a listing that says who is in them, and learns which the
   * current user is in. A group a membership event has spoken about since
   * the session began keeps what the event said, as the listing may be older.
   */
  loadUserGroups(groups: UserGroup[], currentUserId?: string): void;
  /** Applies a membership event for the current user (`currentUserId` decides whether a member change is theirs). */
  applyUserGroupEvent(event: UserGroupEvent, currentUserId?: string): void;
  /** Whether the current user is in the group, as far as is known. */
  isInUserGroup(id: string): boolean;
  /** A custom emoji of the workspace, by shortcode without colons. */
  customEmoji(name: string): CustomEmoji | undefined;
  /** The shortcodes of all the workspace's custom emoji. */
  customEmojiNames(): string[];
  /** Adds the workspace's emoji list, without overriding anything an `emoji_changed` event has said since the session began. */
  loadCustomEmoji(emoji: CustomEmoji[]): void;
  /** Applies an `emoji_changed` event. */
  applyEmojiEvent(event: EmojiEvent): void;
  bot(id: string): Bot | undefined;
  setBot(bot: Bot): void;
  /**
   * The conversation's messages oldest first, thread replies left out (a
   * reply also sent to the channel stays in). Bounded; see `createWorkspaceStore`.
   */
  messages(channelId: string): Message[];
  message(channelId: string, ts: string): Message | undefined;
  /** The replies stored for a thread, oldest first. The parent isn't included. */
  threadReplies(channelId: string, threadTs: string): Message[];
  /**
   * Adds a message, or replaces the stored one with the same `ts`, unless the
   * stored one was edited or deleted (those are newer than a copy that comes
   * from a page of history or a repeated delivery). Returns what's stored.
   */
  recordMessage(message: Message): Message;
  /**
   * Puts a message in place whatever the stored one says, even an edited or
   * deleted one. For showing a change before Slack confirms it and for taking
   * it back; Slack's own data goes through `recordMessage`.
   */
  replaceMessage(message: Message): Message;
  /**
   * Applies a live reaction event to a stored message; one the store doesn't
   * hold is ignored. Adding twice counts once; removing a user who isn't
   * listed only lowers the count when the list is known to be incomplete.
   */
  applyReactionEvent(event: ReactionEvent): void;
  /** Counts one more reply on a stored thread parent (one the store hasn't seen is left alone). */
  addReply(channelId: string, threadTs: string): void;
  /**
   * Stops dropping the oldest messages of one conversation. Used once history
   * has been loaded for it on purpose: scrollback must not evict itself.
   */
  keepAllMessages(channelId: string): void;
  /** Applies an edit; a message the store hadn't seen is added with its new text. */
  applyMessageEdit(event: MessageEditedEvent): Message | undefined;
  /** Marks a message deleted (keeping its content for the log); one the store hadn't seen is kept as an empty tombstone, so a page of history loaded later can't bring it back. */
  applyMessageDelete(event: MessageDeletedEvent): Message | undefined;
  /** Remembers that an ID definitely can't be looked up, so it isn't tried again. */
  markUnresolvable(id: string): void;
  isUnresolvable(id: string): boolean;
};

export const defaultMaxMessagesPerConversation = 1000;

/** Orders Slack timestamps (`seconds.micros`) without going through floating point. */
export function compareTs(a: string, b: string): number {
  const [aSeconds = "", aMicros = ""] = a.split(".");
  const [bSeconds = "", bMicros = ""] = b.split(".");

  return (
    Number(aSeconds) - Number(bSeconds) ||
    aMicros.padEnd(6, "0").localeCompare(bMicros.padEnd(6, "0"))
  );
}

/** Whether a message belongs to a thread rather than the conversation's own list. */
function isThreadReply(message: Message): boolean {
  return (
    replyParentOf(message) !== undefined &&
    message.subtype !== "thread_broadcast"
  );
}

/** The reactions with the event's user added, or undefined when they are already listed. */
function withReactionAdded(
  reactions: Reaction[],
  current: Reaction | undefined,
  event: ReactionEvent,
): Reaction[] | undefined {
  if (current?.userIds.includes(event.userId)) {
    return undefined;
  }

  if (!current) {
    return [
      ...reactions,
      { name: event.reaction, userIds: [event.userId], count: 1 },
    ];
  }

  return reactions.map((reaction) =>
    reaction === current
      ? {
          ...reaction,
          userIds: [...reaction.userIds, event.userId],
          count: reaction.count + 1,
        }
      : reaction,
  );
}

/**
 * The reactions with the event's user removed, or undefined when nothing
 * changes: the reaction is absent, or the user isn't listed and the list is complete.
 */
function withReactionRemoved(
  reactions: Reaction[],
  current: Reaction | undefined,
  event: ReactionEvent,
): Reaction[] | undefined {
  if (!current) {
    return undefined;
  }

  const isListed = current.userIds.includes(event.userId);
  const isTruncated = current.userIds.length < current.count;

  if (!isListed && !isTruncated) {
    return undefined;
  }

  const count = current.count - 1;

  return reactions.flatMap((reaction): Reaction[] => {
    if (reaction !== current) {
      return [reaction];
    }

    return count <= 0
      ? []
      : [
          {
            ...reaction,
            userIds: reaction.userIds.filter((id) => id !== event.userId),
            count,
          },
        ];
  });
}

/** Whether an event makes the current user a member (true), takes them out (false), or says nothing about them. */
function membershipChange(
  event: UserGroupEvent,
  currentUserId?: string,
): boolean | undefined {
  if (event.action === "selfAdded") {
    return true;
  }

  if (event.action === "selfRemoved") {
    return false;
  }

  if (currentUserId === undefined) {
    return undefined;
  }

  if (event.addedUserIds.includes(currentUserId)) {
    return true;
  }

  return event.removedUserIds.includes(currentUserId) ? false : undefined;
}

/**
 * `maxMessagesPerConversation` bounds memory over long sessions: when a
 * conversation holds more, its oldest messages (by `ts`, replies included)
 * are dropped. Anything dropped can be loaded again from history. A
 * conversation whose history was loaded on request (`keepAllMessages`) is
 * exempt, so that scrolling back doesn't evict what was just loaded.
 */
export function createWorkspaceStore({
  maxMessagesPerConversation = defaultMaxMessagesPerConversation,
  changes = createChangeTracker(),
}: {
  maxMessagesPerConversation?: number;
  /** Shared with the session so it can report its own changes (the connection) through the same counter. */
  changes?: ChangeTracker;
} = {}): WorkspaceStore {
  const conversations = new Map<string, Conversation>();
  const members = new Map<string, string[]>();
  const users = new Map<string, User>();
  const bots = new Map<string, Bot>();
  const userGroups = new Map<string, UserGroup>();
  const groupMembership = new Map<string, boolean>();
  const groupsChangedLive = new Set<string>();
  const customEmoji = new Map<string, CustomEmoji>();
  const changedEmoji = new Set<string>();
  const unresolvable = new Set<string>();
  const messagesByConversation = new Map<string, Map<string, Message>>();
  const uncapped = new Set<string>();
  const liveReactions = new Set<string>();

  const reactionKey = (channelId: string, ts: string) => `${channelId}/${ts}`;

  function conversationMessages(channelId: string): Map<string, Message> {
    let stored = messagesByConversation.get(channelId);

    if (!stored) {
      stored = new Map();
      messagesByConversation.set(channelId, stored);
    }

    return stored;
  }

  function sortedMessages(
    channelId: string,
    keep: (message: Message) => boolean,
  ): Message[] {
    return [...(messagesByConversation.get(channelId)?.values() ?? [])]
      .filter(keep)
      .sort((a, b) => compareTs(a.ts, b.ts));
  }

  function put(message: Message): Message {
    const stored = conversationMessages(message.channelId);

    stored.set(message.ts, message);
    changes.changed();

    if (
      stored.size > maxMessagesPerConversation &&
      !uncapped.has(message.channelId)
    ) {
      const oldest = [...stored.keys()].sort(compareTs)[0];

      if (oldest !== undefined) {
        stored.delete(oldest);
        liveReactions.delete(reactionKey(message.channelId, oldest));
      }
    }

    return message;
  }

  /**
   * A page of history is authoritative for a message's reactions until a live
   * reaction event has touched them: after that, the page may have been
   * fetched before the event, so the live state stands. A copy that says
   * nothing (a live message) never clears what is stored.
   */
  function mergedReactions(
    existing: Message | undefined,
    incoming: Message,
  ): Reaction[] | undefined {
    if (
      incoming.reactions === undefined ||
      liveReactions.has(reactionKey(incoming.channelId, incoming.ts))
    ) {
      return existing?.reactions ?? incoming.reactions;
    }

    return incoming.reactions;
  }

  function recordMessage(message: Message): Message {
    const existing = messagesByConversation
      .get(message.channelId)
      ?.get(message.ts);
    const reactions = mergedReactions(existing, message);

    if (existing && (existing.isEdited || existing.isDeleted)) {
      return message.replyCount === undefined &&
        reactions === existing.reactions
        ? existing
        : put({
            ...existing,
            replyCount: message.replyCount ?? existing.replyCount,
            reactions,
          });
    }

    return put({
      ...message,
      replyCount: message.replyCount ?? existing?.replyCount,
      reactions,
    });
  }

  function applyReactionEvent(event: ReactionEvent): void {
    const message = messagesByConversation
      .get(event.channelId)
      ?.get(event.messageTs);

    if (!message || event.reaction === "" || event.userId === "") {
      return;
    }

    const reactions = message.reactions ?? [];
    const current = reactions.find(({ name }) => name === event.reaction);
    const next =
      event.action === "added"
        ? withReactionAdded(reactions, current, event)
        : withReactionRemoved(reactions, current, event);

    if (next === undefined) {
      return;
    }

    liveReactions.add(reactionKey(event.channelId, event.messageTs));
    put({ ...message, reactions: next });
  }

  function addReply(channelId: string, threadTs: string): void {
    const parent = messagesByConversation.get(channelId)?.get(threadTs);

    if (parent) {
      put({ ...parent, replyCount: (parent.replyCount ?? 0) + 1 });
    }
  }

  function update(id: string, changed: Partial<Conversation>): void {
    const existing = conversations.get(id);

    if (existing) {
      conversations.set(id, { ...existing, ...changed });
      changes.changed();
    }
  }

  function setConversation(conversation: Conversation): void {
    conversations.set(conversation.id, conversation);
    unresolvable.delete(conversation.id);
    changes.changed();
  }

  function setUserGroup(group: UserGroup): void {
    userGroups.set(group.id, {
      id: group.id,
      name: group.name,
      handle: group.handle,
    });
    unresolvable.delete(group.id);
    changes.changed();
  }

  function setUser(user: User): void {
    users.set(user.id, user);
    unresolvable.delete(user.id);
    changes.changed();
  }

  return {
    conversationMembers: (id) => members.get(id),
    setConversationMembers(id, memberIds) {
      members.set(id, memberIds);
      changes.changed();
    },
    user: (id) => users.get(id),
    users: () => [...users.values()],
    setUser,
    addUserIfAbsent(user) {
      if (!users.has(user.id)) {
        setUser(user);
      }
    },
    applyUserEvent(event) {
      if (event.userId === "") {
        return;
      }

      setUser({ ...users.get(event.userId), ...event.user });
    },
    userGroup: (id) => userGroups.get(id),
    userGroups: () => [...userGroups.values()],
    setUserGroup,
    loadUserGroups(groups, currentUserId) {
      for (const group of groups) {
        setUserGroup(group);

        if (
          currentUserId !== undefined &&
          group.userIds !== undefined &&
          !groupsChangedLive.has(group.id)
        ) {
          groupMembership.set(group.id, group.userIds.includes(currentUserId));
        }
      }
    },
    applyUserGroupEvent(event, currentUserId) {
      if (event.userGroupId === "") {
        return;
      }

      const isMember = membershipChange(event, currentUserId);

      if (isMember === undefined) {
        return;
      }

      groupsChangedLive.add(event.userGroupId);
      groupMembership.set(event.userGroupId, isMember);
      changes.changed();
    },
    isInUserGroup: (id) => groupMembership.get(id) ?? false,
    customEmoji: (name) => customEmoji.get(name),
    customEmojiNames: () => [...customEmoji.keys()],
    loadCustomEmoji(emoji) {
      for (const entry of emoji) {
        if (!changedEmoji.has(entry.name)) {
          customEmoji.set(entry.name, entry);
        }
      }

      changes.changed();
    },
    applyEmojiEvent(event) {
      changes.changed();

      const forget = (name: string) => {
        changedEmoji.add(name);
        customEmoji.delete(name);
      };

      if (event.action !== "added") {
        (event.action === "renamed"
          ? [event.oldName ?? ""]
          : event.names
        ).forEach(forget);
      }

      if (event.action !== "removed") {
        for (const name of event.names) {
          changedEmoji.add(name);
          customEmoji.set(name, { name, aliasOf: event.aliasOf });
        }
      }
    },
    bot: (id) => bots.get(id),
    setBot(bot) {
      bots.set(bot.id, bot);
      unresolvable.delete(bot.id);
      changes.changed();
    },

    conversation: (id) => conversations.get(id),
    conversations: () => [...conversations.values()],
    setConversation,

    applyConversationEvent(event, currentUserId) {
      const { channelId: id, channelKind: kind, name } = event;

      if (id === "") {
        return;
      }

      switch (event.action) {
        case "created":
        case "renamed": {
          const existing = conversations.get(id);

          setConversation({
            isArchived: false,
            isMember: false,
            ...existing,
            id,
            kind,
            name: name ?? existing?.name,
          });
          return;
        }
        case "archived":
          update(id, { isArchived: true });
          return;
        case "unarchived":
          update(id, { isArchived: false });
          return;
        case "deleted":
          conversations.delete(id);
          members.delete(id);
          changes.changed();
          return;
        case "left":
          update(id, { isMember: false });
          return;
        case "memberLeft":
          if (event.userId === currentUserId) {
            update(id, { isMember: false });
          }
          return;
        case "joined":
          if (event.userId === currentUserId) {
            update(id, { isMember: true });
          }
          return;
      }
    },

    messages: (channelId) =>
      sortedMessages(channelId, (message) => !isThreadReply(message)),
    message: (channelId, ts) => messagesByConversation.get(channelId)?.get(ts),
    threadReplies: (channelId, threadTs) =>
      sortedMessages(
        channelId,
        (message) => message.threadTs === threadTs && message.ts !== threadTs,
      ),
    recordMessage,
    replaceMessage: put,
    applyReactionEvent,
    addReply,
    keepAllMessages: (channelId) => uncapped.add(channelId),

    applyMessageEdit(event) {
      if (event.channelId === "" || event.messageTs === "") {
        return undefined;
      }

      const existing = messagesByConversation
        .get(event.channelId)
        ?.get(event.messageTs);

      return put({
        isDeleted: false,
        ...existing,
        channelId: event.channelId,
        ts: event.messageTs,
        threadTs: existing?.threadTs ?? event.threadTs,
        userId: existing?.userId ?? event.userId,
        botId: existing?.botId ?? event.botId,
        botName: existing?.botName ?? event.botName,
        text: event.text,
        fallbackText: event.fallbackText,
        body: event.body,
        files: event.files,
        isEdited: true,
      });
    },

    applyMessageDelete(event) {
      if (event.channelId === "" || event.messageTs === "") {
        return undefined;
      }

      const existing = messagesByConversation
        .get(event.channelId)
        ?.get(event.messageTs);

      return put({
        text: "",
        files: [],
        isEdited: false,
        ...event.previous,
        ...existing,
        channelId: event.channelId,
        ts: event.messageTs,
        isDeleted: true,
      });
    },

    markUnresolvable: (id) => unresolvable.add(id),
    isUnresolvable: (id) => unresolvable.has(id),
  };
}
