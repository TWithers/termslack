import { useEffect, useRef, useState } from "react";
import { emptyInput } from "../input/textInput";
import type { WorkspaceSession } from "../../session/workspaceSession";
import { overlayChrome } from "./Overlay";
import { pressed, type KeyPress } from "./shortcuts";
import { needsPeople } from "./sidebarEntries";
import { switcherCandidates } from "./switcherCandidates";
import { rankCandidates, type SwitcherCandidate } from "./switcherRanking";
import { switcherItem } from "./Switcher";
import { handleFilteredListKey, useListView } from "./useListView";

/**
 * The quick switcher Ctrl+K opens: a filter line over the conversations the
 * user is in, ranked by `rankCandidates`. The filter line is edited like any
 * input; the arrows (and Ctrl+N/Ctrl+P) move the highlight and Enter calls
 * `choose` with the highlighted result: a conversation, a public channel to
 * join, or a person to start a DM with. The first time it opens in a session
 * it starts listing the public channels. `height` is the rows the
 * overlay may take. It remembers the conversations opened, newest first,
 * for ranking (`opened`).
 */
export function useSwitcher({
  session,
  height,
  choose,
}: {
  session: WorkspaceSession;
  height: number;
  choose(candidate: SwitcherCandidate): void;
}) {
  const [isOpen, setOpen] = useState(false);
  const [filter, setFilter] = useState(emptyInput);
  const recent = useRef<string[]>([]);
  const results = isOpen
    ? rankCandidates(switcherCandidates(session), filter.text, recent.current)
    : [];
  const view = useListView({
    count: results.length,
    height: height - overlayChrome(true),
    selectable: true,
  });
  const unresolvedIds = results
    .slice(view.start, view.start + Math.max(1, height))
    .filter(({ id }) => {
      const conversation = session.conversation(id);

      return conversation !== undefined && needsPeople(conversation, session);
    })
    .map(({ id }) => id)
    .join(",");

  useEffect(() => {
    for (const id of unresolvedIds.split(",").filter(Boolean)) {
      void session.resolveConversationPeople(id);
    }
  }, [session, unresolvedIds]);

  const loading = [
    session.listingHealth().people === "loading"
      ? "still loading people…"
      : undefined,
    session.publicChannelsStatus() === "loading"
      ? "still loading channels…"
      : undefined,
    session.publicChannelsStatus() === "failed"
      ? "couldn't list channels you're not in"
      : undefined,
  ].filter(Boolean);

  function chooseAt(index: number) {
    const chosen = results[index];

    setOpen(false);

    if (chosen) {
      choose(chosen);
    }
  }

  return {
    isOpen,
    title: ["Switch conversation", ...loading].join(" · "),
    filter,
    start: view.start,
    selected: view.selected,
    items: results.map((candidate, index) =>
      switcherItem(candidate, index === view.selected),
    ),
    open() {
      setFilter(emptyInput);
      view.reset();
      setOpen(true);
      void session.loadPublicChannels();
    },
    /** Remembers that the user opened this conversation, for ranking. */
    opened(conversationId: string) {
      recent.current = [
        conversationId,
        ...recent.current.filter((id) => id !== conversationId),
      ];
    },
    /** Closes the switcher without choosing anything. */
    close() {
      setOpen(false);
    },
    /** Chooses the result at `index`, as Enter does with the highlighted one. */
    chooseAt,
    /** Moves the highlight (or scrolls the help) `delta` rows, as the arrows do. */
    scroll: view.move,
    /** Handles a key while the switcher is open. */
    onKey(input: string, key: KeyPress) {
      if (
        pressed("overlay.close", input, key) ||
        pressed("global.switcher", input, key)
      ) {
        setOpen(false);
        return;
      }

      if (pressed("switcher.choose", input, key)) {
        chooseAt(view.selected);
        return;
      }

      const edited = handleFilteredListKey(view, filter, input, key, {
        next: "switcher.next",
        previous: "switcher.previous",
      });

      if (!edited) {
        return;
      }

      if (edited.text !== filter.text) {
        view.reset();
      }

      setFilter(edited);
    },
  };
}

export type Switcher = ReturnType<typeof useSwitcher>;
