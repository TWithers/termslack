import { theme } from "../theme";
import { useMemo, useRef, useState } from "react";
import { type Composer, useComposer } from "../input/useComposer";
import { draftKey, type useDrafts } from "../input/useDrafts";
import { errorMessage } from "../../session/failureText";
import type { WorkspaceSession } from "../../session/workspaceSession";
import { type PaneWidths, paneContentWidth, paneWidths } from "./paneLayout";
import { type PaneRow, threadRows, type ThreadStatus } from "./paneRows";
import { type PaneSelection, usePaneSelection } from "./usePaneSelection";

/** A reply to select once the thread has loaded; `onMissing` runs if the thread has no such reply after all. */
export type ReplyToSelect = { ts: string; onMissing(): void };

export type ThreadPane = {
  /** How the space beside the sidebar is shared between the message pane and this one. */
  widths: PaneWidths;
  /** The thread's parent `ts`, while a thread is open. */
  threadTs?: string;
  /** The conversation the open thread belongs to. */
  conversationId?: string;
  rows: PaneRow[];
  /** The pane's own selection, the same shape as the message pane's. `selection.selectedTs` is the thread's selected message. */
  selection: PaneSelection;
  /** The reply input under the thread: its draft is kept per thread. */
  composer: Composer;
  /** Whether the next reply is also sent to the channel; it resets after each send and whenever a thread opens or closes. */
  alsoToChannel: boolean;
  setAlsoToChannel(on: boolean): void;
  /**
   * Opens the thread and loads its replies (all pages, oldest first). With
   * `load: false` (a message with no replies) nothing is fetched: the pane
   * shows the parent alone, ready for a first reply.
   */
  open(
    conversationId: string,
    threadTs: string,
    options?: { load?: boolean; select?: ReplyToSelect },
  ): void;
  close(): void;
};

/**
 * The thread pane's state: which thread is open, its rows and its selection.
 *
 * Slack pages a thread's replies oldest first and the session's cursor only
 * moves forward, so there are no "older" replies to load on scroll. Instead
 * opening a thread loads every page in turn (a normal thread is one page of
 * 100) and the pane fills as they arrive. Live replies come through the
 * session like any change. A failed load keeps what arrived and says why;
 * opening the thread again continues from where it stopped.
 */
export function useThreadPane({
  session,
  version,
  areaWidth,
  height,
  now,
  today,
  drafts,
  inputFocused,
  editPlace,
}: {
  session: WorkspaceSession;
  /** The session's change counter, so rows follow whatever the session holds. */
  version: number;
  /** The width of the area beside the sidebar. */
  areaWidth: number;
  /** Rows the pane's list and input share: the pane inside its border. */
  height: number;
  now: () => Date;
  /** The day key of `now`, so day labels refresh at midnight. */
  today: string;
  drafts: ReturnType<typeof useDrafts>;
  /** Whether the thread's input has the focus (so its completion list takes room). */
  inputFocused: boolean;
  /** While one of the thread's messages is being edited: the draft the input shows in place of the reply. */
  editPlace?: string;
}): ThreadPane {
  const [target, setTarget] = useState<{
    conversationId: string;
    threadTs: string;
  }>();
  const [status, setStatus] = useState<ThreadStatus>({ kind: "loading" });
  const [alsoToChannel, setAlsoToChannel] = useState(false);
  const generation = useRef(0);
  const widths = paneWidths(areaWidth, target !== undefined);
  const width = Math.max(1, paneContentWidth(widths.thread));

  const rows = useMemo(
    () =>
      target === undefined
        ? []
        : threadRows(
            session,
            target.conversationId,
            target.threadTs,
            width,
            status,
            now(),
          ).rows,
    // The session's version changes whenever anything it holds does; the rows carry the theme's colours.
    [session, version, target, width, status, today, theme],
  );
  const composer = useComposer({
    drafts,
    place:
      target && (editPlace ?? draftKey(target.conversationId, target.threadTs)),
    session,
    width,
    availableHeight: height,
    focused: inputFocused && target !== undefined,
    noticeLines: alsoToChannel && editPlace === undefined ? 1 : 0,
  });
  const selection = usePaneSelection({
    rows,
    height: Math.max(0, height - composer.height),
    onReachTop: () => {},
  });

  async function loadAll(
    conversationId: string,
    threadTs: string,
    loadGeneration: number,
    select?: ReplyToSelect,
  ) {
    try {
      let hasMore = true;

      while (hasMore && generation.current === loadGeneration) {
        hasMore = (await session.loadThreadReplies(conversationId, threadTs))
          .hasMore;
      }

      if (generation.current === loadGeneration) {
        setStatus({ kind: "loaded" });
      }
    } catch (error) {
      if (generation.current === loadGeneration) {
        setStatus({ kind: "failed", message: errorMessage(error) });
      }
    }

    const reply = select && session.message(conversationId, select.ts);

    if (
      select &&
      generation.current === loadGeneration &&
      (!reply || reply.isDeleted)
    ) {
      selection.cancelFocus();
      select.onMissing();
    }
  }

  return {
    widths,
    threadTs: target?.threadTs,
    conversationId: target?.conversationId,
    rows,
    selection,
    composer,
    alsoToChannel,
    setAlsoToChannel,
    open(conversationId, threadTs, { load = true, select } = {}) {
      const loadGeneration = ++generation.current;

      selection.reset();
      setAlsoToChannel(false);
      setTarget({ conversationId, threadTs });

      if (select) {
        selection.focusOn(select.ts);
      }

      if (!load) {
        setStatus({ kind: "loaded" });
        return;
      }

      setStatus({ kind: "loading" });
      void loadAll(conversationId, threadTs, loadGeneration, select);
    },
    close() {
      generation.current++;
      setAlsoToChannel(false);
      selection.reset();
      setTarget(undefined);
    },
  };
}
