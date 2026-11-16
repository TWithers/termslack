import type { ListingHealth } from "../../session/workspaceSession";
import type { SocketStatus } from "../../slack/socket";
import {
  borderLabelRoom,
  keepEndingVariants,
  keyVariants,
} from "../borderLabels";
import { cellWidth } from "../terminalSafeText";
import { theme } from "../theme";
import type { TitledLabel } from "../TitledBox";

/** What the status line says about listings that failed to load, if any. */
export function listingWarning(health: ListingHealth): string | undefined {
  const problems = [
    ["channel list", health.conversations],
    ["people", health.people],
  ].flatMap(([name, status]) => {
    if (status === "retrying") {
      return [`couldn't load ${name} — retrying`];
    }

    return status === "failed" ? [`couldn't load ${name}`] : [];
  });

  return problems.length > 0 ? problems.join(" · ") : undefined;
}

/** What the status line says about configured section channels that match nothing, if any. */
export function sectionsWarning(unknownChannels: string[]): string | undefined {
  return unknownChannels.length > 0
    ? `not found in sections: ${unknownChannels.join(", ")}`
    : undefined;
}

/** Everything the status line warns about, joined, or undefined when there is nothing to say. */
export function statusWarning(
  health: ListingHealth,
  unknownChannels: string[],
): string | undefined {
  return (
    [
      listingWarning(health),
      health.conversations === "loaded"
        ? sectionsWarning(unknownChannels)
        : undefined,
    ]
      .filter(Boolean)
      .join(" · ") || undefined
  );
}

/** The keys of the sidebar; while muted channels are hidden it says so, so a missing channel has an explanation. */
export function sidebarKeyHints(hideMuted = false): string {
  const muted = hideMuted ? "M show muted" : "M hide muted";

  return `j/k move · Enter open · m channel menu · ${muted} · x leave · a all DMs · ? help`;
}

/**
 * The keys that act on the selected message, shown while the message pane has
 * focus. Only keys that do something yet; later features add theirs.
 */
export const messageKeyHints =
  "j/k select · i write · Enter/t open or start thread · r react · e edit · d delete · PgUp/PgDn page · g/G oldest/newest · ? help";

/** The keys of the thread pane, which selects messages like the message pane. */
export const threadKeyHints =
  "j/k select · i reply · r react · e edit · d delete · PgUp/PgDn page · g/G first/newest · ? help · Esc close thread";

/** The keys of the reply box under the thread. */
export const threadInputKeyHints =
  "Enter send · Ctrl+T also send to channel · Alt+Enter/Ctrl+J newline · Esc back";

/**
 * The keys of an input that is editing a message. Shortened as the border
 * narrows, it becomes "Editing — Enter saves · Esc cancels".
 */
export const editKeyHints =
  "Editing — Enter saves · Alt+Enter/Ctrl+J newline · Esc cancels";

/** Whether the shortest form of `keys` fits a bottom border `outerWidth` columns wide (corners included). */
export function keysFitBorder(keys: string, outerWidth: number): boolean {
  return (
    cellWidth(keyVariants(keys).at(-1)!) <= borderLabelRoom(outerWidth - 2)
  );
}

/** The keys that work while the input has focus, where letters type instead of acting. */
export const inputKeyHints = "Enter send · Alt+Enter/Ctrl+J newline · Esc back";

/** The colour a connection state is drawn in. */
export function connectionColor(status: SocketStatus): string {
  return {
    connecting: theme.connecting,
    connected: theme.connected,
    reconnecting: theme.connecting,
    disconnected: theme.disconnected,
  }[status];
}

/** The word shown for a connection state. */
export function connectionWord(status: SocketStatus): string {
  return status === "disconnected" ? "offline" : status;
}

/**
 * The message pane's bottom border: a question first (the prompt colour), else
 * the notices and warnings joined (the warning colour), else the keys of what
 * has focus (the keys stand out from what they do), shortened as the border
 * narrows (`keyVariants`). Nothing when
 * there is none of these.
 */
export function statusLineLabel({
  question,
  notices,
  keys,
}: {
  question?: string;
  notices: (string | undefined)[];
  keys?: string;
}): TitledLabel | undefined {
  if (question) {
    const ending = question.endsWith("? y/n") ? "? y/n" : " y/n";

    return {
      text: keepEndingVariants(question, ending),
      color: theme.prompt,
      bold: true,
    };
  }

  const notice = notices.filter(Boolean).join(" · ");

  if (notice !== "") {
    return { text: notice, color: theme.warning };
  }

  if (!keys) {
    return undefined;
  }

  return {
    text: keyVariants(keys),
    color: theme.secondaryText,
    keyColor: theme.keyHintText,
  };
}

/**
 * The sidebar's bottom border: the connection (in its colour), then "muted
 * hidden" while that is on (it explains channels that are missing, above all
 * at startup), then the unread check's progress while it runs, in the longest
 * form that fits ("Checking unreads 12/44", "Unreads 12/44", "12/44"). The
 * sidebar is narrow, so the progress is what gives way; the connection always
 * stays.
 */
export function sidebarStatusLabel({
  status,
  unreadProgress,
  hideMuted,
}: {
  status: SocketStatus;
  unreadProgress?: { done: number; total: number };
  hideMuted: boolean;
}): TitledLabel {
  const connection = `● ${connectionWord(status)}`;
  const count = unreadProgress
    ? `${unreadProgress.done}/${unreadProgress.total}`
    : undefined;
  const muted = hideMuted ? "muted hidden" : undefined;
  const progressForms = count
    ? [`Checking unreads ${count}`, `Unreads ${count}`, count]
    : [];
  const forms = [...progressForms, undefined].map((progress) =>
    [connection, muted, progress].filter(Boolean).join(" · "),
  );

  if (muted) {
    forms.push(connection);
  }

  return {
    text: [...new Set(forms)],
    color: theme.secondaryText,
    lead: { text: connection, color: connectionColor(status) },
  };
}
