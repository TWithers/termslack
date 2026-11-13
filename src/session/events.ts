import type { SocketStatus } from "../slack/socket";
import type { ContentBlock } from "./content";

export type ConversationKind = "channel" | "group" | "im" | "mpim";

/** Whether a kind is a public or private channel. */
export function isChannel(kind: ConversationKind | undefined): boolean {
  return kind === "channel" || kind === "group";
}

/** Whether a kind is a DM or a group DM. */
export function isDirectMessage(kind: ConversationKind | undefined): boolean {
  return kind === "im" || kind === "mpim";
}

/**
 * The ts of the thread a message is a reply in, or undefined for a message
 * that isn't one (a thread's own parent counts as not a reply).
 */
export function replyParentOf(message: {
  ts: string;
  threadTs?: string;
}): string | undefined {
  return message.threadTs !== undefined && message.threadTs !== message.ts
    ? message.threadTs
    : undefined;
}

/** A channel, private channel, DM or group DM, as termslack stores it. */
export type Conversation = {
  id: string;
  kind: ConversationKind;
  /** Channels and private channels; group DMs carry Slack's generated name; DMs have none. */
  name?: string;
  isArchived: boolean;
  /** Whether the current user is in it. */
  isMember: boolean;
  /** The other person, for DMs. */
  userId?: string;
  /** How many people are in it, when Slack's record says (`conversations.list` does). */
  memberCount?: number;
  /**
   * When Slack last changed the conversation record (ms since the epoch). Not
   * message activity: many DMs share one bulk-update time. Only a fallback.
   */
  updated?: number;
};

/** A person's custom status. Both are "" when cleared. The emoji is Slack's `:shortcode:`. */
export type UserStatus = {
  emoji: string;
  text: string;
};

/**
 * A person or bot user as termslack stores it. Everything but `id` is optional
 * because partial profile events only carry what changed.
 */
export type User = {
  id: string;
  /** Slack's username (`name`), the last fallback for a display name. */
  name?: string;
  realName?: string;
  /** The profile display name; "" when the person never set one. */
  displayName?: string;
  isBot?: boolean;
  isDeleted?: boolean;
  status?: UserStatus;
  /** The colour Slack gives the person, as `#rrggbb`. Bots and apps may have none. */
  color?: string;
};

/** A user group (`@engineering`), as `usergroups.list` describes it. */
export type UserGroup = {
  id: string;
  /** What follows the `@` when people mention the group. */
  handle: string;
  name?: string;
  /** Who is in the group, when the listing that described it said (`include_users`). */
  userIds?: string[];
};

/** A workspace's custom emoji. A terminal can't draw it, so it shows as `:name:` unless it's an alias for a standard emoji. */
export type CustomEmoji = {
  /** The shortcode, without colons. */
  name: string;
  /** The emoji it is an alias for (`alias:other` in Slack's list). */
  aliasOf?: string;
};

/** A bot or integration, as `bots.info` describes it. */
export type Bot = {
  id: string;
  name: string;
  /** The bot's user, when it has one. */
  userId?: string;
};

/** Fields every Slack-derived event carries. */
type SlackEventBase = {
  /** The envelope body exactly as Slack sent it; `--raw` prints this. */
  raw: Record<string, any>;
  /** Slack `ts` / `event_ts`, when the event had one. */
  timestamp?: string;
  /** Fields the conversion layer expected but didn't find. Empty for well-formed payloads. */
  issues: string[];
};

/** Who wrote a message: a person, or a bot or integration (with the name the message carried). */
export type Author = {
  userId?: string;
  botId?: string;
  botName?: string;
};

/** What a message carries besides its author and place: the parts a view can show. */
export type MessageContent = {
  /** "" when the message has none (attachment-only, block-only or file-only messages). */
  text: string;
  /** Plain text taken from attachments and blocks, for when `text` is empty. */
  fallbackText?: string;
  /** Structured content from the message's `rich_text` blocks; shown instead of `text` when present. */
  body?: ContentBlock[];
  /** Names (else titles) of shared files. */
  files: string[];
};

/** One emoji reaction on a message, as the store keeps it. */
export type Reaction = {
  /** Slack's name without colons; a skin tone is part of it (`+1::skin-tone-2`). */
  name: string;
  /** Who reacted, as far as Slack said: history lists can be shorter than `count`. */
  userIds: string[];
  /** How many reacted. Authoritative over `userIds`. */
  count: number;
};

/** A message as the workspace store keeps it. Edits and deletes change it in place. */
export type Message = MessageContent &
  Author & {
    channelId: string;
    /** Unique within the conversation; the key. */
    ts: string;
    /** Set on thread replies and thread parents. */
    threadTs?: string;
    subtype?: string;
    /** How many replies a thread parent has, when Slack said (history and replies pages do; live events don't). */
    replyCount?: number;
    /** In the order the reactions first appeared. Undefined when the message came from a source that doesn't say (live messages); empty when history said there are none. */
    reactions?: Reaction[];
    isEdited: boolean;
    isDeleted: boolean;
    /**
     * Set only on a message the current user is sending from termslack: `pending`
     * until Slack confirms it, `failed` if sending it didn't work. Stored and
     * history messages never have it.
     */
    delivery?: "pending" | "failed";
  };

/** `botName` is the name the message carried for a bot or integration (`username`, else `bot_profile.name`). */
export type MessageEvent = SlackEventBase &
  Author & {
    kind: "message";
    /** "" when the payload had none. */
    channelId: string;
    channelKind?: ConversationKind;
    text: string;
    fallbackText?: string;
    body?: ContentBlock[];
    files: string[];
    ts: string;
    threadTs?: string;
    subtype?: string;
    /** The ID the sender gave the message, when Slack carried it into the event. */
    clientMsgId?: string;
  };

/** The author is that of the edited message. */
export type MessageEditedEvent = SlackEventBase &
  Author & {
    kind: "messageEdited";
    channelId: string;
    channelKind?: ConversationKind;
    text: string;
    fallbackText?: string;
    body?: ContentBlock[];
    files: string[];
    threadTs?: string;
    /** `ts` of the message that was edited. */
    messageTs: string;
  };

export type MessageDeletedEvent = SlackEventBase & {
  kind: "messageDeleted";
  channelId: string;
  channelKind?: ConversationKind;
  /** `ts` of the message that was deleted. */
  messageTs: string;
  /** What Slack says the message looked like, for when the store never saw it. */
  previous?: MessageContent &
    Author & {
      threadTs?: string;
    };
};

export type ReactionEvent = SlackEventBase & {
  kind: "reaction";
  action: "added" | "removed";
  channelId: string;
  userId: string;
  reaction: string;
  /** `ts` of the message reacted to. */
  messageTs: string;
};

export type EmojiAction = "added" | "removed" | "renamed";

/** The workspace's custom emoji changed (`emoji_changed`). */
export type EmojiEvent = SlackEventBase & {
  kind: "emoji";
  action: EmojiAction;
  /** The emoji added or removed; for a rename, the new name. */
  names: string[];
  /** The previous name, for a rename. */
  oldName?: string;
  /** The emoji it is an alias for, when it is one (added and renamed). */
  aliasOf?: string;
};

export type UserGroupAction = "membersChanged" | "selfAdded" | "selfRemoved";

/** Someone joined or left a user group (`subteam_members_changed`, `subteam_self_added`, `subteam_self_removed`). */
export type UserGroupEvent = SlackEventBase & {
  kind: "userGroup";
  action: UserGroupAction;
  /** Slack's own event type, e.g. `subteam_self_added`. */
  eventType: string;
  /** "" when the payload had none. */
  userGroupId: string;
  /** Who joined; empty for `selfAdded` and `selfRemoved`, which are about the current user. */
  addedUserIds: string[];
  /** Who left; empty for `selfAdded` and `selfRemoved`. */
  removedUserIds: string[];
};

export type UserAction =
  "changed" | "profileChanged" | "statusChanged" | "joined";

/** A person's profile, status or account changed, or a new person joined (`user_change`, `user_profile_changed`, `user_status_changed`, `team_join`). */
export type UserEvent = SlackEventBase & {
  kind: "user";
  action: UserAction;
  /** Slack's own event type, e.g. `user_change`. */
  eventType: string;
  /** "" when the payload had none. */
  userId: string;
  /** What the event says about them; fields it doesn't mention are undefined. */
  user: User;
};

/**
 * What Slack says about the current user's Do Not Disturb (`dnd.info`,
 * `dnd_updated`). Times are Unix seconds.
 */
export type DndStatus = {
  /** Whether scheduled Do Not Disturb hours are set up. */
  scheduleEnabled: boolean;
  /** The scheduled window that is under way, or the next one; undefined when Slack gave none. */
  nextStartTs?: number;
  nextEndTs?: number;
  /** When a snooze ends; undefined unless the user is snoozing. */
  snoozeEndTs?: number;
};

/** Someone's Do Not Disturb changed (`dnd_updated` for the current user, `dnd_updated_user` for others). */
export type DndEvent = SlackEventBase & {
  kind: "dnd";
  /** Slack's own event type, `dnd_updated` or `dnd_updated_user`. */
  eventType: string;
  /** "" when the payload had none. */
  userId: string;
  status: DndStatus;
};

export type ConversationAction =
  | "created"
  | "renamed"
  | "archived"
  | "unarchived"
  | "deleted"
  | "left"
  | "memberLeft"
  | "joined";

/** A channel was created, renamed, archived, joined, and so on (`channel_*`, `group_*`, `member_joined_channel`, `member_left_channel`). `left` is the current user leaving (`channel_left`, `group_left`); `memberLeft` is anyone leaving. */
export type ConversationEvent = SlackEventBase & {
  kind: "conversation";
  action: ConversationAction;
  /** Slack's own event type, e.g. `group_rename`. */
  eventType: string;
  /** "" when the payload had none. */
  channelId: string;
  channelKind: ConversationKind;
  /** The channel's new name (created and renamed). */
  name?: string;
  /** Who joined, left or archived. */
  userId?: string;
};

/**
 * Anything the conversion layer doesn't know how to interpret. Views print it
 * as JSON.
 */
export type UnrecognizedEvent = SlackEventBase & {
  kind: "unrecognized";
  /** Socket Mode envelope type, e.g. `events_api` or `slash_commands`. */
  envelopeType: string;
  /** Inner Slack event type, when the envelope wrapped one. */
  eventType?: string;
  /** The inner Slack event, when the envelope wrapped one. */
  event?: Record<string, any>;
};

export type ConnectionEvent = {
  kind: "connection";
  status: SocketStatus;
  error?: Error;
};

export type SlackEvent =
  | MessageEvent
  | MessageEditedEvent
  | MessageDeletedEvent
  | ReactionEvent
  | EmojiEvent
  | UserEvent
  | UserGroupEvent
  | DndEvent
  | ConversationEvent
  | UnrecognizedEvent;

export type SessionEvent = SlackEvent | ConnectionEvent;

/** Whether a person is around, as `users.getPresence` says. */
export type Presence = "active" | "away";
