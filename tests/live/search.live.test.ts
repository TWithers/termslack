import { describe, expect, test } from "bun:test";
import { slackClient } from "../../src/slack/client";
import { fetchMessageSearchPage, searchPageSize } from "../../src/slack/search";

/**
 * Talks to real Slack as you. Skipped unless TERMSLACK_USER_TOKEN is set; `bun run
 * test:live` fills it in from your stored workspace. Asserts the response
 * shapes termslack relies on, never exact data. Reads only.
 */
const userToken = process.env.TERMSLACK_USER_TOKEN;

describe.skipIf(!userToken)("live Slack message search", () => {
  const client = () => slackClient(userToken);

  test("search.messages answers a plain query with the fields the results show and open", async () => {
    const response = await client().search.messages({
      query: "the",
      sort: "timestamp",
      sort_dir: "desc",
      count: searchPageSize,
      page: 1,
    });

    expect(response.ok).toBe(true);
    expect(response.messages?.total).toBeNumber();
    expect(response.messages?.paging?.page).toBeNumber();
    expect(response.messages?.paging?.pages).toBeNumber();
    expect(Array.isArray(response.messages?.matches)).toBe(true);
    expect(response.messages?.matches?.length).toBeLessThanOrEqual(
      searchPageSize,
    );

    let previous = Number.POSITIVE_INFINITY;

    for (const match of response.messages?.matches ?? []) {
      expect(match.ts).toBeString();
      expect(match.text).toBeString();
      expect(match.permalink).toBeString();
      expect(match.channel?.id).toBeString();
      expect(match.user ?? match.username).toBeDefined();

      const ts = Number.parseFloat(match.ts ?? "0");

      expect(ts).toBeLessThanOrEqual(previous);
      previous = ts;
    }
  });

  test("a reply in a thread carries its thread in the permalink or the match", async () => {
    const response = await client().search.messages({
      query: "is:thread",
      sort: "timestamp",
      sort_dir: "desc",
      count: searchPageSize,
      page: 1,
    });

    expect(response.ok).toBe(true);

    for (const match of response.messages?.matches ?? []) {
      expect(match.permalink).toBeString();
    }

    const page = await fetchMessageSearchPage(client(), "is:thread", 1);

    for (const result of page.results) {
      expect(result.message.channelId).toBeString();
      expect(result.message.ts).toBeString();
    }
  });

  test("a query Slack can't use is refused with an error code, not a throw of something else", async () => {
    const error = await client()
      .search.messages({ query: "", count: 1 })
      .then(
        () => undefined,
        (reason: { data?: { error?: string } }) => reason,
      );

    expect(error?.data?.error).toBeString();
  });
});
