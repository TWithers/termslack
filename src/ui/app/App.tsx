import { Box, useApp, useInput, useWindowSize } from "ink";
import { Text } from "../SafeText";
import { useEffect, useMemo, useRef, useState } from "react";
import { defaultRecentDms } from "../../config/config";
import type {
  CollapseMemory,
  ConversationMemory,
  HideMutedMemory,
} from "../../config/state";
import { replyParentOf } from "../../session/events";
import { describeHistoryFailure } from "../../session/failureText";
import { personName } from "../../session/people";
import { compareTs } from "../../session/workspaceStore";
import { useComposer } from "../input/useComposer";
import { draftKey, useDrafts } from "../input/useDrafts";
import type {
  SearchResult,
  WorkspaceSession,
} from "../../session/workspaceSession";
import { ComposedPane } from "./ComposedPane";
import type { MouseLayout } from "./hitTest";
import type { MouseSource } from "./mouse";
import { PopupOverlay } from "./PopupOverlay";
import { handleSelectionKey } from "./paneKeys";
import { pressed, shortcutKeys } from "./shortcuts";
import { conversationRows, dayKey, isShown, olderStatusText } from "./paneRows";
import { theme } from "../theme";
import { Sidebar } from "./Sidebar";
import {
  headingIdOf,
  needsPeople,
  sidebarEntry,
  sectionIdOf,
  selectableIds,
  lineKey,
  sidebarGroups,
  sidebarLines,
  sidebarScrollStart,
  type SidebarView,
  visibleSidebarLines,
} from "./sidebarEntries";
import {
  editKeyHints,
  sidebarKeyHints,
  StatusBar,
  statusWarning,
} from "./StatusBar";
import { isChannel } from "../../session/events";
import type { ChannelRef } from "./useConfirmPrompt";
import { useCollapsedSections } from "./useCollapsedSections";
import { useHideMuted } from "./useHideMuted";
import { useHistory } from "./useHistory";
import { useMidnightRedraw } from "./useMidnightRedraw";
import { useMouse } from "./useMouse";
import { usePaneSelection } from "./usePaneSelection";
import { useReopenLast } from "./useReopenLast";
import { useSession } from "./useSession";
import { useSidebarSelection } from "./useSidebarSelection";
import type { SwitcherCandidate } from "./switcherRanking";
import { usePopups } from "./usePopups";
import { useStatusMessage } from "./useStatusMessage";
import {
  type Editing,
  editingNotice,
  editPlace,
  useMessageActions,
} from "./useMessageActions";
import {
  type Focus,
  focusOrderOf,
  inputFor,
  isInputPane,
  isListPane,
  listFor,
  paneKeyHints,
  resolveFocus,
} from "./focus";
import { useInputKeys } from "./useInputKeys";
import { type Notice, useNotice } from "./notice";
import { useThreadPane } from "./useThreadPane";

export type AppProps = {
  /** A started session. The app disconnects it when it quits. */
  session: WorkspaceSession;
  workspaceName: string;
  /** Shown in the status bar until the store knows the user's name. */
  userName?: string;
  /** The current time, for labels like "Today". Defaults to the real clock. */
  now?: () => Date;
  /**
   * Where the open conversation is remembered between runs. When given, the
   * remembered conversation is opened once the listing confirms it, and
   * every change of the open conversation is recorded.
   */
  conversationMemory?: ConversationMemory;
  /** How many of the most recent DMs the sidebar lists (the config's `recentDms`). Default 10. */
  recentDms?: number;
  /** Where collapsed sections are remembered between runs. Default: nothing is remembered. */
  collapseMemory?: CollapseMemory;
  /** Where the choice to hide muted channels is remembered between runs. Default: nothing is remembered. */
  hideMutedMemory?: HideMutedMemory;
  /** A one-time note for the status bar from outside the app (for instance, that desktop notifications can't be shown). */
  notice?: Notice;
  /** Saves the theme chosen in the theme picker (as the config's `theme`). Default: it is only kept for this run. */
  saveTheme?: (name: string) => Promise<void>;
  /** Where the terminal's mouse reports arrive. Default: none do, so the mouse does nothing. */
  mouse?: MouseSource;
};

const goneText = "That message has been deleted.";
const furtherBackText =
  "That result is further back than the last 200 messages. Scroll up to load more.";

const minSidebarWidth = 12;
const maxSidebarWidth = 32;

/** About a third of the terminal, within limits, and never more than the terminal. */
function sidebarWidth(columns: number): number {
  return Math.min(
    columns,
    Math.min(
      maxSidebarWidth,
      Math.max(minSidebarWidth, Math.floor(columns / 3)),
    ),
  );
}

/** The whole terminal UI: sidebar and main pane side by side, with the status bar underneath. */
export function App({
  session,
  workspaceName,
  userName,
  now = () => new Date(),
  conversationMemory,
  recentDms = defaultRecentDms,
  collapseMemory,
  hideMutedMemory,
  notice,
  saveTheme = async () => {},
  mouse,
}: AppProps) {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();

  const version = useSession(session);
  const today = dayKey(now());

  useMidnightRedraw(now, today);

  const [showAllDms, setShowAllDms] = useState(false);
  const { collapsed, setSectionCollapsed } =
    useCollapsedSections(collapseMemory);
  const { hideMuted, setHideMuted } = useHideMuted(hideMutedMemory);
  const [openId, setOpenId] = useState<string>();
  const [requestedFocus, requestFocus] = useState<Focus>("sidebar");
  const drafts = useDrafts();
  const [editing, setEditing] = useState<Editing>();
  const scrollStart = useRef(0);
  const history = useHistory(session);
  /** The conversation open without the user being in it (a public channel found by search), whose input is off. */
  const [readOnlyId, setReadOnlyId] = useState<string>();
  /** Counts conversation opens, so a slow load for one that was left behind changes nothing. */
  const opens = useRef(0);

  useEffect(
    () => () => {
      void session.stop();
    },
    [session],
  );

  const groups = sidebarGroups(session, session.sections());
  const view: SidebarView = {
    recentLimit: recentDms,
    showAll: showAllDms,
    openId,
    collapsed,
    hideMuted,
  };
  const lines = sidebarLines(groups, view);
  const ids = selectableIds(lines);
  const {
    selectedId,
    select,
    moveBy: moveSidebarBy,
  } = useSidebarSelection(ids);
  const writeProblem = session.scopeProblem("write");
  const { message: statusMessage, show: showStatus } = useStatusMessage([
    useNotice(notice),
    session.sectionsNote(),
    session.dndNote(),
  ]);
  /** The name of the sidebar section a conversation is listed in, as its heading says. */
  function sectionName(conversationId: string): string | undefined {
    const current = sidebarGroups(session, session.sections());
    const id = sectionIdOf(current, conversationId);

    return id === "channels"
      ? "Channels"
      : current.sections.find((section) => section.id === id)?.name;
  }

  /** The name of the user's section a conversation is in, if it is in one. */
  function userSectionOf(conversationId: string): string | undefined {
    const current = sidebarGroups(session, session.sections());
    const id = sectionIdOf(current, conversationId);

    return current.sections.find((section) => section.id === id)?.name;
  }

  const popups = usePopups({
    session,
    columns,
    rows,
    opens,
    chooseConversation: chooseFromSwitcher,
    openSearchResult,
    openJoined: openFromSwitcher,
    sectionName,
    userSectionOf,
    saveTheme,
    report: showStatus,
  });
  const { bodyHeight, help, switcher, themePicker, search, reactionPrompt } =
    popups;
  const sidebarCols = sidebarWidth(columns);
  const areaWidth = Math.max(0, columns - sidebarCols);
  const thread = useThreadPane({
    session,
    version,
    areaWidth,
    height: Math.max(0, bodyHeight - 1),
    now,
    today,
    drafts,
    inputFocused: requestedFocus === "threadInput",
    editPlace:
      editing?.input === "threadInput" ? editPlace(editing) : undefined,
  });
  const openConversationRecord =
    openId === undefined ? undefined : session.conversation(openId);
  const openRecordEntry =
    openConversationRecord && sidebarEntry(openConversationRecord, session);
  const notMemberProblem =
    openId !== undefined && openId === readOnlyId
      ? `You're not a member of ${openRecordEntry?.label ?? "this conversation"}. Join it from the quick switcher (${shortcutKeys("global.switcher")}) to write.`
      : undefined;
  const inputProblem = writeProblem ?? notMemberProblem;
  const { widths } = thread;
  const paneWidth = widths.message;
  const textWidth = Math.max(1, paneWidth - 1);
  const focusOrder = focusOrderOf({
    hasConversation: openId !== undefined,
    showsMessages: widths.showMessages,
    hasThread: thread.threadTs !== undefined,
  });
  /*
   * When the focused pane leaves the screen (the terminal narrowed, the
   * thread closed) focus goes to the nearest pane.
   */
  const focus = resolveFocus(requestedFocus, focusOrder);
  const composer = useComposer({
    drafts,
    place:
      openId === undefined
        ? undefined
        : editing?.input === "input"
          ? editPlace(editing)
          : draftKey(openId),
    session,
    width: paneWidth,
    availableHeight: bodyHeight,
    focused: focus === "input",
    noticeLines: editing?.input === "input" ? 1 : 0,
  });
  /** The edit open in the focused input, if any: Enter and Esc there save or cancel it, the other input is unaffected. */
  const focusedEdit = editing?.input === focus ? editing : undefined;
  const messageHeight = Math.max(0, bodyHeight - composer.height);
  const openHistory =
    openId === undefined ? undefined : history.statusOf(openId);
  const { rows: paneRows } = useMemo(
    () =>
      openId === undefined
        ? { rows: [] }
        : conversationRows(session, openId, textWidth, openHistory, now()),
    // The session's version changes whenever anything it holds does; the rows carry the theme's colours.
    [session, version, openId, textWidth, openHistory, today, theme],
  );
  const messages = usePaneSelection({
    rows: paneRows,
    height: Math.max(0, messageHeight - 1),
    onReachTop: () => {
      if (openId !== undefined) {
        history.loadOlder(openId);
      }
    },
  });

  const actions = useMessageActions({
    session,
    conversationId: openId,
    selectedTs: (pane) =>
      pane === "thread" ? thread.selection.selectedTs : messages.selectedTs,
    drafts,
    editing,
    setEditing,
    focusInput: requestFocus,
    focusList: (input) => requestFocus(listFor(input)),
    startReaction: reactionPrompt.open,
    report: showStatus,
  });

  useEffect(() => {
    if (requestedFocus !== focus) {
      requestFocus(focus);
    }
  }, [requestedFocus, focus]);

  /*
   * An edit belongs to the input it started in. When that input leaves the
   * screen (the terminal narrowed so the thread covers the conversation, the
   * thread closed) the edit is cancelled and the draft that was there
   * returns when the input does, rather than running on unseen.
   */
  const editInputGone =
    editing !== undefined && !focusOrder.includes(editing.input);

  useEffect(() => {
    if (editInputGone) {
      actions.discardEdit();
    }
  }, [editInputGone]);

  /** Opens a conversation as if the user had pressed Enter on it. */
  function openConversation(
    id: string,
    { remember, load = true }: { remember: boolean; load?: boolean },
  ) {
    opens.current++;
    setReadOnlyId(undefined);

    if (session.conversation(id)?.isMember !== false) {
      select(id);
    }

    setOpenId(id);
    session.setOpenConversation(id);
    messages.reset();
    actions.discardEdit();
    reactionPrompt.close();
    thread.close();

    if (load) {
      history.load(id);
    }

    showStatus(undefined);
    switcher.opened(id);

    if (remember) {
      conversationMemory?.remember(id);
    }
  }

  /**
   * Opens a conversation the quick switcher chose, as Enter on it in the
   * sidebar would: its section opens up if collapsed (a DM the recent-DMs
   * filter hides is shown because it is open), and focus moves to its messages.
   */
  function openFromSwitcher(id: string) {
    const sectionId = sectionIdOf(
      sidebarGroups(session, session.sections()),
      id,
    );

    if (sectionId !== undefined && collapsed.has(sectionId)) {
      setSectionCollapsed(sectionId, false);
    }

    openConversation(id, { remember: true });
    requestFocus("messages");
  }

  /**
   * Opens a search result where it was posted, with its message selected:
   * history is loaded back to it (a reply's thread parent, for a reply) and
   * the view moves to it once it is there. A reply also opens its thread with
   * the reply selected and focused. A message that is gone leaves the
   * conversation open at the nearest message with a note in the status bar.
   * A public channel the user isn't in opens read-only.
   */
  async function openSearchResult({ message }: SearchResult) {
    const id = message.channelId;

    if (session.conversation(id) === undefined) {
      await session.resolveConversationPeople(id);
    }

    const conversation = session.conversation(id);

    if (conversation === undefined) {
      showStatus("Slack won't let termslack open that conversation.");
      return;
    }

    const sectionId = sectionIdOf(
      sidebarGroups(session, session.sections()),
      id,
    );

    if (sectionId !== undefined && collapsed.has(sectionId)) {
      setSectionCollapsed(sectionId, false);
    }

    openConversation(id, { remember: conversation.isMember, load: false });
    setReadOnlyId(conversation.isMember ? undefined : id);
    requestFocus("messages");

    const mine = opens.current;
    const parentTs = replyParentOf(message);
    const targetTs = parentTs ?? message.ts;
    const outcome = await history.loadAround(id, targetTs);

    if (opens.current !== mine) {
      return;
    }

    if (outcome.kind === "failed") {
      showStatus(
        describeHistoryFailure(outcome.error, shortcutKeys("global.switcher")),
      );
      return;
    }

    const shown = session.messages(id).filter(isShown);
    const nearest =
      [...shown].reverse().find((each) => compareTs(each.ts, targetTs) <= 0) ??
      shown[0];

    if (outcome.found) {
      messages.focusOn(targetTs);
    } else if (nearest) {
      messages.focusOn(nearest.ts);
    }

    if (outcome.isFurtherBack) {
      showStatus(furtherBackText);
      return;
    }

    if (parentTs === undefined) {
      if (!outcome.found) {
        showStatus(goneText);
      }

      return;
    }

    thread.open(id, parentTs, {
      select: { ts: message.ts, onMissing: () => showStatus(goneText) },
    });
    requestFocus("thread");
  }

  /**
   * What the quick switcher chose: a conversation to open, a public channel
   * to join first (after asking), or a person whose DM is opened, started
   * first if there is none.
   */
  async function chooseFromSwitcher(candidate: SwitcherCandidate) {
    const { id, userId } = candidate;

    if (candidate.notMember) {
      popups.joinPrompt.ask(candidate);
      return;
    }

    if (userId === undefined) {
      openFromSwitcher(id);
      return;
    }

    const mine = opens.current;
    const started = await session.startDirectMessage(userId);

    if (!started.ok) {
      showStatus(started.message);
      return;
    }

    if (opens.current !== mine) {
      return;
    }

    openFromSwitcher(started.conversationId);
  }

  /** Closes the open conversation and what hangs off it, as when nothing is open. */
  function closeConversation() {
    setOpenId(undefined);
    session.setOpenConversation(undefined);
    messages.reset();
    actions.discardEdit();
    reactionPrompt.close();
    thread.close();
    conversationMemory?.remember(undefined);
    requestFocus("sidebar");
  }

  /*
   * A conversation the user has left, here or elsewhere, closes if it is open
   * and loses its drafts.
   */
  const openIsLeft =
    openId !== undefined &&
    openId !== readOnlyId &&
    session.conversation(openId)?.isMember === false;

  useEffect(() => {
    if (
      readOnlyId !== undefined &&
      session.conversation(readOnlyId)?.isMember
    ) {
      setReadOnlyId(undefined);
    }
  }, [version, readOnlyId]);

  useEffect(() => {
    if (openIsLeft) {
      closeConversation();
    }
  }, [openIsLeft]);

  useEffect(() => {
    drafts.prune((id) => session.conversation(id)?.isMember !== false);
  }, [version]);

  useReopenLast({
    session,
    memory: conversationMemory,
    openId,
    reopen: (id) => openConversation(id, { remember: false }),
  });

  scrollStart.current = sidebarScrollStart(
    scrollStart.current,
    lines,
    selectedId,
    bodyHeight,
  );

  const visibleLines = visibleSidebarLines(
    lines,
    scrollStart.current,
    bodyHeight,
  );
  const unresolvedIds = visibleLines
    .flatMap((line) =>
      line.kind === "entry" && needsPeople(line.entry.conversation, session)
        ? [line.entry.conversation.id]
        : [],
    )
    .join(",");

  useEffect(() => {
    for (const id of unresolvedIds.split(",").filter(Boolean)) {
      void session.resolveConversationPeople(id);
    }
  }, [session, unresolvedIds]);

  const visiblePeople = [
    ...new Set(
      [
        openConversationRecord,
        ...visibleLines.map((line) =>
          line.kind === "entry" ? line.entry.conversation : undefined,
        ),
      ].flatMap((conversation) =>
        conversation?.kind === "im" && conversation.userId
          ? [conversation.userId]
          : [],
      ),
    ),
  ].join(",");

  useEffect(() => {
    session.setVisiblePeople(visiblePeople.split(",").filter(Boolean));
  }, [session, visiblePeople]);

  /** Ends an edit begun in the thread's input; one in the conversation's input is not the thread's to end. */
  function discardThreadEdit() {
    if (editing?.input === "threadInput") {
      actions.discardEdit();
    }
  }

  /** Opens the thread of the selected message; one with no replies opens empty, ready for a first reply. */
  function openSelectedThread() {
    openThreadOf(messages.selectedTs);
  }

  /** Opens the thread of the message `ts`, as `openSelectedThread` does for the selected one. */
  function openThreadOf(ts?: string) {
    if (openId === undefined || ts === undefined) {
      return;
    }

    const message = session.message(openId, ts);
    const rootTs = message?.threadTs ?? ts;
    const hasReplies =
      (message !== undefined && replyParentOf(message) !== undefined) ||
      (message?.replyCount ?? 0) > 0 ||
      session.threadReplies(openId, ts).length > 0;

    discardThreadEdit();
    thread.open(openId, rootTs, { load: hasReplies });
    requestFocus(hasReplies ? "thread" : "threadInput");
  }

  function closeThread() {
    discardThreadEdit();
    thread.close();
    requestFocus("messages");
  }

  /** The pane Tab moves to from the focused one. */
  const nextFocus = () =>
    focusOrder[(focusOrder.indexOf(focus) + 1) % focusOrder.length]!;

  const handleInputKeys = useInputKeys({
    session,
    drafts,
    openId,
    composers: { input: composer, threadInput: thread.composer },
    thread,
    resetMessages: messages.reset,
    actions,
    focusedEdit,
    writeProblem: inputProblem,
    requestFocus,
    nextFocus,
    report: showStatus,
  });

  const questionPending = (actions.prompt ?? popups.prompt) !== undefined;

  /** Opens the channel menu for a channel, beside its sidebar row (`row`, or where the row is drawn). */
  function openChannelMenu(channel: ChannelRef, row?: number) {
    const drawnAt = visibleLines.findIndex(
      (line) =>
        line.kind === "entry" && line.entry.conversation.id === channel.id,
    );

    popups.channelMenu.open(channel, {
      top: row ?? Math.max(0, drawnAt),
      left: sidebarCols,
    });
  }

  const mouseLayout: MouseLayout = {
    columns,
    rows,
    sidebarWidth: sidebarCols,
    bodyHeight,
    panes: widths,
    hasConversation: openId !== undefined,
    hasThread: thread.threadTs !== undefined,
    messageInputHeight: composer.height,
    threadInputHeight: thread.composer.height,
    popup: popups.region(),
  };
  const { hoveredLine } = useMouse({
    source: mouse,
    layout: mouseLayout,
    sidebar: {
      lines,
      scrollStart: scrollStart.current,
      select,
      openChannelMenu,
      moveBy: moveSidebarBy,
      openId,
      setSectionCollapsed,
    },
    panes: { messages, thread: thread.selection },
    popups,
    inputs: { input: composer, threadInput: thread.composer, drafts },
    questionPending,
    cancelQuestion() {
      actions.cancelPrompt();
      popups.cancelPrompt();
    },
    requestFocus,
    openConversation,
    openThreadOf,
  });
  const hoveredId = hoveredLine && lineKey(hoveredLine);

  useInput((input, key) => {
    if (pressed("global.interrupt", input, key)) {
      exit();
      return;
    }

    if (popups.handleKey(input, key, actions.prompt !== undefined)) {
      return;
    }

    if (isInputPane(focus)) {
      handleInputKeys(focus, input, key);
      return;
    }

    if (isListPane(focus) && actions.handleKey(focus, input, key)) {
      return;
    }

    if (pressed("global.help", input, key)) {
      help.open();
      return;
    }

    if (pressed("global.search", input, key)) {
      popups.openSearch();
      return;
    }

    if (pressed("global.theme", input, key)) {
      themePicker.open();
      return;
    }

    if (pressed("global.quit", input, key)) {
      exit();
      return;
    }

    if (pressed("global.nextPane", input, key)) {
      requestFocus(nextFocus());
      return;
    }

    const listPane = focus === "thread" ? "thread" : "messages";

    if (pressed(`${listPane}.write`, input, key)) {
      const target = inputFor(listPane);

      if (focusOrder.includes(target)) {
        requestFocus(target);
        return;
      }
    }

    if (focus === "messages") {
      if (pressed("messages.openThread", input, key)) {
        openSelectedThread();
        return;
      }

      handleSelectionKey("messages", messages, input, key);
      return;
    }

    if (focus === "thread") {
      if (pressed("thread.close", input, key)) {
        closeThread();
        return;
      }

      handleSelectionKey("thread", thread.selection, input, key);
      return;
    }

    const index = selectedId === undefined ? -1 : ids.indexOf(selectedId);

    if (pressed("sidebar.down", input, key)) {
      select(ids[Math.min(index + 1, ids.length - 1)]);
    }

    if (pressed("sidebar.up", input, key)) {
      select(ids[Math.max(index - 1, 0)]);
    }

    if (pressed("sidebar.allDms", input, key)) {
      setShowAllDms(!showAllDms);
    }

    if (pressed("sidebar.hideMuted", input, key)) {
      setHideMuted(!hideMuted);
    }

    const headingId = headingIdOf(selectedId);

    if (headingId !== undefined) {
      if (
        pressed("sidebar.open", input, key) ||
        pressed("sidebar.toggle", input, key)
      ) {
        setSectionCollapsed(headingId, !collapsed.has(headingId));
      }

      if (pressed("sidebar.collapse", input, key)) {
        setSectionCollapsed(headingId, true);
      }

      if (pressed("sidebar.expand", input, key)) {
        setSectionCollapsed(headingId, false);
      }

      return;
    }

    if (pressed("sidebar.menu", input, key) && selectedId !== undefined) {
      const entry = lines.find(
        (line) =>
          line.kind === "entry" && line.entry.conversation.id === selectedId,
      );

      if (entry?.kind === "entry" && isChannel(entry.entry.conversation.kind)) {
        openChannelMenu({ id: selectedId, label: entry.entry.label });
      }

      return;
    }

    if (pressed("sidebar.leave", input, key) && selectedId !== undefined) {
      const entry = lines.find(
        (line) =>
          line.kind === "entry" && line.entry.conversation.id === selectedId,
      );

      if (entry?.kind === "entry") {
        popups.leavePrompt.ask({ id: selectedId, label: entry.entry.label });
      }

      return;
    }

    if (pressed("sidebar.open", input, key) && selectedId !== undefined) {
      openConversation(selectedId, { remember: true });
    }
  });

  const currentUserId = session.currentUserId;
  const user = currentUserId
    ? personName(session.user(currentUserId), currentUserId)
    : undefined;
  const openEntry = lines.find(
    (line) => line.kind === "entry" && line.entry.conversation.id === openId,
  );
  const openLabel = (
    openEntry?.kind === "entry" ? openEntry.entry : openRecordEntry
  )?.label;

  return (
    <Box
      flexDirection="column"
      width={columns}
      height={rows}
      overflow="hidden"
      backgroundColor={theme.paneBackground}
    >
      <Box
        height={bodyHeight}
        flexShrink={0}
        overflow="hidden"
        backgroundColor={theme.paneBackground}
      >
        <Sidebar
          lines={lines}
          start={scrollStart.current}
          selectedId={selectedId}
          openId={openId}
          hoveredId={hoveredId}
          width={sidebarCols}
          height={bodyHeight}
          focused={focus === "sidebar"}
        />
        {openId !== undefined &&
        openLabel !== undefined &&
        widths.showMessages ? (
          <ComposedPane
            title={openLabel}
            presence={
              (openEntry?.kind === "entry" ? openEntry.entry : openRecordEntry)
                ?.presence
            }
            status={olderStatusText(openHistory)}
            selection={messages}
            listFocused={focus === "messages"}
            composer={composer}
            inputFocused={focus === "input"}
            placeholder={`Message ${openLabel} (press i to write)`}
            notice={editing?.input === "input" ? editingNotice : undefined}
            disabledReason={inputProblem}
            width={paneWidth}
            height={bodyHeight}
          />
        ) : openId === undefined ? (
          <Box flexGrow={1} flexShrink={1} overflow="hidden">
            <Text color={theme.secondaryText} wrap="truncate">
              No conversation open
            </Text>
          </Box>
        ) : null}
        {thread.threadTs !== undefined ? (
          <ComposedPane
            title="Thread"
            selection={thread.selection}
            listFocused={focus === "thread"}
            composer={thread.composer}
            inputFocused={focus === "threadInput"}
            placeholder="Reply in thread (press i to write)"
            notice={
              editing?.input === "threadInput"
                ? editingNotice
                : thread.alsoToChannel
                  ? `also send to ${openLabel ?? "the channel"}`
                  : undefined
            }
            disabledReason={inputProblem}
            width={widths.thread}
            height={bodyHeight}
          />
        ) : null}
        <PopupOverlay
          popups={popups}
          lookup={session}
          columns={columns}
          height={bodyHeight}
        />
      </Box>
      <StatusBar
        workspaceName={workspaceName}
        userName={user ?? userName ?? "…"}
        status={session.status}
        warning={statusWarning(
          session.listingHealth(),
          session.sectionsKeptByTermslack() ? [] : groups.unknownChannels,
        )}
        unreadProgress={session.unreadCheckProgress()}
        message={statusMessage}
        prompt={actions.prompt ?? popups.prompt}
        hints={
          popups.isOpen
            ? undefined
            : focusedEdit
              ? editKeyHints
              : focus === "sidebar"
                ? sidebarKeyHints(hideMuted)
                : paneKeyHints[focus]
        }
      />
    </Box>
  );
}
