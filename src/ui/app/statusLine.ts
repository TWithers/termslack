import type { ListingHealth } from "../../session/workspaceSession";
import type { SocketStatus } from "../../slack/socket";
import { keyVariants } from "../borderLabels";
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

/** The keys of an input that is editing a message. */
export const editKeyHints =
  "Enter save · Alt+Enter/Ctrl+J newline · Esc cancel";

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
 * has focus, shortened as the border narrows (`keyVariants`). Nothing when
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
    return { text: question, color: theme.prompt, bold: true };
  }

  const notice = notices.filter(Boolean).join(" · ");

  if (notice !== "") {
    return { text: notice, color: theme.warning };
  }

  if (!keys) {
    return undefined;
  }

  return { text: keyVariants(keys), color: theme.secondaryText };
}

/**
 * The sidebar's bottom border: the connection (in its colour), then the
 * unread check while it runs, then "muted hidden" while that is on, as space
 * allows. The sidebar is narrow, so the check has a short form ("Unreads
 * 12/44") that is tried before the muted note is dropped, and the connection
 * always stays.
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
  const checking = count ? `Checking unreads ${count}` : undefined;
  const unreads = count ? `Unreads ${count}` : undefined;
  const muted = hideMuted ? "muted hidden" : undefined;
  const forms = [
    [connection, checking, muted],
    [connection, checking],
    [connection, unreads, muted],
    [connection, unreads],
    [connection, muted],
    [connection],
  ].map((parts) => parts.filter(Boolean).join(" · "));

  return {
    text: [...new Set(forms)],
    color: theme.secondaryText,
    lead: { text: connection, color: connectionColor(status) },
  };
}
