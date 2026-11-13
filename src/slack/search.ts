import type { WebClient } from "@slack/web-api";
import {
  convertDmSearchPage,
  convertMessageSearchPage,
  type DmSearchPage,
  type MessageSearchPage,
} from "./convert";

/**
 * One page (100 matches) of the DM and group DM messages posted after the
 * given day (`YYYY-MM-DD`; Slack's `after:` is day-granular), newest first.
 * Rejects with Slack's error.
 */
export async function fetchDmMessagesPage(
  client: WebClient,
  afterDay: string,
  page: number,
): Promise<DmSearchPage> {
  return convertDmSearchPage(
    await client.search.messages({
      query: `is:dm after:${afterDay}`,
      sort: "timestamp",
      sort_dir: "desc",
      count: 100,
      page,
    }),
  );
}

/** Messages per page of a message search. */
export const searchPageSize = 20;

/**
 * One page of messages matching `query` (Slack's search syntax), newest
 * first. Rejects with Slack's error (`invalid_query`, `missing_scope`, ...).
 */
export async function fetchMessageSearchPage(
  client: WebClient,
  query: string,
  page: number,
): Promise<MessageSearchPage> {
  return convertMessageSearchPage(
    await client.search.messages({
      query,
      sort: "timestamp",
      sort_dir: "desc",
      count: searchPageSize,
      page,
    }),
  );
}
