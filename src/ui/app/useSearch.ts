import { useEffect, useState } from "react";
import { inputOf } from "../input/textInput";
import type {
  SearchResult,
  WorkspaceSession,
} from "../../session/workspaceSession";
import { overlayChrome, type OverlayMessage } from "./Overlay";
import { theme } from "../theme";
import { pressed, type KeyPress } from "./shortcuts";
import { searchItem, searchResultHeight } from "./SearchResults";
import { handleFilteredListKey, useListView } from "./useListView";

function matchesText(count: number | undefined): string {
  return count === 1 ? "1 match" : `${count} matches`;
}

/**
 * The message search `/` opens: a query line over Slack's results, newest
 * first. Enter on a query that is new (or whose search failed) runs it;
 * the arrows (and Ctrl+N/Ctrl+P) move the highlight, and reaching the last
 * result loads the next page. Enter on a query that has been run closes the
 * search and calls `choose` with the highlighted result. The session keeps
 * the query and the results, and the highlight stays where it was, so
 * reopening starts with them. `height` is the rows the overlay may take and
 * `width` the columns inside it.
 */
export function useSearch({
  session,
  height,
  width,
  choose,
}: {
  session: WorkspaceSession;
  height: number;
  width: number;
  choose(result: SearchResult): void;
}) {
  const [isOpen, setOpen] = useState(false);
  const [filter, setFilter] = useState(() =>
    inputOf(session.searchState().query),
  );
  const state = session.searchState();
  const view = useListView({
    count: state.results.length,
    height: Math.floor((height - overlayChrome(true)) / searchResultHeight),
    selectable: true,
  });
  const atEnd = view.selected >= state.results.length - 1;

  useEffect(() => {
    if (isOpen && atEnd) {
      void session.searchMore();
    }
  }, [session, isOpen, atEnd, state.results.length, state.hasMore]);

  const title = [
    "Search messages",
    state.status === "searching" ? "searching…" : undefined,
    state.status === "loaded"
      ? matchesText(state.total ?? state.results.length)
      : undefined,
    state.status === "loaded" && !state.hasMore && state.results.length > 0
      ? "end of results"
      : undefined,
    state.loadingMore ? "loading more…" : undefined,
    state.status === "loaded" && state.failure
      ? `couldn't load more: ${state.failure}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  const message = ((): OverlayMessage => {
    switch (state.status) {
      case "idle":
        return {
          text: 'Type a query and press Enter. Slack\'s syntax works: from:@name, in:#channel, "exact phrase".',
        };
      case "searching":
        return { text: "Searching…" };
      case "failed":
        return {
          text: state.failure ?? "The search failed.",
          color: theme.error,
        };
      case "loaded":
        return { text: `No messages match "${state.query}".` };
    }
  })();

  return {
    isOpen,
    title,
    filter,
    message,
    start: view.start,
    selected: view.selected,
    items: state.results.map((result) => searchItem(result, session, width)),
    open() {
      setFilter(inputOf(session.searchState().query));
      setOpen(true);
    },
    /** Closes the search, keeping its query and results for the next `open`. */
    close() {
      setOpen(false);
    },
    /** Opens the result at `index`, which becomes the highlighted one, as Enter does on a search that has been run. */
    chooseAt(index: number) {
      const result = state.results[index];

      if (!result) {
        return;
      }

      view.move(index - view.selected);
      setOpen(false);
      choose(result);
    },
    /** Moves the highlight (or scrolls the help) `delta` rows, as the arrows do. */
    scroll: view.move,
    /** Handles a key while the search is open. */
    onKey(input: string, key: KeyPress) {
      if (pressed("overlay.close", input, key)) {
        setOpen(false);
        return;
      }

      const runs =
        filter.text.trim() !== state.query || state.status === "failed";

      if (runs && pressed("search.run", input, key)) {
        view.reset();
        void session.search(filter.text);
        return;
      }

      if (!runs && pressed("search.open", input, key)) {
        const result = state.results[view.selected];

        if (result) {
          setOpen(false);
          choose(result);
        }

        return;
      }

      const edited = handleFilteredListKey(view, filter, input, key, {
        next: "search.next",
        previous: "search.previous",
      });

      if (edited) {
        setFilter(edited);
      }
    },
  };
}

export type Search = ReturnType<typeof useSearch>;
