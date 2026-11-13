import type { WebClient } from "@slack/web-api";
import { fetchMessageSearchPage } from "../slack/search";
import type { SearchResult } from "../slack/convert";
import type { ChangeTracker } from "./changeTracker";
import { describeFailure } from "./failureText";

export type { SearchResult };

/** Where the user's message search stands. */
export type SearchState = {
  /** The query last run (trimmed), or "" before any. It stays after the search so it can be offered again. */
  query: string;
  /** `idle` before any search; `searching` while the first page loads; `failed` when it was refused (`failure` says why). */
  status: "idle" | "searching" | "loaded" | "failed";
  /** Newest first, every page so far. */
  results: SearchResult[];
  /** How many messages match in all, when Slack said. */
  total?: number;
  /** Whether another page follows the loaded ones. */
  hasMore: boolean;
  loadingMore: boolean;
  /** Why the search, or loading its next page, failed, in words for the UI. */
  failure?: string;
};

export type MessageSearch = {
  /** Runs a search (see `WorkspaceSession.search`). */
  search(query: string): Promise<void>;
  /** Loads the next page of the current search (see `WorkspaceSession.searchMore`). */
  more(): Promise<void>;
  state(): SearchState;
};

const searchFailures: Record<string, string> = {
  invalid_query: "Slack didn't understand that search.",
  missing_query: "Type something to search for.",
  not_allowed_token_type: "Slack doesn't let this kind of token search.",
};

/** Why a search was refused, in words for the overlay. */
export function describeSearchFailure(error: unknown): string {
  return describeFailure(error, {
    failures: searchFailures,
    missingScope:
      "To search termslack needs the search:read permission. Run termslack's setup again to grant it.",
    refused: "Slack refused the search",
    couldnt: "Couldn't search",
  });
}

const idle: SearchState = {
  query: "",
  status: "idle",
  results: [],
  hasMore: false,
  loadingMore: false,
};

const resultKey = ({ message }: SearchResult) =>
  `${message.channelId}:${message.ts}`;

/**
 * Searching messages with Slack's `search.messages`, one search at a time:
 * starting a search drops whatever an earlier one is still waiting for, so a
 * slow answer can never replace a newer search's results. A page is shown
 * once the names it mentions are resolved (or `resolve` gives up).
 */
export function createMessageSearch({
  client,
  searchProblem,
  changes,
  resolve,
}: {
  client: () => WebClient;
  /** Why searching is off (the token lacks `search:read`), or undefined. */
  searchProblem: () => string | undefined;
  changes: Pick<ChangeTracker, "changed">;
  /** Looks up the names a page of results shows; settles when that is done or given up on. */
  resolve: (results: SearchResult[]) => Promise<void>;
}): MessageSearch {
  let state = idle;
  let generation = 0;
  let page = 0;

  function set(next: SearchState): void {
    state = next;
    changes.changed();
  }

  return {
    state: () => state,

    async search(rawQuery) {
      const query = rawQuery.trim();

      if (query === "") {
        return;
      }

      const mine = ++generation;
      const problem = searchProblem();

      if (problem) {
        set({ ...idle, query, status: "failed", failure: problem });
        return;
      }

      set({ ...idle, query, status: "searching" });

      try {
        const found = await fetchMessageSearchPage(client(), query, 1);

        await resolve(found.results);

        if (mine !== generation) {
          return;
        }

        page = 1;
        set({
          ...idle,
          query,
          status: "loaded",
          results: found.results,
          total: found.total,
          hasMore: found.hasMore,
        });
      } catch (error) {
        if (mine === generation) {
          set({
            ...idle,
            query,
            status: "failed",
            failure: describeSearchFailure(error),
          });
        }
      }
    },

    async more() {
      if (state.status !== "loaded" || !state.hasMore || state.loadingMore) {
        return;
      }

      const mine = generation;

      set({ ...state, loadingMore: true, failure: undefined });

      try {
        const found = await fetchMessageSearchPage(
          client(),
          state.query,
          page + 1,
        );

        await resolve(found.results);

        if (mine !== generation) {
          return;
        }

        page += 1;

        const known = new Set(state.results.map(resultKey));

        set({
          ...state,
          results: [
            ...state.results,
            ...found.results.filter((result) => !known.has(resultKey(result))),
          ],
          total: found.total ?? state.total,
          hasMore: found.hasMore,
          loadingMore: false,
        });
      } catch (error) {
        if (mine === generation) {
          set({
            ...state,
            loadingMore: false,
            failure: describeSearchFailure(error),
          });
        }
      }
    },
  };
}
