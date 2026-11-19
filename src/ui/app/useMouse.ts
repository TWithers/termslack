import type { SpanAction } from "../../session/content";
import { isChannel } from "../../session/events";
import { useEffect, useRef, useState } from "react";
import { inputOf } from "../input/textInput";
import type { Composer } from "../input/useComposer";
import type { useDrafts } from "../input/useDrafts";
import { buttonAt, type HoveredButton } from "./buttons";
import type { Focus, InputPane } from "./focus";
import { type Hit, hitTest, type MouseLayout } from "./hitTest";
import {
  borderSize,
  paneInnerHeight,
  panePadding,
  sidebarListHeight,
} from "./paneLayout";
import type { PaneRow } from "./paneRows";
import type { MouseInput, MouseSource } from "./mouse";
import { visibleRowAt } from "./selection";
import { lineKey, sidebarLineAt, type SidebarLine } from "./sidebarEntries";
import type { ChannelRef } from "./useConfirmPrompt";
import type { PaneSelection } from "./usePaneSelection";
import type { usePopups } from "./usePopups";

type ListPane = "messages" | "thread";

/** A list pane's interactive element label under the mouse pointer. */
export type PaneHoveredButton = HoveredButton & { pane: ListPane };

const sameHover = (
  a: PaneHoveredButton | undefined,
  b: PaneHoveredButton | undefined,
) => a?.pane === b?.pane && a?.key === b?.key && a?.start === b?.start;

/**
 * What the mouse does, from the terminal's reports (`source`) to the app's
 * state. `layout` says what is where; `sidebar`, `panes`, `popups` and
 * `question` give the hook what it moves and the actions it calls.
 *
 * Returns the sidebar line and the message pane label to draw hovered, if
 * there are any.
 */
export function useMouse({
  source,
  layout,
  sidebar,
  panes,
  popups,
  inputs,
  questionPending,
  cancelQuestion,
  requestFocus,
  openConversation,
  openThreadOf,
  pressButton,
}: {
  source: MouseSource | undefined;
  layout: MouseLayout;
  /** The sidebar's lines, where they are scrolled to, its selection and what a click on a row does. */
  sidebar: {
    lines: SidebarLine[];
    scrollStart: number;
    select(id: string | undefined): void;
    /** Opens the channel menu for a channel, beside screen row `row`. */
    openChannelMenu(channel: ChannelRef, row: number): void;
    moveBy(delta: number): void;
    openId: string | undefined;
    setSectionCollapsed(id: string, collapsed: boolean): void;
  };
  panes: { messages: PaneSelection; thread: PaneSelection };
  popups: Pick<ReturnType<typeof usePopups>, "wheel" | "clickRow" | "dismiss">;
  /** The input boxes and the drafts they show. */
  inputs: {
    input: Composer;
    threadInput: Composer;
    drafts: ReturnType<typeof useDrafts>;
  };
  /** Whether a y/n question is showing, and how to cancel it. */
  questionPending: boolean;
  cancelQuestion(): void;
  requestFocus(focus: Focus): void;
  openConversation(id: string, options: { remember: boolean }): void;
  openThreadOf(ts: string): void;
  /** Does what an interactive element's label in a message (`[View task]`) does when clicked. */
  pressButton(action: SpanAction): void;
}): {
  hoveredLine: SidebarLine | undefined;
  hoveredButton: PaneHoveredButton | undefined;
} {
  /** The sidebar's row (counted inside its border) under the mouse pointer, if one with something on it is. */
  const [hoveredRow, setHoveredRow] = useState<number>();
  const [hoveredButton, setHoveredButton] = useState<PaneHoveredButton>();
  const pendingWheel = useRef<
    { column: number; row: number; delta: number } | undefined
  >(undefined);
  const handleMouseRef = useRef<(input: MouseInput) => void>(() => {});
  const wheelAtRef = useRef<
    (column: number, row: number, delta: number) => void
  >(() => {});
  const popupOpen = layout.popup !== undefined;

  /** Moves focus to an input and puts its cursor at the end of the draft, as when `i` is pressed to carry on writing. */
  function focusInputAtEnd(pane: InputPane) {
    const { place, draft } =
      pane === "input" ? inputs.input : inputs.threadInput;

    if (place !== undefined && draft.cursor !== draft.text.length) {
      inputs.drafts.set(place, inputOf(draft.text));
    }

    requestFocus(pane);
  }

  /**
   * A click on the sidebar: focuses it and selects the row under the pointer.
   * A heading collapses or expands, an entry opens (unless it is already
   * open), as Enter would. A row with nothing on it only focuses.
   */
  function clickSidebar(row: number) {
    requestFocus("sidebar");

    const line = sidebarLineAt(
      sidebar.lines,
      sidebar.scrollStart,
      sidebarListHeight(layout.bodyHeight),
      row,
    );

    if (line === undefined) {
      return;
    }

    sidebar.select(lineKey(line));

    if (line.kind === "heading") {
      sidebar.setSectionCollapsed(line.id, !line.collapsed);
      return;
    }

    const { id } = line.entry.conversation;

    if (id !== sidebar.openId) {
      openConversation(id, { remember: true });
    }
  }

  /**
   * A right-click on a channel's sidebar entry: focuses the sidebar, selects
   * the entry (without opening the conversation) and opens its channel menu.
   * Anywhere else, on a DM or a heading, with a popup open or a y/n question
   * showing, it does nothing.
   */
  function rightClick(column: number, row: number) {
    if (questionPending || popupOpen) {
      return;
    }

    const hit = hitTest(layout, column, row);

    if (hit.area !== "sidebar") {
      return;
    }

    const line = sidebarLineAt(
      sidebar.lines,
      sidebar.scrollStart,
      sidebarListHeight(layout.bodyHeight),
      hit.row,
    );

    if (line?.kind !== "entry" || !isChannel(line.entry.conversation.kind)) {
      return;
    }

    requestFocus("sidebar");
    sidebar.select(lineKey(line));
    sidebar.openChannelMenu(
      { id: line.entry.conversation.id, label: line.entry.label },
      hit.row + borderSize,
    );
  }

  /** The row of a list pane drawn at `row` (counted from the first row of its list), if there is one. */
  function paneRowAt(pane: ListPane, row: number): PaneRow | undefined {
    const listHeight =
      paneInnerHeight(layout.bodyHeight) -
      (pane === "thread"
        ? layout.threadInputHeight
        : layout.messageInputHeight);

    return visibleRowAt(panes[pane].visible, listHeight, row);
  }

  /** The column of a pane's rows under `column` (counted from the pane's left border). */
  const rowColumn = (column: number) => column - borderSize - panePadding;

  /**
   * A click on a list pane: focuses it and selects the message drawn under the
   * pointer, as moving to it would. On an interactive element's label it also
   * does what the label does, and on a "N replies" line the thread opens. A
   * row with no message on it only focuses.
   */
  function clickPane(pane: ListPane, column: number, row: number) {
    requestFocus(pane);

    const clicked = paneRowAt(pane, row);

    if (clicked?.messageTs === undefined) {
      return;
    }

    panes[pane].select(clicked.messageTs);

    const button = buttonAt(clicked, rowColumn(column));

    if (button) {
      pressButton(button.action);
      return;
    }

    if (pane === "messages" && clicked.kind === "replyCount") {
      openThreadOf(clicked.messageTs);
    }
  }

  /**
   * Moves what is under the pointer `delta` steps (negative is up), as `k`/`j`
   * or the arrows would, without moving focus or opening anything: a pane's
   * selection, the sidebar's selection, or a popup's highlighted row (or the
   * help's scroll). Nothing happens while a y/n question is showing, or with
   * the pointer outside an open popup.
   */
  function wheelAt(column: number, row: number, delta: number) {
    if (questionPending) {
      return;
    }

    const hit = hitTest(layout, column, row);

    if (popupOpen) {
      if (hit.area === "popup") {
        popups.wheel(delta);
      }

      return;
    }

    switch (hit.area) {
      case "sidebar":
        sidebar.moveBy(delta);
        return;
      case "messages":
        panes.messages.moveBy(delta);
        return;
      case "thread":
        panes.thread.moveBy(delta);
        return;
    }
  }

  /*
   * A trackpad sends a burst of wheel events in one read, before React has
   * rendered the first step, so each one moving from the rendered state would
   * land on the same row. The steps of events that arrive together (at the
   * same point) are added up and applied once, as soon as the burst has been
   * read; a pane then asks for older history once, not once per event.
   */
  function wheel({ kind, column, row }: MouseInput) {
    const delta = kind === "wheelUp" ? -1 : 1;
    const pending = pendingWheel.current;

    if (pending && pending.column === column && pending.row === row) {
      pending.delta += delta;
      return;
    }

    if (pending) {
      flushWheel();
    }

    pendingWheel.current = { column, row, delta };
    queueMicrotask(flushWheel);
  }

  function flushWheel() {
    const pending = pendingWheel.current;

    pendingWheel.current = undefined;

    if (pending && pending.delta !== 0) {
      wheelAtRef.current(pending.column, pending.row, pending.delta);
    }
  }

  /**
   * What a mouse report does. The wheel moves what is under the pointer (see
   * `wheelAt`); of the buttons a left press does the most and a right press on a channel opens its menu. While a y/n
   * question is showing it cancels the question; with a popup open it chooses
   * the row clicked, does nothing inside the popup elsewhere, and closes it
   * from outside. Otherwise it focuses the pane under it (the sidebar also
   * acts on the row clicked). Whatever else is under the click is left alone.
   */
  function handleMouse(input: MouseInput) {
    const { kind, button, column, row } = input;

    if (kind === "wheelUp" || kind === "wheelDown") {
      wheel(input);
      return;
    }

    if (kind === "motion") {
      hoverAt(column, row);
      return;
    }

    if (kind === "press" && button === "right") {
      rightClick(column, row);
      return;
    }

    if (kind !== "press" || button !== "left") {
      return;
    }

    if (questionPending) {
      cancelQuestion();
      return;
    }

    const hit = hitTest(layout, column, row);

    if (popupOpen) {
      if (hit.area === "popup") {
        popups.clickRow(hit.column, hit.row);
      } else {
        popups.dismiss();
      }

      return;
    }

    switch (hit.area) {
      case "sidebar":
        clickSidebar(hit.row);
        return;
      case "messages":
      case "thread":
        clickPane(hit.area, hit.column, hit.row);
        return;
      case "input":
      case "threadInput":
        focusInputAtEnd(hit.area);
        return;
    }
  }

  /**
   * Hovers the sidebar row or the message label under the pointer, or nothing
   * when the pointer is elsewhere, over a popup, or a y/n question is showing.
   * Motion reports arrive constantly, so this only changes state (and so
   * renders) when what is hovered does: moving over rows with nothing on
   * them, or along one label, doesn't.
   */
  function hoverAt(column: number, row: number) {
    const hit = hitTest(layout, column, row);
    const canHover = !popupOpen && !questionPending;
    const onSidebar =
      hit.area === "sidebar" &&
      canHover &&
      sidebarLineAt(
        sidebar.lines,
        sidebar.scrollStart,
        sidebarListHeight(layout.bodyHeight),
        hit.row,
      ) !== undefined;

    setHoveredRow(onSidebar ? hit.row : undefined);

    const next = canHover ? paneButtonAt(hit) : undefined;

    setHoveredButton((current) => (sameHover(current, next) ? current : next));
  }

  /** The message label at a point, if the point is on one in a list pane. */
  function paneButtonAt(hit: Hit): PaneHoveredButton | undefined {
    if (hit.area !== "messages" && hit.area !== "thread") {
      return undefined;
    }

    const paneRow = paneRowAt(hit.area, hit.row);
    const button = paneRow && buttonAt(paneRow, rowColumn(hit.column));

    if (!paneRow || !button) {
      return undefined;
    }

    return { pane: hit.area, key: paneRow.key, start: button.start };
  }

  handleMouseRef.current = handleMouse;
  wheelAtRef.current = wheelAt;

  useEffect(
    () => source?.subscribe((input) => handleMouseRef.current(input)),
    [source],
  );

  useEffect(
    () =>
      source?.subscribeToBlur(() => {
        setHoveredRow(undefined);
        setHoveredButton(undefined);
      }),
    [source],
  );

  useEffect(() => {
    if (popupOpen) {
      setHoveredRow(undefined);
      setHoveredButton(undefined);
    }
  }, [popupOpen]);

  return {
    hoveredLine:
      hoveredRow === undefined || popupOpen || questionPending
        ? undefined
        : sidebarLineAt(
            sidebar.lines,
            sidebar.scrollStart,
            sidebarListHeight(layout.bodyHeight),
            hoveredRow,
          ),
    hoveredButton: popupOpen || questionPending ? undefined : hoveredButton,
  };
}
