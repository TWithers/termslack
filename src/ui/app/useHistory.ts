import { useCallback, useRef, useState } from "react";
import { errorMessage } from "../../session/failureText";
import type { WorkspaceSession } from "../../session/workspaceSession";

type Progress = { kind: "loading" } | { kind: "failed"; message: string };

/** The state of loading the page before the oldest one loaded so far. */
export type OlderStatus = { kind: "idle" } | Progress;

export type HistoryStatus =
  Progress | { kind: "loaded"; hasMore: boolean; older: OlderStatus };

/** How loading history around a message ended: whether it is there (or further back than was loaded), or why not. */
export type AroundOutcome =
  | { kind: "loaded"; found: boolean; isFurtherBack: boolean }
  | { kind: "failed"; error: unknown };

/**
 * Loads the newest page of a conversation's history the first time it's
 * asked for, and older pages when asked. Loaded conversations aren't loaded
 * again; a failed one is tried again the next time it's asked for. Older
 * pages are only requested while Slack says there are more, one at a time.
 * `loadAround` loads a page around a given message instead (see
 * `WorkspaceSession.loadHistoryAround`), which scrolling up then continues.
 */
export function useHistory(session: WorkspaceSession): {
  statusOf(conversationId: string): HistoryStatus | undefined;
  load(conversationId: string): void;
  loadOlder(conversationId: string): void;
  loadAround(conversationId: string, ts: string): Promise<AroundOutcome>;
} {
  const [statuses, setStatuses] = useState<Record<string, HistoryStatus>>({});
  const current = useRef(statuses);

  const set = useCallback((id: string, status: HistoryStatus) => {
    current.current = { ...current.current, [id]: status };
    setStatuses(current.current);
  }, []);

  const fetchPage = useCallback(
    (id: string, onFailure: (error: unknown) => HistoryStatus) => {
      session.loadHistory(id).then(
        (page) =>
          set(id, {
            kind: "loaded",
            hasMore: page.hasMore,
            older: { kind: "idle" },
          }),
        (error: unknown) => set(id, onFailure(error)),
      );
    },
    [session, set],
  );

  const load = useCallback(
    (id: string) => {
      const kind = current.current[id]?.kind;

      if (kind === "loading" || kind === "loaded") {
        return;
      }

      set(id, { kind: "loading" });

      fetchPage(id, (error) => ({
        kind: "failed",
        message: errorMessage(error),
      }));
    },
    [fetchPage],
  );

  const loadOlder = useCallback(
    (id: string) => {
      const status = current.current[id];

      if (
        status?.kind !== "loaded" ||
        !status.hasMore ||
        status.older.kind === "loading"
      ) {
        return;
      }

      set(id, { ...status, older: { kind: "loading" } });

      fetchPage(id, (error) => ({
        ...status,
        older: { kind: "failed", message: errorMessage(error) },
      }));
    },
    [fetchPage, set],
  );

  const loadAround = useCallback(
    async (id: string, ts: string): Promise<AroundOutcome> => {
      const before = current.current[id];
      const loaded = before?.kind === "loaded" ? before : undefined;

      set(
        id,
        loaded
          ? { ...loaded, older: { kind: "loading" } }
          : { kind: "loading" },
      );

      try {
        const { found, hasMore, isFurtherBack } =
          await session.loadHistoryAround(id, ts);

        set(id, { kind: "loaded", hasMore, older: { kind: "idle" } });

        return { kind: "loaded", found, isFurtherBack };
      } catch (error) {
        set(
          id,
          loaded
            ? {
                ...loaded,
                older: { kind: "failed", message: errorMessage(error) },
              }
            : { kind: "failed", message: errorMessage(error) },
        );

        return { kind: "failed", error };
      }
    },
    [session, set],
  );

  return { statusOf: (id) => statuses[id], load, loadOlder, loadAround };
}
