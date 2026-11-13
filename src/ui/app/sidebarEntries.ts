import { defaultRecentDms, type SectionConfig } from "../../config/config";
import {
  isChannel,
  isDirectMessage,
  type Conversation,
  type Presence,
} from "../../session/events";
import type { ConversationMarkers } from "../../session/unreadTracker";
import { conversationLabel, conversationTitle } from "../../session/people";
import type { WorkspaceSession } from "../../session/workspaceSession";
import { theme } from "../theme";
import { cellWidth } from "../terminalSafeText";
import type { Run } from "./wrap";

export type SidebarEntry = {
  conversation: Conversation;
  /** `#general`, `@sarah` or `@sarah, ray`; the raw ID until the name is known. */
  label: string;
  /** What is unread or mentioning; a muted channel never counts as unread, only its mentions. */
  markers: ConversationMarkers;
  /** Whether the channel is muted in termslack: drawn dimmed, never bold. */
  muted?: boolean;
  /** Whether the person of a DM is active or away, when known. */
  presence?: Presence;
};

/** A section the user defined in the config, with the channels that matched. */
export type SidebarSection = {
  /** Stable across runs and renames of channels: `section:<name>`. */
  id: string;
  name: string;
  entries: SidebarEntry[];
};

export type SidebarGroups = {
  /** The configured sections, in config order. */
  sections: SidebarSection[];
  /** The channels no section claimed. */
  channels: SidebarEntry[];
  directMessages: SidebarEntry[];
  /** Configured channel names and IDs that match no channel the user is in, each once, in config order. */
  unknownChannels: string[];
};

/** Whether a configured channel reference (name with or without `#`, or ID) names this entry. */
function referencesEntry(
  reference: string,
  { conversation, label }: SidebarEntry,
) {
  const wanted = reference.replace(/^#/, "").toLowerCase();

  return (
    conversation.id.toLowerCase() === wanted ||
    label.slice(1).toLowerCase() === wanted
  );
}

/** A conversation as the sidebar and the quick switcher list it. */
export function sidebarEntry(
  conversation: Conversation,
  session: Pick<
    WorkspaceSession,
    "user" | "conversationMembers" | "currentUserId" | "markers"
  > &
    Partial<Pick<WorkspaceSession, "presence" | "isMuted">>,
): SidebarEntry {
  const name = conversationLabel(conversation, session);
  const muted = session.isMuted?.(conversation.id) ?? false;
  const markers = session.markers(conversation.id);

  return {
    conversation,
    label: conversationTitle(conversation.kind, name || conversation.id),
    markers: muted ? { ...markers, isUnread: false } : markers,
    muted: muted || undefined,
    presence:
      conversation.kind === "im" && conversation.userId
        ? session.presence?.(conversation.userId)
        : undefined,
  };
}

/**
 * The conversations the user is in, grouped for the sidebar. Channels are
 * sorted by resolved name and dealt into the configured sections (a channel
 * goes in the first section that lists it); DMs and group DMs by newest
 * message first (then by name), without the ones Slack won't show.
 */
export function sidebarGroups(
  session: Pick<
    WorkspaceSession,
    | "conversations"
    | "user"
    | "conversationMembers"
    | "currentUserId"
    | "markers"
    | "presence"
    | "dmActivity"
    | "isDmHidden"
  > &
    Partial<Pick<WorkspaceSession, "isMuted">>,
  configuredSections: SectionConfig[] = [],
): SidebarGroups {
  const entries = session
    .conversations()
    .filter(
      (conversation) =>
        conversation.isMember &&
        !conversation.isArchived &&
        !session.isDmHidden(conversation.id),
    )
    .map((conversation) => sidebarEntry(conversation, session))
    .sort((a, b) => a.label.localeCompare(b.label));

  const activity = ({ conversation }: SidebarEntry) =>
    session.dmActivity(conversation.id) ?? 0;

  const allChannels = entries.filter(({ conversation }) =>
    isChannel(conversation.kind),
  );
  const claimed = new Set<string>();
  const sections = configuredSections.map(({ name, channels }) => {
    const matching = allChannels.filter(
      (entry) =>
        !claimed.has(entry.conversation.id) &&
        channels.some((reference) => referencesEntry(reference, entry)),
    );

    for (const entry of matching) {
      claimed.add(entry.conversation.id);
    }

    return { id: `section:${name}`, name, entries: matching };
  });
  const unknownChannels = [
    ...new Set(
      configuredSections
        .flatMap(({ channels }) => channels)
        .filter(
          (reference) =>
            !allChannels.some((entry) => referencesEntry(reference, entry)),
        ),
    ),
  ];

  return {
    sections,
    channels: allChannels.filter(
      ({ conversation }) => !claimed.has(conversation.id),
    ),
    unknownChannels,
    directMessages: entries
      .filter(({ conversation }) => isDirectMessage(conversation.kind))
      .sort((a, b) => activity(b) - activity(a)),
  };
}

/** The ID of the sidebar section (`channels`, `directMessages`, `section:<name>`) that lists the conversation, if any does. */
export function sectionIdOf(
  { sections, channels, directMessages }: SidebarGroups,
  conversationId: string,
): string | undefined {
  const lists = (entries: SidebarEntry[]) =>
    entries.some(({ conversation }) => conversation.id === conversationId);

  return (
    sections.find(({ entries }) => lists(entries))?.id ??
    (lists(channels)
      ? "channels"
      : lists(directMessages)
        ? "directMessages"
        : undefined)
  );
}

/** The count badge drawn at the right edge of a row that mentions the user: ` 2 `, or an empty string. */
export function badgeText({ mentions }: ConversationMarkers): string {
  return mentions > 0 ? ` ${mentions} ` : "";
}

export type SidebarRowState = {
  selected: boolean;
  open: boolean;
  /** Whether the sidebar has keyboard focus: the selection uses the selection colours when it does, a quieter background when not. */
  focused: boolean;
  /** The channel is muted: its name is dimmed, and never bold for unread messages or mentions (the badge still shows). */
  muted?: boolean;
  /** The mouse pointer is over this row: it gets the hover background across its width, unless it is selected (selection wins). */
  hovered?: boolean;
  width: number;
};

/**
 * How a conversation's name is styled, Slack-app style: read is secondary
 * text, unread and mentions are bold bright. The open conversation is bold.
 * A selected row is never secondary, so the highlight stays readable on top
 * of every state. A muted channel is dimmer than a read one and never bold
 * for unread or mentions (its badge says them).
 */
export function entryStyle(
  markers: ConversationMarkers,
  { selected, open, focused, hovered, muted }: Omit<SidebarRowState, "width">,
): Omit<Run, "text"> {
  const isLoud = !muted && (markers.isUnread || markers.mentions > 0);
  const color = isLoud
    ? theme.brightText
    : open || selected
      ? theme.text
      : muted
        ? theme.mutedChannelText
        : theme.secondaryText;

  if (selected && focused) {
    return {
      bold: isLoud || open || undefined,
      color: theme.selectionText,
      backgroundColor: theme.selectionBackground,
    };
  }

  return {
    bold: isLoud || open || undefined,
    color,
    backgroundColor: selected
      ? theme.unfocusedSelectionBackground
      : hovered
        ? theme.sidebarHoverBackground
        : undefined,
  };
}

/** `runs` carried on to `width` cells in the hover background, for a hovered row whose own runs stop at its text. */
function fillHoverWidth(runs: Run[], width: number, state: SidebarRowState) {
  if (!state.hovered || state.selected) {
    return runs;
  }

  const used = runs.reduce((sum, run) => sum + cellWidth(run.text), 0);

  if (used >= width) {
    return runs;
  }

  return [
    ...runs,
    {
      backgroundColor: theme.sidebarHoverBackground,
      text: " ".repeat(width - used),
    },
  ];
}

/**
 * The presence marker's run: a `●` in the theme's active colour, a `○` in its
 * away colour, and a plain space (so the row's width and highlight carry on)
 * while unknown.
 */
export function presenceRun(
  presence: Presence | undefined,
  style: Omit<Run, "text"> = {},
): Run {
  if (presence === "active") {
    return {
      ...style,
      text: presenceMarkers.active,
      color: theme.presenceActive,
    };
  }

  return presence === "away"
    ? { ...style, text: presenceMarkers.away, color: theme.presenceAway }
    : { ...style, text: " " };
}

export const presenceMarkers = { active: "●", away: "○" } as const;

/**
 * The runs of one sidebar entry row, exactly `width` cells when there is a
 * badge and no wider otherwise: the selection and open markers, a DM's
 * presence marker (in the cell before the name, so names stay where they
 * are), the name (cut short with `…` before anything else is), then the
 * mention badge flush right.
 */
export function sidebarRow(
  { label, markers, presence, muted }: SidebarEntry,
  state: SidebarRowState,
): Run[] {
  const style = entryStyle(markers, { ...state, muted });
  const prefix = `${state.selected ? "›" : " "}${state.open ? "▌" : " "}`;

  const runs =
    presence === undefined
      ? labelRuns(`${prefix} `, label, markers, style, state)
      : labelRuns(
          prefix,
          label,
          markers,
          style,
          state,
          presenceRun(presence, style),
        );

  return fillHoverWidth(runs, state.width, state);
}

/**
 * A row of a prefix, a name (cut short with `…` before anything else is) and,
 * for mentions, the count badge flush right: exactly `width` cells with a
 * badge, no wider otherwise.
 */
function labelRuns(
  prefix: string,
  label: string,
  markers: ConversationMarkers,
  style: Omit<Run, "text">,
  { width }: { width: number },
  /** The one cell between the prefix and the name, where an entry shows presence. */
  marker?: Run,
): Run[] {
  const badge = badgeText(markers);
  const prefixWidth = prefix.length + (marker ? 1 : 0);
  const reserved = prefixWidth + (badge ? badge.length + 1 : 0);
  const name = truncateToWidth(label, Math.max(0, width - reserved));
  const runs: Run[] = [
    { ...style, text: prefix },
    ...(marker ? [marker] : []),
    { ...style, text: name },
  ];

  if (!badge) {
    return runs;
  }

  const gap = Math.max(0, width - prefixWidth - cellWidth(name) - badge.length);

  runs.push(
    {
      backgroundColor: style.backgroundColor,
      text: " ".repeat(gap),
    },
    {
      text: badge,
      color: theme.mentionBadgeText,
      backgroundColor: theme.mentionBadgeBackground,
      bold: true,
    },
  );

  return runs;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Shortens `text` to at most `width` cells, ending in `…` when it had to cut. */
export function truncateToWidth(text: string, width: number): string {
  if (cellWidth(text) <= width) {
    return text;
  }

  let shown = "";

  for (const { segment } of segmenter.segment(text)) {
    if (cellWidth(shown + segment) > width - 1) {
      break;
    }

    shown += segment;
  }

  return width > 0 ? `${shown}…` : "";
}

export type SidebarLine =
  | {
      kind: "heading";
      id: string;
      text: string;
      collapsed: boolean;
      /** What is unread or mentioning the user inside, while collapsed. */
      markers?: ConversationMarkers;
    }
  | { kind: "entry"; entry: SidebarEntry };

/** How the sidebar is laid out: what to list and what is open or collapsed. */
export type SidebarView = {
  /** How many of the most recent DMs to list. */
  recentLimit: number;
  /** List every DM instead of the recent ones. */
  showAll: boolean;
  /** The open conversation, which stays listed even when it is older. */
  openId?: string;
  /** IDs of the collapsed sections (`channels`, `directMessages`, `section:<name>`). */
  collapsed?: ReadonlySet<string>;
  /** Leave muted channels out, unless they have an unread mention or are the open conversation. */
  hideMuted?: boolean;
};

/**
 * The DMs to list, in the order given (newest first): the first
 * `recentLimit`, plus any with unread messages or mentions and the open
 * one, wherever they are; or all of them.
 */
export function visibleDirectMessages(
  directMessages: SidebarEntry[],
  { recentLimit, showAll, openId }: SidebarView,
): SidebarEntry[] {
  if (showAll) {
    return directMessages;
  }

  return directMessages.filter(
    ({ conversation, markers }, index) =>
      index < recentLimit ||
      markers.isUnread ||
      markers.mentions > 0 ||
      conversation.id === openId,
  );
}

/** `Direct messages`, with which DMs are listed: `· 10 of 118` when some are hidden, `· all 118` when all are shown by choice. */
export function directMessagesHeading(
  shown: number,
  total: number,
  showAll: boolean,
): string {
  if (showAll) {
    return `Direct messages · all ${total}`;
  }

  return shown < total
    ? `Direct messages · ${shown} of ${total}`
    : "Direct messages";
}

/** Anything unread in `entries`, and how many mentions they hold in all. */
export function aggregateMarkers(entries: SidebarEntry[]): ConversationMarkers {
  return {
    isUnread: entries.some(({ markers }) => markers.isUnread),
    mentions: entries.reduce((sum, { markers }) => sum + markers.mentions, 0),
  };
}

/** Whether an entry stays listed while muted channels are hidden: any entry that isn't muted, a muted one with a mention, and the open conversation. */
function isListedWhenMuted(
  { conversation, markers, muted }: SidebarEntry,
  { hideMuted, openId }: SidebarView,
): boolean {
  return (
    !hideMuted || !muted || markers.mentions > 0 || conversation.id === openId
  );
}

/**
 * What the sidebar draws, top to bottom: the configured sections, then
 * Channels, then Direct messages, each a heading and its entries. Headings
 * carry a stable `id`, which is not their text (that changes with the DM
 * mode and counts). A collapsed section lists only the open conversation
 * (so it stays visible and selectable) and its heading carries the
 * aggregated markers of everything inside, listed or not. With muted
 * channels hidden, a muted channel is left out unless it has a mention or is
 * the open conversation.
 */
export function sidebarLines(
  { sections, channels, directMessages }: SidebarGroups,
  view: SidebarView = { recentLimit: defaultRecentDms, showAll: false },
): SidebarLine[] {
  const section = (
    id: string,
    text: string,
    all: SidebarEntry[],
    listed: SidebarEntry[] = all,
  ): SidebarLine[] => {
    const collapsed = view.collapsed?.has(id) ?? false;
    const kept = collapsed
      ? listed.filter(({ conversation }) => conversation.id === view.openId)
      : listed.filter((entry) => isListedWhenMuted(entry, view));

    return [
      {
        kind: "heading",
        id,
        text,
        collapsed,
        markers: collapsed ? aggregateMarkers(all) : undefined,
      },
      ...kept.map((entry): SidebarLine => ({ kind: "entry", entry })),
    ];
  };
  const shown = visibleDirectMessages(directMessages, view);

  return [
    ...sections.flatMap(({ id, name, entries }) => section(id, name, entries)),
    ...section("channels", "Channels", channels),
    ...section(
      "directMessages",
      directMessagesHeading(shown.length, directMessages.length, view.showAll),
      directMessages,
      shown,
    ),
  ];
}

/** The key a line is selected by: `heading:<id>` for a heading, the conversation ID for an entry. */
export function lineKey(line: SidebarLine): string {
  return line.kind === "heading"
    ? `heading:${line.id}`
    : line.entry.conversation.id;
}

/** The section ID behind a heading key, or `undefined` for anything else. */
export function headingIdOf(key: string | undefined): string | undefined {
  return key?.startsWith("heading:") ? key.slice("heading:".length) : undefined;
}

/**
 * The runs of a section heading row: the selection marker, a `▾`/`▸`
 * for expanded/collapsed, and the text, cut short to `width`. Bold, in the
 * heading text colour unless something inside a collapsed section is unread
 * (then bold bright, with the mention count as a badge at the right edge, like an entry).
 */
export function headingRow(
  line: Extract<SidebarLine, { kind: "heading" }>,
  state: Omit<SidebarRowState, "open">,
): Run[] {
  const { selected, focused, width } = state;
  const markers = line.markers ?? { isUnread: false, mentions: 0 };
  const entry = entryStyle(markers, { ...state, open: false });
  const isLoud = markers.isUnread || markers.mentions > 0;
  const style = {
    ...entry,
    color:
      isLoud || (selected && focused) ? entry.color : theme.sidebarHeadingText,
    bold: true,
  };
  const prefix = `${selected ? "›" : " "}${line.collapsed ? "▸" : "▾"} `;

  return fillHoverWidth(
    labelRuns(prefix, line.text, markers, style, { width }),
    width,
    { ...state, open: false },
  );
}

/** The keys (see `lineKey`) the selection can land on, in screen order: every heading and listed entry. */
export function selectableIds(lines: SidebarLine[]): string[] {
  return lines.map(lineKey);
}

/** The first conversation among `keys`, so a fresh sidebar starts on something Enter opens; else the first key. */
export function firstSelectable(keys: string[]): string | undefined {
  return keys.find((key) => headingIdOf(key) === undefined) ?? keys[0];
}

/** The selected row, and the rows there were when it was last reconciled. */
export type SidebarSelection = {
  id?: string;
  ids: string[];
  /** Still the starting selection, which waits for a conversation to land on. */
  initial: boolean;
};

/**
 * Where the selection is now that the list may have changed. The selected
 * conversation stays selected while it is listed; once it isn't, the
 * selection moves to the nearest conversation after it in the old list that
 * is still listed, else the nearest before it, else the first.
 */
export function resolveSelection(
  selected: string | undefined,
  previousIds: string[],
  ids: string[],
): string | undefined {
  if (selected !== undefined && ids.includes(selected)) {
    return selected;
  }

  const index = selected === undefined ? -1 : previousIds.indexOf(selected);

  if (index === -1) {
    return firstSelectable(ids);
  }

  return (
    previousIds.slice(index + 1).find((id) => ids.includes(id)) ??
    previousIds
      .slice(0, index)
      .reverse()
      .find((id) => ids.includes(id)) ??
    firstSelectable(ids)
  );
}

/**
 * The first line the sidebar draws, given where it started before: the same
 * line unless the selected line (an entry comes with its group heading, when
 * it opens a group) would fall outside the `height` lines, in which case it moves just
 * far enough to show it.
 */
export function sidebarScrollStart(
  previousStart: number,
  lines: SidebarLine[],
  selectedId: string | undefined,
  height: number,
): number {
  const index = lines.findIndex((line) => lineKey(line) === selectedId);
  const maxStart = Math.max(0, lines.length - height);

  if (index === -1 || height <= 0) {
    return Math.min(previousStart, maxStart);
  }

  const top =
    lines[index]?.kind === "entry" && lines[index - 1]?.kind === "heading"
      ? index - 1
      : index;
  let start = Math.min(previousStart, maxStart);

  if (top < start) {
    start = top;
  }

  if (index >= start + height) {
    start = index - height + 1;
  }

  return Math.min(start, maxStart);
}

/** The lines the sidebar draws, from `start`, in `height` rows. Drawing and hit-testing both use it, so they agree on what is where. */
export function visibleSidebarLines(
  lines: SidebarLine[],
  start: number,
  height: number,
): SidebarLine[] {
  return lines.slice(start, start + Math.max(0, height));
}

/**
 * The line drawn on screen row `row` (0 is the sidebar's top row), or
 * `undefined` for a row with nothing on it.
 */
export function sidebarLineAt(
  lines: SidebarLine[],
  start: number,
  height: number,
  row: number,
): SidebarLine | undefined {
  return row < 0 ? undefined : visibleSidebarLines(lines, start, height)[row];
}

/**
 * Whether a DM or group DM is still waiting for the names of the people in
 * it: the group's members, or any of those people, aren't known yet.
 */
export function needsPeople(
  conversation: Conversation,
  session: Pick<WorkspaceSession, "user" | "conversationMembers">,
): boolean {
  if (conversation.kind === "im") {
    return (
      !!conversation.userId && session.user(conversation.userId) === undefined
    );
  }

  if (conversation.kind !== "mpim") {
    return false;
  }

  const memberIds = session.conversationMembers(conversation.id);

  return (
    memberIds === undefined ||
    memberIds.some((id) => session.user(id) === undefined)
  );
}
