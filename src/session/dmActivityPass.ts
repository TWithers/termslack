import type { WebClient } from "@slack/web-api";
import type { DmActivityCache } from "../config/state";
import { fetchNewestMessage } from "../slack/history";
import { fetchDmMessagesPage } from "../slack/search";
import type { DmActivity } from "./dmActivity";
import { isDirectMessage, type Conversation } from "./events";

export type DmActivityOptions = {
  /** Where DM activity is kept between runs. Without it nothing is remembered (the pass runs every start). */
  cache?: DmActivityCache;
  /**
   * How long to wait between the Slack calls of the background pass, to stay
   * within `conversations.history`'s rate limit. Defaults to 1300.
   */
  passDelayMs?: number;
  /** The current time, for the day the pass last ran. Defaults to the real clock. */
  now?: () => Date;
};

export const defaultPassDelayMs = 1300;
const maxCatchUpPages = 20;

function dayText(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The day before a `YYYY-MM-DD` day (search's `after:` is day-granular, so the pass starts a day early). */
function dayBefore(day: string): string {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);

  return dayText(new Date(year, month - 1, date - 1));
}

/** The DMs and group DMs the user is in, newest activity first. */
export function directConversationIds(
  conversations: Conversation[],
  dms: DmActivity,
): string[] {
  return conversations
    .filter(
      ({ kind, isMember, isArchived }) =>
        isDirectMessage(kind) && isMember && !isArchived,
    )
    .map(({ id }) => id)
    .sort((a, b) => (dms.activity(b) ?? 0) - (dms.activity(a) ?? 0));
}

/** What the pass needs from the session. */
export type DmActivityPassContext = {
  dms: DmActivity;
  client: () => WebClient;
  conversations: () => Conversation[];
  hasConversation: (id: string) => boolean;
  pause: (ms: number) => Promise<void>;
  isStopped: () => boolean;
};

/**
 * Finds the DMs with messages since `lastRun` using search, so only the
 * ones that changed need updating. Resolves false if search can't be used.
 */
async function catchUpBySearch(
  lastRun: string,
  delayMs: number,
  { dms, client, hasConversation, pause, isStopped }: DmActivityPassContext,
): Promise<boolean> {
  for (let page = 1; page <= maxCatchUpPages; page += 1) {
    let result;

    try {
      result = await fetchDmMessagesPage(client(), dayBefore(lastRun), page);
    } catch {
      return false;
    }

    for (const { channelId, ts } of result.matches) {
      if (hasConversation(channelId)) {
        dms.observe(channelId, ts);
      }
    }

    if (!result.hasMore || isStopped()) {
      return true;
    }

    await pause(delayMs);
  }

  return true;
}

/** Asks for the newest message of each DM in turn, a pause apart. */
async function checkNewestMessages(
  ids: string[],
  delayMs: number,
  { dms, client, pause, isStopped }: DmActivityPassContext,
): Promise<void> {
  for (const [index, id] of ids.entries()) {
    if (isStopped()) {
      return;
    }

    if (index > 0) {
      await pause(delayMs);
    }

    if (isStopped()) {
      return;
    }

    const newest = await fetchNewestMessage(client(), id);

    if (newest.status === "gone") {
      dms.hide(id);
    }

    if (newest.status === "found" && newest.ts !== undefined) {
      dms.observe(id, newest.ts);
    }
  }
}

/**
 * Brings DM activity up to date once the conversations are listed: search
 * for what changed since the last run, or (first run, or when search isn't
 * available) ask each DM in turn for its newest message.
 */
export async function updateDmActivity(
  options: DmActivityOptions,
  listing: Promise<unknown>,
  context: DmActivityPassContext,
): Promise<void> {
  const { cache, passDelayMs = defaultPassDelayMs, now } = options;
  const { dms, isStopped } = context;

  await cache?.load().then(dms.restore, () => undefined);
  await listing;

  if (isStopped()) {
    return;
  }

  const today = dayText((now ?? (() => new Date()))());
  const lastRun = dms.lastRun();
  const caughtUp =
    lastRun !== undefined &&
    (await catchUpBySearch(lastRun, passDelayMs, context));

  if (isStopped()) {
    return;
  }

  if (lastRun === undefined || caughtUp) {
    dms.setLastRun(today);
  }

  const missing = directConversationIds(context.conversations(), dms).filter(
    (id) => !dms.isHidden(id) && (!caughtUp || dms.latestTs(id) === undefined),
  );

  await checkNewestMessages(missing, passDelayMs, context);

  if (!isStopped() && lastRun !== undefined && !caughtUp) {
    dms.setLastRun(today);
  }
}
