import type { WebClient } from "@slack/web-api";
import { fetchReadState } from "../slack/conversations";
import { fetchNewestMessage } from "../slack/history";
import { messageAttention } from "./attention";
import type { DmActivity } from "./dmActivity";
import { directConversationIds } from "./dmActivityPass";
import { isDirectMessage, type Conversation } from "./events";
import type { UnreadTracker } from "./unreadTracker";
import { compareTs } from "./workspaceStore";

export type UnreadCheckOptions = {
  /**
   * How many conversations are checked at once. Defaults to 3: enough to
   * finish a few dozen conversations in seconds, few enough that Slack's
   * rate limit (which the client waits out for every call) is rarely hit.
   */
  concurrency?: number;
  /**
   * How long to wait before trying a failed Slack call again (up to
   * `maxAttempts` tries in all). Defaults to 1000.
   */
  retryDelayMs?: number;
};

export type UnreadCheckProgress = { done: number; total: number };

export type UnreadCheck = {
  /**
   * Starts the check once the listing has loaded. Channels go first without
   * waiting for the DM activity pass; DMs follow it, since it settles their
   * order, which are hidden, and how recent their newest message is.
   */
  run(listing: Promise<unknown>, dmPass: Promise<unknown>): Promise<void>;
  /** How far the check is while it runs; undefined before it starts and once it is done. */
  progress(): UnreadCheckProgress | undefined;
};

/** What the check needs from the session. */
export type UnreadCheckContext = {
  client: () => WebClient;
  currentUserId: () => Promise<string | undefined>;
  conversations: () => Conversation[];
  conversation: (id: string) => Conversation | undefined;
  isInUserGroup: (id: string) => boolean;
  /** Muted channels are left out of the check. */
  isMuted: (id: string) => boolean;
  dms: DmActivity;
  unread: UnreadTracker;
  /** Notes a newest message found for a DM as activity. */
  observeDm: (conversationId: string, ts: string) => void;
  pause: (ms: number) => Promise<void>;
  isStopped: () => boolean;
  /** Tells views the progress changed. */
  changed: () => void;
};

/** How many of the most recent DMs are checked before the other DMs, matching the sidebar's default. */
const recentDmsFirst = 10;
const defaultConcurrency = 3;
const defaultRetryDelayMs = 1000;
const maxAttempts = 4;

type Retryable = { status: "found" | "gone" | "failed" };

/**
 * Finds the conversations that were already unread in Slack before startup.
 * `conversations.info` gives `last_read` for every kind of conversation, and
 * for a DM also how many messages are unread, which settles it in one call
 * and gives the exact count. Without a count the newest message is read and
 * compared with `last_read`; a DM's newest message is usually known from the
 * DM activity pass, so reading it is only needed when it is newer than `last_read`.
 *
 * A few conversations are checked at once through one Slack client. It waits
 * out a 429 (`Retry-After`) before failing a call, pausing its other calls
 * meanwhile (and retries it itself in normal use), so
 * rate limiting slows the check; a call that still fails is tried again a few
 * times, so a conversation is only skipped when Slack keeps refusing it.
 */
export function createUnreadCheck(
  context: UnreadCheckContext,
  {
    concurrency = defaultConcurrency,
    retryDelayMs = defaultRetryDelayMs,
  }: UnreadCheckOptions = {},
): UnreadCheck {
  const { dms, unread, isStopped } = context;
  const queue: string[] = [];
  let progress: UnreadCheckProgress | undefined;
  let dmsAreQueued = false;
  // One client for the whole check: its request queue pauses every call while one waits out a 429.
  let slack: WebClient;

  function update(change: Partial<UnreadCheckProgress>): void {
    progress = { done: 0, total: 0, ...progress, ...change };
    context.changed();
  }

  /** Runs a Slack call again after a pause while it fails; the last failure is returned. */
  async function withRetries<T extends Retryable>(
    call: () => Promise<T>,
  ): Promise<T> {
    let result = await call();

    for (
      let attempt = 1;
      result.status === "failed" && attempt < maxAttempts && !isStopped();
      attempt += 1
    ) {
      await context.pause(retryDelayMs);

      if (isStopped()) {
        break;
      }

      result = await call();
    }

    return result;
  }

  function channelIds(): string[] {
    return context
      .conversations()
      .filter(
        ({ kind, isMember, isArchived }) =>
          !isDirectMessage(kind) && isMember && !isArchived,
      )
      .filter(({ id }) => !context.isMuted(id))
      .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id))
      .map(({ id }) => id);
  }

  function directIds(): string[] {
    return directConversationIds(context.conversations(), dms).filter(
      (id) => !dms.isHidden(id),
    );
  }

  async function checkOne(id: string, me: string): Promise<void> {
    if (unread.wasOpened(id) || unread.markers(id).isUnread) {
      return;
    }

    const state = await withRetries(() => fetchReadState(slack, id));

    if (state.status !== "found" || state.lastRead === undefined) {
      return;
    }

    const kind = context.conversation(id)?.kind;

    if (isDirectMessage(kind) && state.unreadCount !== undefined) {
      if (state.unreadCount > 0) {
        unread.recordExisting(id, "mention", state.unreadCount);
      }

      return;
    }

    const knownTs = dms.latestTs(id);

    if (knownTs !== undefined && compareTs(knownTs, state.lastRead) <= 0) {
      return;
    }

    const newest = await withRetries(() => fetchNewestMessage(slack, id));

    if (newest.status !== "found" || !newest.message) {
      return;
    }

    const { message } = newest;

    context.observeDm(id, message.ts);

    if (compareTs(message.ts, state.lastRead) <= 0) {
      return;
    }

    const attention = messageAttention(message, {
      currentUserId: me,
      conversationKind: kind,
      isInUserGroup: context.isInUserGroup,
    });

    // Mentions in channels would take a scan of the unread messages, so channels only show unread.
    unread.recordExisting(
      id,
      attention === "mention" && !isDirectMessage(kind) ? "unread" : attention,
    );
  }

  /**
   * A worker takes the next conversation until the queue is empty and the DMs
   * have been added, or the session stops.
   */
  async function work(me: string, dmsQueued: Promise<void>): Promise<void> {
    while (!isStopped()) {
      const id = queue.shift();

      if (id === undefined) {
        if (dmsAreQueued) {
          return;
        }

        await dmsQueued;

        continue;
      }

      try {
        await checkOne(id, me);
      } finally {
        update({ done: (progress?.done ?? 0) + 1 });
      }
    }
  }

  return {
    progress: () => progress,

    async run(listing, dmPass) {
      await listing;

      const me = await context.currentUserId();

      if (isStopped() || me === undefined) {
        return;
      }

      slack = context.client();

      const channels = channelIds();

      queue.push(...channels);
      update({ done: 0, total: channels.length });

      // The DMs join the front of the queue once the pass has settled their order.
      const dmsQueued = dmPass
        .catch(() => undefined)
        .then(() => {
          const directs = directIds();

          queue.unshift(...directs.slice(0, recentDmsFirst));
          queue.push(...directs.slice(recentDmsFirst));
          dmsAreQueued = true;
          update({ total: (progress?.total ?? 0) + directs.length });
        });

      try {
        await Promise.all(
          Array.from({ length: concurrency }, () => work(me, dmsQueued)),
        );
      } finally {
        progress = undefined;
        context.changed();
      }
    },
  };
}
