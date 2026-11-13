import type { SocketModeClient } from "@slack/socket-mode";
import { slackClient } from "../slack/client";
import {
  fetchConversation,
  fetchConversationMembers,
  type ConversationMembers,
  fetchConversationsPage,
} from "../slack/conversations";
import {
  fetchBot,
  fetchUser,
  fetchUserGroups,
  fetchUsersPage,
} from "../slack/users";
import { fetchIdentity } from "../slack/auth";
import { fetchCustomEmoji } from "../slack/emoji";
import { convertEnvelope, type MessagesPage } from "../slack/convert";
import { fetchHistoryPage, fetchRepliesPage } from "../slack/history";
import { createDmActivity } from "./dmActivity";
import { updateDmActivity, type DmActivityOptions } from "./dmActivityPass";
import {
  createListingHealth,
  defaultListingRetryDelaysMs,
  type ListingHealth,
} from "./listingHealth";
import { createPauser } from "./pacing";
import { type MentionDirectory } from "./mentions";
import {
  createMessageActions,
  type ActionResult,
  type EditDraft,
  type EditRequest,
  type MessageRef,
} from "./messageActions";
import { createDirectMessages } from "./directMessages";
import { createChannelJoins } from "./channelJoin";
import {
  createChannelDetails,
  type ChannelDetailsResult,
} from "./channelDetails";
import type { SectionConfig } from "../config/config";
import type { MuteMemory, SectionsMemory } from "../config/state";
import { createMutedChannels } from "./mutedChannels";
import { createSections, type SectionChange } from "./sections";
import { createChannelLeaves, type LeaveChannelResult } from "./channelLeave";
import type { ConversationResult } from "./conversationCommand";
import {
  createPublicChannels,
  type PublicChannelsStatus,
} from "./publicChannels";
import { createReactionActions, type ReactionRequest } from "./reactions";
import {
  createMessageSearch,
  type SearchResult,
  type SearchState,
} from "./messageSearch";
import { createScopes, type ScopedFeature } from "./scopes";
import { type Clock, systemClock } from "./clock";
import { createDoNotDisturb } from "./doNotDisturb";
import { createPresence, type PresenceOptions } from "./presence";
import {
  createNotifications,
  type NotificationListener,
} from "./notifications";
import { createOutgoing, type SendRequest, type SendResult } from "./outgoing";
import {
  createUnreadCheck,
  type UnreadCheckOptions,
  type UnreadCheckProgress,
} from "./unreadCheck";
import { createReadMarks, defaultReadMarkDebounceMs } from "./readMarks";
import {
  connectSocket,
  type SocketOptions,
  type SocketStatus,
} from "../slack/socket";
import {
  isDirectMessage,
  replyParentOf,
  type Author,
  type Bot,
  type Conversation,
  type Message,
  type MessageEvent,
  type CustomEmoji,
  type Presence,
  type SessionEvent,
  type SlackEvent,
  type User,
  type UserGroup,
} from "./events";
import {
  type ConversationRefResult,
  findConversationByRef,
} from "./conversationRef";
import { mentionedIds } from "./messageText";
import {
  createNameResolver,
  type NameResolver,
  type NameResolverOptions,
} from "./nameResolver";
import { messageAttention, mentionsUserGroup } from "./attention";
import { createChangeTracker } from "./changeTracker";
import { type ConversationMarkers, createUnreadTracker } from "./unreadTracker";
import { compareTs, createWorkspaceStore } from "./workspaceStore";

export type {
  Notification,
  NotificationListener,
  NotifiedMessage,
} from "./notifications";

export type SessionListener = (event: SessionEvent) => void;

export type SessionOptions = {
  /**
   * The longest an event waits for the names it mentions before it's
   * published with raw IDs. The lookups carry on in the background so later
   * events show the names. Defaults to 1500.
   */
  nameWaitMs?: number;
  /**
   * How many messages the store keeps per conversation before dropping the
   * oldest (anything dropped can be loaded again from history). Defaults to 1000.
   */
  maxMessagesPerConversation?: number;
  /**
   * How long to wait before each retry of a failed startup listing (the
   * conversations or the people). One retry per entry; after the last one
   * fails the listing stays `failed`. Defaults to 2s, 5s, 15s, 30s, 60s.
   */
  listingRetryDelaysMs?: number[];
  /**
   * Turns on the background work that learns when each DM last had a message
   * (see `dmActivity`). Without it only the messages the session sees count.
   */
  dmActivity?: DmActivityOptions;
  /**
   * Turns on the background check that finds conversations already unread in
   * Slack at startup (see `UnreadCheckOptions`). Without it only messages
   * arriving while the session runs mark anything.
   */
  unreadCheck?: UnreadCheckOptions;
  /**
   * Where the channels muted in termslack are remembered between runs. Default:
   * nothing is remembered.
   */
  muteMemory?: MuteMemory;
  /**
   * The sidebar sections from `config.toml`, used until termslack keeps its own
   * (see `sections`). Default: none.
   */
  configuredSections?: SectionConfig[];
  /** Where the sections termslack keeps are remembered between runs. Default: nothing is remembered. */
  sectionsMemory?: SectionsMemory;
  /**
   * How long to wait, after a conversation is opened or gets a new message
   * while open, before marking it read in Slack; requests in that time are
   * coalesced into one call. Defaults to 750.
   */
  readMarkDebounceMs?: number;
  /**
   * The time and timers the notification logic runs on: how long notifications
   * are gathered, and when a Do Not Disturb snooze or schedule starts and
   * ends. Defaults to the real ones.
   */
  clock?: Clock;
  /**
   * How long notifications close together are gathered into one. Defaults to
   * 1000 (see `defaultNotificationWindowMs`).
   */
  notificationWindowMs?: number;
  /**
   * The least time between two notifications; what arrives sooner is held.
   * Defaults to `notificationIntervalMs`.
   */
  notificationIntervalMs?: number;
  /** The presence polling budget (see `PresenceOptions`). Defaults to the documented one. */
  presence?: PresenceOptions;
};

export type { DmActivityOptions, PresenceOptions };
export type { UnreadCheckOptions, UnreadCheckProgress };
export type { SendRequest, SendResult };
export type { ListingHealth, ListingStatus } from "./listingHealth";
export type { ConversationResult, PublicChannelsStatus };
export type { SearchResult, SearchState };

const defaultNameWaitMs = 1500;
const defaultHistoryPageSize = 50;
const aroundHistoryPageSize = 200;
const aroundHistoryContext = 10;
const defaultRepliesPageSize = 100;
const defaultListingWaitMs = 10_000;

/** What one call to a history command brought in. */
export type HistoryPage = {
  /**
   * The messages this call loaded, oldest first, as the store now holds them
   * (so live edits and deletions are applied; a deleted message has `isDeleted`).
   * Empty once everything has been loaded.
   */
  messages: Message[];
  /** Whether another call would find older (history) or later (replies) messages. */
  hasMore: boolean;
};

/** Where `loadHistoryAround` left a conversation. */
export type AroundResult = {
  /** Whether the message is among the loaded messages (it isn't if it was deleted or never existed). */
  found: boolean;
  /** Whether older messages remain to be loaded. */
  hasMore: boolean;
  /** Whether the message is older than the oldest one loaded (the one page `loadHistoryAround` loads didn't reach it); scrolling up loads more. */
  isFurtherBack: boolean;
};

export type HistoryOptions = {
  /** Messages to ask Slack for per page. Defaults to 50 for history and 100 for thread replies. */
  limit?: number;
};

/** Where a conversation's or thread's paging has got to. */
type Pager = {
  cursor?: string;
  exhausted: boolean;
  /** Calls for one pager run one at a time, so each continues where the last stopped. */
  running: Promise<unknown>;
};

/** Settles with the promise's value, or undefined if it fails or takes longer than `ms`. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    const settle = (value: T | undefined) => {
      clearTimeout(timer);
      resolve(value);
    };

    promise.then(settle, () => settle(undefined));
  });
}

function storedMessage(event: MessageEvent): Message {
  return {
    channelId: event.channelId,
    ts: event.ts,
    threadTs: event.threadTs,
    userId: event.userId,
    botId: event.botId,
    botName: event.botName,
    text: event.text,
    fallbackText: event.fallbackText,
    body: event.body,
    files: event.files,
    subtype: event.subtype,
    isEdited: false,
    isDeleted: false,
  };
}

export type WorkspaceSession = {
  /** Current connection state. */
  readonly status: SocketStatus;
  /** Receives every event from now on, including connection changes. Returns an unsubscribe function. */
  subscribe(listener: SessionListener): () => void;
  /**
   * Calls `listener` (no arguments) after anything a view can read changes:
   * live events, history and thread pages, the background listings, emoji and
   * user groups, names resolving late, and the connection status. Many
   * changes in one tick give one call. Pair with `version` for
   * `useSyncExternalStore(session.subscribeToChanges, session.version)`.
   */
  subscribeToChanges(listener: () => void): () => void;
  /**
   * A number that is the same until something changes and different after
   * any change. Cheap; call it as often as needed. Don't read meaning into
   * the value.
   */
  version(): number;
  /** A conversation the store knows right now. Never calls Slack. */
  conversation(id: string): Conversation | undefined;
  /** Everything the store knows, in the order it was learned. */
  conversations(): Conversation[];
  /**
   * When a DM or group DM last had a message (ms since the epoch): the newest
   * message seen live, loaded from history, found by the background pass or
   * remembered from an earlier run; else the conversation listing's `updated`
   * (which is only a rough guide); else undefined. Never calls Slack.
   */
  dmActivity(conversationId: string): number | undefined;
  /** Whether Slack won't show a DM's history (a deactivated user, say), so it's left out. Never calls Slack. */
  isDmHidden(conversationId: string): boolean;
  /** A person the store knows right now. Never calls Slack. */
  user(id: string): User | undefined;
  /** Everyone the store knows, in the order it learned them. */
  users(): User[];
  /** A user group the store knows right now. Never calls Slack. */
  userGroup(id: string): UserGroup | undefined;
  /** Every user group the store knows, in the order it learned them. */
  userGroups(): UserGroup[];
  /**
   * Everything `@` and `#` can point at, as the store knows it: what the input
   * completes from and what `toSlackText` and `fromSlackText` convert with.
   * Never calls Slack.
   */
  mentionDirectory(): MentionDirectory;
  bot(id: string): Bot | undefined;
  /**
   * A conversation's stored messages, oldest first, without thread replies,
   * followed by the ones the user is sending (`delivery` says which).
   * Never calls Slack.
   */
  messages(conversationId: string): Message[];
  /** One stored message, with its edits and deletion applied. Never calls Slack. */
  message(conversationId: string, ts: string): Message | undefined;
  /** The stored replies of a thread, oldest first (the parent isn't included), then the ones being sent. Never calls Slack. */
  threadReplies(conversationId: string, threadTs: string): Message[];
  /**
   * Sends a message as the user. It shows at once in `messages` (or
   * `threadReplies`) as pending and becomes the confirmed message when
   * Slack's response or its socket echo arrives, whichever is first, never
   * twice. Blank text isn't sent. Never rejects: a failure says why in words
   * fit for the status bar and leaves the message marked `failed`.
   */
  sendMessage(request: SendRequest): Promise<SendResult>;
  /**
   * Opens the DM with a person, creating it if there is none. It is added to
   * the store once, whether Slack made it or already had it (a DM the store
   * didn't know), and counts as active now so the recent DMs list it. A DM the
   * store knows is returned without calling Slack. Never rejects: a missing
   * `im:write` scope or a Slack refusal says why in words fit for the status
   * bar and changes nothing.
   */
  startDirectMessage(userId: string): Promise<ConversationResult>;
  /**
   * Joins a public channel the user isn't in (`conversations.join`). It is
   * stored as one the user is in, however the `member_joined_channel` echo
   * races the answer, so the sidebar lists it once. A channel the store knows
   * the user is in returns without calling Slack. Never rejects: a missing
   * `channels:write` scope or a Slack refusal says why in words fit for the
   * status bar and changes nothing.
   */
  joinChannel(conversationId: string): Promise<ConversationResult>;
  /**
   * Why a conversation can't be joined or left, in words for the status bar:
   * the token lacks the scope (`channels:write`, or `groups:write` to leave a
   * private channel), or it isn't a channel to leave; undefined when it can.
   * Never calls Slack.
   */
  conversationProblem(
    action: "join" | "leave",
    conversationId: string,
  ): string | undefined;
  /**
   * Leaves a public or private channel (`conversations.leave`). The store
   * then holds it as one the user isn't in, however the `channel_left` echo
   * races the answer; a channel it knows the user is out of returns without
   * calling Slack. Never rejects: a missing scope, a DM, or a Slack refusal
   * (`cant_leave_general`, `last_member`, ...) says why in words fit for the
   * status bar and changes nothing.
   */
  leaveChannel(conversationId: string): Promise<LeaveChannelResult>;
  /**
   * Whether the channel is muted in termslack: it never notifies or rings, and the
   * sidebar draws it quietly. Slack doesn't know (its API can't mute); the
   * list is termslack's own, loaded from the state file at `start`.
   */
  isMuted(conversationId: string): boolean;
  /**
   * Mutes or unmutes a channel at once and remembers it. Leaving the channel
   * (here or elsewhere) unmutes it.
   */
  setMuted(conversationId: string, muted: boolean): void;
  /**
   * The sidebar's sections, in order, channels by ID, name or `#name`: the
   * config's until the first change, termslack's own (loaded from the state file at
   * `start`) after it.
   */
  sections(): SectionConfig[];
  /** Whether termslack keeps the sections, so `config.toml`'s are ignored. */
  sectionsKeptByTermslack(): boolean;
  /** The note for the status bar, once, when the first change took the sections over; undefined until then and in later runs. */
  sectionsNote(): string | undefined;
  /**
   * Puts a channel in a section, taking it out of any other, and redraws at
   * once. The first change copies the shown sections into the state file
   * (names resolved to channel IDs, unknown ones dropped); `config.toml` is
   * never written. Fails when no section has that name.
   */
  moveToSection(conversationId: string, sectionName: string): SectionChange;
  /** Takes a channel out of every section (back to Channels). A change, like `moveToSection`. */
  removeFromSections(conversationId: string): void;
  /**
   * Creates an empty section after the last one; it stays while empty. Fails
   * with a reason on an empty (blank) name or one a section already has.
   */
  addSection(name: string): SectionChange;
  /**
   * A channel's topic, description (Slack's purpose), creator, creation time
   * and member count, asked of Slack every time (`conversations.info`). The
   * people and channels the texts mention and the creator are in the store
   * by the time it answers. Never rejects: a refusal (`channel_not_found`,
   * `missing_scope`, ...) says why in words fit for the popup.
   */
  channelDetails(conversationId: string): Promise<ChannelDetailsResult>;
  /**
   * Lists the workspace's public channels that aren't archived into the
   * store, the ones the user isn't in as non-members, paging through the
   * listing. Nothing starts it but this call, so a session that never needs
   * the channels never lists them. It runs once: further calls share it or,
   * once loaded, do nothing; after a failure the next call tries again.
   * Channel events keep the store current from then on. Never rejects.
   */
  loadPublicChannels(): Promise<void>;
  /** How `loadPublicChannels` is doing. Changes are announced like any other (`subscribeToChanges`). */
  publicChannelsStatus(): PublicChannelsStatus;
  /**
   * Why the current user can't edit or delete a message (it isn't theirs, or
   * isn't sent yet), in words for the status bar; undefined when they can.
   */
  modifyProblem(
    message: MessageRef,
    action: "edit" | "delete",
  ): string | undefined;
  /** A stored message's text as the input shows it (mentions as names), with the mentions it holds. */
  editDraft(message: MessageRef): EditDraft | undefined;
  /**
   * Edits one of the user's own messages. The stored message shows the new
   * text and "(edited)" at once; Slack's echo settles it without a second
   * change. If Slack refuses, the message goes back as it was and the result
   * says why. Unchanged text is a no-op that doesn't call Slack. Never rejects.
   */
  editMessage(request: EditRequest): Promise<ActionResult>;
  /**
   * Deletes one of the user's own messages. It shows as deleted at once; if
   * Slack refuses it comes back and the result says why. Never rejects.
   */
  deleteMessage(request: MessageRef): Promise<ActionResult>;
  /** Why the message can't be reacted to (it isn't stored, so it is still sending), in words for the status bar; undefined when it can. */
  reactionProblem(message: MessageRef): string | undefined;
  /** Whether the current user has reacted to the message with that emoji (`tada`, `:tada:`, `+1::skin-tone-2`). Never calls Slack. */
  hasReacted(message: MessageRef, name: string): boolean;
  /**
   * Adds the user's reaction. It shows at once; Slack's `reaction_added` echo
   * settles it without counting twice. `already_reacted` counts as done; any
   * other refusal takes it back and the result says why. Never rejects.
   */
  addReaction(request: ReactionRequest): Promise<ActionResult>;
  /**
   * Takes the user's reaction back, with the same guarantees as `addReaction`
   * (`no_reaction` counts as done).
   */
  removeReaction(request: ReactionRequest): Promise<ActionResult>;
  /**
   * Loads a page of a conversation's history into the store. The first call
   * loads the newest messages; each further call loads the page before the
   * last one, following Slack's cursor until `hasMore` is false. Calls for the
   * same conversation queue up. Live events arriving meanwhile are merged by
   * `ts`: a message is stored once, edits and deletions are never undone, and
   * `messages()` stays in timestamp order. Names the page mentions are
   * resolved first (within `nameWaitMs`). Rejects with Slack's error (for
   * example `channel_not_found`) and then stays where it was, so it can be
   * retried.
   *
   * Once history is loaded for a conversation the store stops dropping its
   * oldest messages, so scrollback is never evicted by the per-conversation limit.
   */
  loadHistory(
    conversationId: string,
    options?: HistoryOptions,
  ): Promise<HistoryPage>;
  /**
   * Loads history for opening a message found by search: unless `ts` and a
   * few earlier messages are already loaded, one page of 200 more from where
   * history stands (the newest page if none is), through the same pager as
   * `loadHistory` so scrolling up carries on from there and everything newer
   * is already loaded. Never loads more than that one page: when the message
   * is older, `isFurtherBack` says so. Rejects with Slack's error and stays
   * where it got to, so it can be retried.
   */
  loadHistoryAround(conversationId: string, ts: string): Promise<AroundResult>;
  /**
   * Loads a page of a thread's replies, oldest first, continuing from the
   * previous call as `loadHistory` does. The parent is stored (with its reply
   * count) but isn't in `messages`.
   */
  loadThreadReplies(
    conversationId: string,
    threadTs: string,
    options?: HistoryOptions,
  ): Promise<HistoryPage>;
  /**
   * Looks up whatever is needed to name a conversation: the conversation
   * itself, the other person in a DM, the members of a group DM and their
   * names. Simultaneous calls share lookups, and anything already known or
   * known to be unresolvable costs nothing. The change notification fires as
   * names arrive. Never rejects.
   */
  resolveConversationPeople(conversationId: string): Promise<void>;
  /**
   * Finds a conversation from what a person typed: `general`, `#general`,
   * `@name` (an existing DM with that person) or an ID. Waits (up to `waitMs`,
   * default 10 seconds) for the startup listing of conversations and people,
   * which `start` loads in the background. Never rejects.
   */
  findConversation(
    reference: string,
    options?: { waitMs?: number },
  ): Promise<ConversationRefResult>;
  /** A custom emoji the store knows right now, by shortcode without colons. */
  customEmoji(name: string): CustomEmoji | undefined;
  /** The shortcodes of all the workspace's custom emoji. */
  customEmojiNames(): string[];
  /** Whether the current user is in a user group, as far as is known. */
  isInUserGroup(id: string): boolean;
  /**
   * What the sidebar shows for a conversation: whether it has new messages
   * from others since startup, and how many of them mention the user (see
   * `messageAttention`). Never calls Slack.
   */
  markers(conversationId: string): ConversationMarkers;
  /**
   * How far the startup unread check is (conversations checked of those to
   * check) while it runs; undefined before it starts and once it is done.
   * Changes are announced like any other (`subscribeToChanges`).
   */
  unreadCheckProgress(): UnreadCheckProgress | undefined;
  /**
   * Tells the session which conversation the user is looking at (`undefined`
   * for none). Its markers are cleared now, and messages arriving in it never
   * mark it while it stays open.
   */
  setOpenConversation(conversationId: string | undefined): void;
  /**
   * Tells the session which people are on screen, in screen order: the person
   * of each DM the sidebar shows and of the open DM (group DMs aren't people
   * to check; bots and the user are left out by the session). Only they are
   * checked for presence, within a budget; one who stays off screen for a
   * while is forgotten.
   */
  setVisiblePeople(userIds: string[]): void;
  /**
   * Whether a person is `active` or `away`, as of the last check; undefined
   * while that isn't known (never checked, not allowed, forgotten, or
   * unavailable). Never calls Slack. Changes are announced like any other
   * (`subscribeToChanges`).
   */
  presence(userId: string): Presence | undefined;
  /**
   * Tells the session whether the terminal window has the focus (`undefined`
   * when it doesn't know). Messages in view don't notify while it is `true`;
   * until the terminal says anything they notify as if it were `false`.
   */
  setTerminalFocused(focused: boolean | undefined): void;
  /**
   * Calls `listener` when new messages call for the user's attention: the
   * live messages that get a mention marker (they mention the user, a group
   * they are in, `@here`/`@channel`/`@everyone`, or arrive in a DM), except
   * the user's own, edits, deletes, history, the startup unread check, while
   * Do Not Disturb is on, and while the message is in view. Messages close
   * together come as one notification. Returns an unsubscribe function.
   * termslack has no record of muted conversations, so none are excluded.
   */
  subscribeToNotifications(listener: NotificationListener): () => void;
  /**
   * Why Do Not Disturb isn't being followed (it couldn't be read, or the
   * token lacks `dnd:read`), in words for the status bar; undefined while it
   * is. Changes are announced like any other (`subscribeToChanges`).
   */
  dndNote(): string | undefined;
  /**
   * How the startup listings are doing. A listing that fails is retried with
   * backoff and is `retrying` until it succeeds (`loaded`) or runs out of
   * retries (`failed`). Never calls Slack.
   */
  listingHealth(): ListingHealth;
  /** Member IDs of a group DM, once known. */
  conversationMembers(id: string): string[] | undefined;
  /**
   * Searches the workspace's messages (`search.messages`, Slack's query
   * syntax) newest first and keeps the results in `searchState`, replacing
   * those of any earlier search; an earlier search still waiting for Slack
   * can no longer replace them. Results are shown once the names they
   * mention are resolved (within `nameWaitMs`). A blank query does nothing.
   * Never rejects: a refusal or a missing `search:read` scope is in
   * `searchState().failure`.
   */
  search(query: string): Promise<void>;
  /**
   * Loads the next page of the current search into `searchState` while Slack
   * says there is one; does nothing otherwise or while a page is loading.
   * Never rejects: a failure is in `searchState().failure` and the next call
   * tries again.
   */
  searchMore(): Promise<void>;
  /** The current search: its query (kept for the whole session), the results so far and where paging has got to. Never calls Slack. */
  searchState(): SearchState;
  /**
   * Why a feature is off because the token lacks the scope it needs, in words
   * for the UI; undefined when it is available or the granted scopes aren't
   * known (then Slack's own refusal, if any, is explained when it comes).
   */
  scopeProblem(feature: ScopedFeature): string | undefined;
  /** Who the token belongs to, once `auth.test` has answered. */
  readonly currentUserId: string | undefined;
  /**
   * Opens the connection and starts loading the user's conversations and the
   * workspace's people in the background; it doesn't wait for that.
   *
   * Rejects with Slack's error (for example
   * `invalid_auth` for a revoked app-level token), after which the session
   * can't be reused.
   */
  start(): Promise<void>;
  stop(): Promise<void>;
};

/**
 * Owns the Socket Mode connection and turns what arrives into session events.
 * Views subscribe here and never see raw Slack payloads (apart from the
 * `raw` copy kept for `--raw` and unrecognized events).
 */
export function createWorkspaceSession(
  appToken: string,
  userToken: string,
  socketOptions: SocketOptions = {},
  {
    nameWaitMs = defaultNameWaitMs,
    maxMessagesPerConversation,
    listingRetryDelaysMs = defaultListingRetryDelaysMs,
    dmActivity: dmActivityOptions,
    unreadCheck: unreadCheckOptions,
    muteMemory,
    configuredSections = [],
    sectionsMemory,
    readMarkDebounceMs = defaultReadMarkDebounceMs,
    clock = systemClock,
    notificationWindowMs,
    notificationIntervalMs: notificationIntervalMsOption,
    presence: presenceOptions,
  }: SessionOptions = {},
): WorkspaceSession {
  const listeners = new Set<SessionListener>();
  const changes = createChangeTracker();
  const store = createWorkspaceStore({ maxMessagesPerConversation, changes });
  const unread = createUnreadTracker(changes);
  const muted = createMutedChannels({
    memory: muteMemory,
    changed: changes.changed,
  });
  const sections = createSections({
    configured: configuredSections,
    memory: sectionsMemory,
    conversations: () => store.conversations(),
    changed: changes.changed,
  });
  const dms = createDmActivity({
    changes,
    updated: (id) => store.conversation(id)?.updated,
    cache: dmActivityOptions?.cache,
  });
  let status: SocketStatus = "disconnected";
  let socket: SocketModeClient | undefined;
  let currentUserId: Promise<string | undefined> = Promise.resolve(undefined);
  let currentUser: string | undefined;
  let stopped = false;
  let startupListing: Promise<unknown> = Promise.resolve();
  let userGroupsLoading: Promise<unknown> = Promise.resolve();
  let dmPass: Promise<unknown> = Promise.resolve();
  const pagers = new Map<string, Pager>();
  const historyLoaded = new Set<string>();
  const membersUnresolvable = new Set<string>();
  // Events are published in arrival order, each after the names it mentions are resolved (within a time limit).
  let queue: Promise<void> = Promise.resolve();

  const client = () => slackClient(userToken);
  const { pause, wakeAll } = createPauser();
  const listings = createListingHealth({
    changes,
    retryDelaysMs: listingRetryDelaysMs,
    pause,
    isStopped: () => stopped,
  });
  const readMarks = createReadMarks({
    client,
    unread,
    isLoaded: (id) => historyLoaded.has(id),
    newestLoadedTs: (id) => store.messages(id).at(-1)?.ts,
    canMark: (id) => store.conversation(id)?.isMember !== false,
    debounceMs: readMarkDebounceMs,
    isStopped: () => stopped,
  });

  const unreadCheck = createUnreadCheck(
    {
      client,
      currentUserId: () => currentUserId,
      conversations: store.conversations,
      conversation: store.conversation,
      isInUserGroup: store.isInUserGroup,
      isMuted: muted.isMuted,
      dms,
      unread,
      observeDm: (id, ts) => observeDm(id, ts),
      pause,
      isStopped: () => stopped,
      changed: changes.changed,
    },
    unreadCheckOptions,
  );

  const mentionDirectory = (): MentionDirectory => ({
    users: store.users(),
    userGroups: store.userGroups(),
    conversations: store.conversations(),
  });

  const scopes = createScopes();

  const dnd = createDoNotDisturb({
    client,
    scopeProblem: () => scopes.problem("dnd"),
    clock,
    changes,
    isStopped: () => stopped,
  });

  const presence = createPresence({
    client,
    clock,
    changes,
    isStopped: () => stopped,
    isCheckable: (id) => {
      const user = store.user(id);

      return (
        currentUser !== undefined &&
        id !== currentUser &&
        listings.current().people !== "loading" &&
        !user?.isBot &&
        !user?.isDeleted
      );
    },
    options: presenceOptions,
  });

  const notifications = createNotifications({
    clock,
    windowMs: notificationWindowMs,
    intervalMs: notificationIntervalMsOption,
    isDoNotDisturb: dnd.isOn,
    isStopped: () => stopped,
    lookup: {
      conversation: store.conversation,
      user: store.user,
      userGroup: store.userGroup,
      conversationMembers: store.conversationMembers,
      get currentUserId() {
        return currentUser;
      },
      customEmoji: store.customEmoji,
    },
  });

  const messageActions = createMessageActions({
    client,
    writeProblem: () => scopes.problem("write"),
    changes,
    store,
    mentionDirectory,
    currentUserId: () => currentUser,
  });

  const reactionActions = createReactionActions({
    client,
    reactProblem: () => scopes.problem("react"),
    changes,
    store,
    currentUserId: () => currentUser,
  });

  const directMessages = createDirectMessages({
    client,
    scopes,
    clock,
    store,
    dms,
  });

  const channelJoins = createChannelJoins({
    client,
    scopes,
    store,
  });

  const channelLeaves = createChannelLeaves({
    client,
    scopes,
    store,
  });

  const publicChannels = createPublicChannels({
    client,
    store,
    changes,
    isStopped: () => stopped,
  });

  const messageSearch = createMessageSearch({
    client,
    searchProblem: () => scopes.problem("search"),
    changes,
    resolve: (results) =>
      within(
        resolveLoaded(results.map(({ message }) => message)),
        nameWaitMs,
      ).then(() => undefined),
  });

  const outgoing = createOutgoing({
    client,
    writeProblem: () => scopes.problem("write"),
    changes,
    mentionDirectory,
    currentUserId: () => currentUser,
    // The echo of this message is dropped or finds it stored, so this is
    // the one place a sent reply is counted.
    storeMessage: (message) => void storeNewMessage(message),
  });

  /** A resolver whose "can't be resolved" verdicts live in the store. */
  function storeResolver<T>(
    options: Omit<
      NameResolverOptions<T>,
      "isUnresolvable" | "markUnresolvable"
    >,
  ): NameResolver<T> {
    return createNameResolver({
      ...options,
      isUnresolvable: store.isUnresolvable,
      markUnresolvable: store.markUnresolvable,
    });
  }

  const conversationResolver = storeResolver<Conversation>({
    known: store.conversation,
    lookup: (id) => fetchConversation(client(), id),
    remember: store.setConversation,
  });

  const userResolver = storeResolver<User>({
    known: store.user,
    lookup: (id) => fetchUser(client(), id),
    remember: store.setUser,
  });

  // Slack can't look up one group, so a lookup lists them all and keeps every one it learns.
  const userGroupResolver = storeResolver<UserGroup>({
    known: store.userGroup,
    lookup: async (id) => {
      const result = await fetchUserGroups(client());

      if (result.status !== "found") {
        return result;
      }

      store.loadUserGroups(result.value, currentUser);

      const group = result.value.find((candidate) => candidate.id === id);

      return group
        ? { status: "found", value: group }
        : { status: "unresolvable" };
    },
    remember: store.setUserGroup,
  });

  const botResolver = storeResolver<Bot>({
    known: store.bot,
    lookup: (id) => fetchBot(client(), id),
    remember: store.setBot,
  });

  const membersResolver = createNameResolver<ConversationMembers>({
    known: (id) => {
      const memberIds = store.conversationMembers(id);

      return memberIds && { id, memberIds };
    },
    isUnresolvable: (id) => membersUnresolvable.has(id),
    lookup: (id) => fetchConversationMembers(client(), id),
    remember: ({ id, memberIds }) =>
      store.setConversationMembers(id, memberIds),
    markUnresolvable: (id) => membersUnresolvable.add(id),
  });

  function publish(event: SessionEvent): void {
    for (const listener of [...listeners]) {
      listener(event);
    }
  }

  /** Looks up the people in a conversation: the other person in a DM, the members of a group DM. */
  async function resolveConversationPeople(id: string): Promise<void> {
    const conversation = await conversationResolver.resolve(id);

    if (conversation?.kind === "im" && conversation.userId) {
      await userResolver.resolve(conversation.userId);
    }

    if (conversation?.kind === "mpim") {
      const members = await membersResolver.resolve(id);

      await Promise.all(
        (members?.memberIds ?? []).map((member) =>
          userResolver.resolve(member),
        ),
      );
    }
  }

  async function resolveAuthor(author: Author): Promise<void> {
    if (!author.userId && author.botId) {
      if (!author.botName) {
        await botResolver.resolve(author.botId);
      }

      return;
    }

    if (author.userId) {
      await userResolver.resolve(author.userId);
    }
  }

  /** The stored message an event refers to: a reply's parent, or the message that was deleted or reacted to. */
  function relatedMessage(event: SlackEvent): Message | undefined {
    switch (event.kind) {
      case "message": {
        const parentTs = replyParentOf(event);

        return parentTs === undefined
          ? undefined
          : store.message(event.channelId, parentTs);
      }
      case "messageDeleted":
      case "reaction":
        return store.message(event.channelId, event.messageTs);
      default:
        return undefined;
    }
  }

  /** Looks up the people, channels and user groups a message's text mentions. */
  async function resolveMentions(text: string): Promise<void> {
    const { userIds, conversationIds, userGroupIds } = mentionedIds(text);

    await Promise.all([
      ...userIds.map((id) => userResolver.resolve(id)),
      ...conversationIds.map((id) => resolveConversationPeople(id)),
      ...userGroupIds.map((id) => userGroupResolver.resolve(id)),
    ]);
  }

  async function resolveNames(event: SlackEvent): Promise<void> {
    const isGone = event.kind === "conversation" && event.action === "deleted";

    const related = relatedMessage(event);
    const shown =
      event.kind === "message" || event.kind === "messageEdited"
        ? event
        : undefined;
    const previous =
      event.kind === "messageDeleted" ? event.previous : undefined;

    await Promise.all([
      "channelId" in event && !isGone
        ? resolveConversationPeople(event.channelId)
        : undefined,
      "userId" in event && event.kind !== "user" && event.kind !== "dnd"
        ? resolveAuthor(event)
        : undefined,
      previous ? resolveAuthor(previous) : undefined,
      related ? resolveAuthor(related) : undefined,
      event.kind === "userGroup" && event.userGroupId !== ""
        ? userGroupResolver.resolve(event.userGroupId)
        : undefined,
      ...[shown, related, previous].map((source) =>
        source
          ? resolveMentions(
              [source.text, source.fallbackText].filter(Boolean).join(" "),
            )
          : undefined,
      ),
    ]);
  }

  async function resolveLoaded(messages: Message[]): Promise<void> {
    await Promise.all([
      ...[...new Set(messages.map((message) => message.channelId))].map(
        (channelId) => resolveConversationPeople(channelId),
      ),
      ...messages.flatMap((message) => [
        resolveAuthor(message),
        resolveMentions(
          [message.text, message.fallbackText].filter(Boolean).join(" "),
        ),
      ]),
    ]);
  }

  function loadPage(
    key: string,
    channelId: string,
    fetchPage: (cursor?: string) => Promise<MessagesPage>,
    isWanted: (message: Message) => boolean,
    onStored?: () => void,
  ): Promise<HistoryPage> {
    const pager = pagers.get(key) ?? {
      exhausted: false,
      running: Promise.resolve(),
    };

    pagers.set(key, pager);

    const run = pager.running
      .catch(() => undefined)
      .then(async (): Promise<HistoryPage> => {
        if (pager.exhausted) {
          return { messages: [], hasMore: false };
        }

        const page = await fetchPage(pager.cursor);

        pager.cursor = page.nextCursor;
        pager.exhausted = !page.nextCursor;

        store.keepAllMessages(channelId);

        const stored = new Map<string, Message>();

        for (const message of page.messages) {
          stored.set(message.ts, store.recordMessage(message));
          observeDm(channelId, message.ts);
        }

        onStored?.();

        const messages = [...stored.values()]
          .filter(isWanted)
          .sort((a, b) => compareTs(a.ts, b.ts));

        await within(resolveLoaded(messages), nameWaitMs);

        return { messages, hasMore: !pager.exhausted };
      });

    pager.running = run;

    return run;
  }

  /** Notes a message in a DM or group DM as activity; other conversations are ignored. */
  function observeDm(
    conversationId: string,
    ts: string,
    kindHint?: Conversation["kind"],
  ): void {
    const kind = store.conversation(conversationId)?.kind ?? kindHint;

    if (isDirectMessage(kind)) {
      dms.observe(conversationId, ts);
    }
  }

  /** Marks the conversation a new message arrived in, and notifies, if it deserves it. */
  async function trackAttention(event: MessageEvent): Promise<void> {
    const me = (await within(currentUserId, nameWaitMs)) ?? currentUser;

    if (me === undefined) {
      return;
    }

    if (mentionsUserGroup(event)) {
      await within(userGroupsLoading, nameWaitMs);
    }

    const attention = messageAttention(event, {
      currentUserId: me,
      conversationKind:
        store.conversation(event.channelId)?.kind ?? event.channelKind,
      isInUserGroup: store.isInUserGroup,
    });

    unread.record(event.channelId, attention);

    if (attention === "mention" && !muted.isMuted(event.channelId)) {
      notifications.consider({
        ...event,
        channelKind:
          store.conversation(event.channelId)?.kind ?? event.channelKind,
      });
    }
  }

  /** Leaving a channel (from here or another device) forgets that it was muted. */
  function forgetMuteIfLeft(id: string): void {
    if (store.conversation(id)?.isMember === false) {
      muted.setMuted(id, false);
    }
  }

  /** Once a conversation's history is loaded, being open clears its sidebar marker and marks it read; until then it does neither. */
  function settleOpenConversation(id: string): void {
    if (historyLoaded.has(id) && unread.isOpen(id)) {
      unread.clear(id);
    }

    readMarks.schedule(id);
  }

  /**
   * A page of the conversation's own history has been stored. History always
   * runs from the newest message back, so the first page holds the newest end
   * and later ones (also from an around-load) only add older messages.
   */
  function historyArrived(id: string): void {
    historyLoaded.add(id);
    settleOpenConversation(id);
  }

  function setOpenConversation(id: string | undefined): void {
    unread.setOpen(id);

    if (id !== undefined) {
      settleOpenConversation(id);
    }
  }

  /** Stores a message, notes DM activity and counts a new reply; returns whether the message was new. */
  function storeNewMessage(
    message: Message,
    kindHint?: Conversation["kind"],
  ): boolean {
    const { channelId, ts } = message;
    const isNew = store.message(channelId, ts) === undefined;
    const parentTs = replyParentOf(message);

    store.recordMessage(message);
    observeDm(channelId, ts, kindHint);

    if (isNew && parentTs !== undefined) {
      store.addReply(channelId, parentTs);
    }

    return isNew;
  }

  /** Stores a live message and does what a new one sets off: attention, activity, reply counts and read marks. */
  async function recordMessageEvent(event: MessageEvent): Promise<void> {
    const isNew = storeNewMessage(storedMessage(event), event.channelKind);

    if (isNew) {
      await trackAttention(event);

      if (replyParentOf(event) === undefined) {
        readMarks.schedule(event.channelId);
      }
    }
  }

  async function process(event: SlackEvent): Promise<void> {
    if (event.kind === "conversation") {
      const me = (await within(currentUserId, nameWaitMs)) ?? currentUser;

      store.applyConversationEvent(event, me);
      forgetMuteIfLeft(event.channelId);
    }

    if (event.kind === "user") {
      store.applyUserEvent(event);
    }

    if (event.kind === "message" && event.channelId !== "" && event.ts !== "") {
      await outgoing.receive(event, () => recordMessageEvent(event));
    }

    if (event.kind === "userGroup") {
      const me = (await within(currentUserId, nameWaitMs)) ?? currentUser;

      store.applyUserGroupEvent(event, me);
    }

    if (event.kind === "messageEdited") {
      store.applyMessageEdit(event);
    }

    if (event.kind === "messageDeleted") {
      store.applyMessageDelete(event);
    }

    if (
      event.kind === "reaction" &&
      !reactionActions.isEchoOfShownRemoval(event)
    ) {
      store.applyReactionEvent(event);
    }

    if (event.kind === "emoji") {
      store.applyEmojiEvent(event);
    }

    if (event.kind === "dnd") {
      const me = (await within(currentUserId, nameWaitMs)) ?? currentUser;

      if (event.userId === me) {
        dnd.apply(event.status);
        notifications.doNotDisturbChanged();
      }
    }

    await within(resolveNames(event), nameWaitMs);

    publish(event);
  }

  function enqueue(event: SlackEvent): void {
    queue = queue.then(() => process(event)).catch(() => publish(event));
  }

  async function loadConversations(): Promise<void> {
    let cursor: string | undefined;

    do {
      const page = await fetchConversationsPage(client(), cursor);

      for (const conversation of page.conversations) {
        store.setConversation(conversation);
      }

      cursor = page.nextCursor;
    } while (cursor && !stopped);
  }

  async function loadUsers(): Promise<void> {
    let cursor: string | undefined;

    do {
      const page = await fetchUsersPage(client(), cursor);

      for (const user of page.users) {
        store.addUserIfAbsent(user);
      }

      cursor = page.nextCursor;
    } while (cursor && !stopped);
  }

  async function loadUserGroups(): Promise<void> {
    const me = await currentUserId;
    const result = await fetchUserGroups(client());

    if (result.status === "found") {
      store.loadUserGroups(result.value, me);
    }
  }

  async function loadEmoji(): Promise<void> {
    const result = await fetchCustomEmoji(client());

    if (result.status === "found") {
      store.loadCustomEmoji(result.value);
    }
  }

  return {
    get status() {
      return status;
    },

    subscribeToChanges: changes.subscribe,
    version: changes.version,

    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },

    conversation: store.conversation,
    conversations: store.conversations,
    dmActivity: dms.activity,
    isDmHidden: dms.isHidden,
    user: store.user,
    users: store.users,
    userGroup: store.userGroup,
    userGroups: store.userGroups,
    mentionDirectory,
    bot: store.bot,
    customEmoji: store.customEmoji,
    customEmojiNames: store.customEmojiNames,
    conversationMembers: store.conversationMembers,
    isInUserGroup: store.isInUserGroup,
    listingHealth: listings.current,
    markers: unread.markers,
    unreadCheckProgress: unreadCheck.progress,
    setOpenConversation,
    setVisiblePeople: presence.setVisible,
    presence: presence.get,
    setTerminalFocused: notifications.setTerminalFocused,
    subscribeToNotifications: notifications.subscribe,
    dndNote: dnd.note,
    messages: (id) => [...store.messages(id), ...outgoing.pending(id)],
    message: store.message,
    threadReplies: (id, threadTs) => [
      ...store.threadReplies(id, threadTs),
      ...outgoing.pending(id, threadTs),
    ],
    scopeProblem: (feature) => scopes.problem(feature),
    search: messageSearch.search,
    searchMore: messageSearch.more,
    searchState: messageSearch.state,
    sendMessage: outgoing.send,
    startDirectMessage: directMessages.start,
    joinChannel: channelJoins.join,
    conversationProblem: (action, conversationId) =>
      action === "leave"
        ? channelLeaves.problem(conversationId)
        : scopes.problem("join"),
    leaveChannel: async (id) => {
      const result = await channelLeaves.leave(id);

      if (result.ok) {
        muted.setMuted(id, false);
      }

      return result;
    },
    isMuted: muted.isMuted,
    setMuted: muted.setMuted,
    sections: sections.shown,
    sectionsKeptByTermslack: sections.keptByTermslack,
    sectionsNote: sections.note,
    moveToSection: sections.moveToSection,
    removeFromSections: sections.removeFromSections,
    addSection: sections.addSection,
    channelDetails: createChannelDetails({
      client,
      resolveText: resolveMentions,
      resolveUser: async (id) => {
        await userResolver.resolve(id);
      },
    }),
    loadPublicChannels: publicChannels.load,
    publicChannelsStatus: publicChannels.status,
    modifyProblem: messageActions.modifyProblem,
    editDraft: messageActions.editDraft,
    editMessage: messageActions.editMessage,
    deleteMessage: messageActions.deleteMessage,
    reactionProblem: reactionActions.reactionProblem,
    hasReacted: reactionActions.hasReacted,
    addReaction: reactionActions.addReaction,
    removeReaction: reactionActions.removeReaction,

    loadHistory: (conversationId, { limit = defaultHistoryPageSize } = {}) =>
      loadPage(
        conversationId,
        conversationId,
        (cursor) =>
          fetchHistoryPage(client(), conversationId, { cursor, limit }),
        () => true,
        () => historyArrived(conversationId),
      ),

    async loadHistoryAround(conversationId, ts) {
      const isLoaded = () => {
        const messages = store.messages(conversationId);
        const before = messages.filter(
          (message) => compareTs(message.ts, ts) < 0,
        );

        return (
          messages.length > 0 &&
          compareTs(messages[0]!.ts, ts) <= 0 &&
          before.length >= aroundHistoryContext
        );
      };
      const pager = () => pagers.get(conversationId);

      if (pager() === undefined || !(isLoaded() || pager()!.exhausted)) {
        await loadPage(
          conversationId,
          conversationId,
          (cursor) =>
            fetchHistoryPage(client(), conversationId, {
              cursor,
              limit: aroundHistoryPageSize,
            }),
          () => true,
          () => historyArrived(conversationId),
        );
      }

      const message = store.message(conversationId, ts);
      const oldest = store.messages(conversationId)[0];
      const found = message !== undefined && !message.isDeleted;
      const hasMore = !pager()!.exhausted;

      return {
        found,
        hasMore,
        isFurtherBack:
          hasMore &&
          message === undefined &&
          oldest !== undefined &&
          compareTs(oldest.ts, ts) > 0,
      };
    },

    loadThreadReplies: (
      conversationId,
      threadTs,
      { limit = defaultRepliesPageSize } = {},
    ) =>
      loadPage(
        `${conversationId}:${threadTs}`,
        conversationId,
        (cursor) =>
          fetchRepliesPage(client(), conversationId, threadTs, {
            cursor,
            limit,
          }),
        (message) => message.ts !== threadTs,
      ),

    resolveConversationPeople,

    async findConversation(reference, { waitMs = defaultListingWaitMs } = {}) {
      await within(startupListing, waitMs);

      return findConversationByRef(reference, store);
    },

    get currentUserId() {
      return currentUser;
    },

    async start() {
      stopped = false;
      await muted.load();
      await sections.load();
      currentUserId = fetchIdentity(client())
        .then(({ userId, scopes: granted }) => {
          scopes.grant(granted);
          currentUser = userId;
          changes.changed();
          presence.reconsider();

          return userId;
        })
        .catch(() => undefined);

      socket = await connectSocket(
        appToken,
        {
          onEvent: (type, body) => enqueue(convertEnvelope(type, body)),
          onStatus: (next, error) => {
            status = next;
            changes.changed();
            publish({ kind: "connection", status: next, error });
          },
        },
        socketOptions,
      );

      void currentUserId.then(() => dnd.load());

      userGroupsLoading = loadUserGroups().catch(() => {
        // Without membership, group mentions just aren't counted as mentions.
      });

      listings.reset();

      const conversationsLoading = listings.load(
        "conversations",
        loadConversations,
      );

      const usersLoading = listings.load("people", loadUsers);

      void usersLoading.then(presence.reconsider);

      startupListing = Promise.all([conversationsLoading, usersLoading]);

      if (dmActivityOptions) {
        dmPass = updateDmActivity(dmActivityOptions, conversationsLoading, {
          dms,
          client,
          conversations: store.conversations,
          hasConversation: (id) => store.conversation(id) !== undefined,
          pause,
          isStopped: () => stopped,
        }).catch(() => {
          // Without activity the DMs just stay in the order the listing gives.
        });
      }

      if (unreadCheckOptions) {
        void unreadCheck.run(conversationsLoading, dmPass).catch(() => {
          // Without the check only messages arriving from now on mark conversations.
        });
      }

      void loadEmoji().catch(() => {
        // Custom emoji just show as :shortcode:, which is what they'd look like anyway.
      });
    },

    async stop() {
      stopped = true;

      dnd.stop();
      presence.stop();
      notifications.stop();
      wakeAll();
      await readMarks.flush();

      await socket?.disconnect();
      socket = undefined;
      await dms.flush();
      await muted.flush();
      await sections.flush();
    },
  };
}
