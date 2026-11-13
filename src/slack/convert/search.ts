import type { Message } from "../../session/events";
import { convertHistoryMessage } from "./history";
import { isObject, optionalString } from "./shared";

/** One page of `search.messages` results for direct messages. */
export type DmSearchPage = {
  /** The newest-first matches that are in a DM or group DM. */
  matches: { channelId: string; ts: string }[];
  /** True when another page follows. */
  hasMore: boolean;
};

/** Reads one page of `search.messages`, keeping only matches in DMs and group DMs. */
export function convertDmSearchPage(
  response: Record<string, any>,
): DmSearchPage {
  const entries = Array.isArray(response.messages?.matches)
    ? response.messages.matches
    : [];
  const matches: DmSearchPage["matches"] = [];

  for (const entry of entries) {
    if (!isObject(entry) || !isObject(entry.channel)) {
      continue;
    }

    const { channel } = entry;

    if (
      typeof channel.id !== "string" ||
      channel.id === "" ||
      typeof entry.ts !== "string" ||
      entry.ts === "" ||
      !(channel.is_im === true || channel.is_mpim === true)
    ) {
      continue;
    }

    matches.push({ channelId: channel.id, ts: entry.ts });
  }

  const paging = response.messages?.paging;
  const page = Number(paging?.page);
  const pages = Number(paging?.pages);

  return {
    matches,
    hasMore: Number.isFinite(page) && Number.isFinite(pages) && page < pages,
  };
}

/** One message `search.messages` found, with what is needed to show it and to open it where it was posted. */
export type SearchResult = {
  /** The message; `threadTs` is set when it is a reply in a thread (also read from the permalink). */
  message: Message;
  permalink?: string;
  /** What Slack called the conversation, for when termslack doesn't know it yet. A DM's is the other person's ID, so only channels carry it. */
  channelName?: string;
};

/** One page of `search.messages` results. */
export type MessageSearchPage = {
  /** Newest first, as Slack sent them. Matches without a channel or a `ts` are skipped. */
  results: SearchResult[];
  /** How many messages match in all, when Slack said. */
  total?: number;
  /** True when another page follows. */
  hasMore: boolean;
};

function threadTsOfPermalink(
  permalink: string | undefined,
): string | undefined {
  if (permalink === undefined) {
    return undefined;
  }

  try {
    return optionalString(new URL(permalink).searchParams.get("thread_ts"));
  } catch {
    return undefined;
  }
}

/** Reads one page of `search.messages`, whatever the conversation. */
export function convertMessageSearchPage(
  response: Record<string, any>,
): MessageSearchPage {
  const entries = Array.isArray(response.messages?.matches)
    ? response.messages.matches
    : [];
  const results: SearchResult[] = [];

  for (const entry of entries) {
    const channelId = isObject(entry.channel)
      ? optionalString(entry.channel.id)
      : undefined;
    const message =
      channelId === undefined
        ? undefined
        : convertHistoryMessage(channelId, entry);

    if (channelId === undefined || message === undefined) {
      continue;
    }

    const permalink = optionalString(entry.permalink);
    const isChannel = !entry.channel.is_im && !entry.channel.is_mpim;

    results.push({
      message: {
        ...message,
        threadTs: message.threadTs ?? threadTsOfPermalink(permalink),
      },
      permalink,
      channelName: isChannel ? optionalString(entry.channel.name) : undefined,
    });
  }

  const paging = response.messages?.paging;
  const page = Number(paging?.page);
  const pages = Number(paging?.pages);
  const total = Number(response.messages?.total ?? paging?.total);

  return {
    results,
    total: Number.isFinite(total) ? total : undefined,
    hasMore: Number.isFinite(page) && Number.isFinite(pages) && page < pages,
  };
}
