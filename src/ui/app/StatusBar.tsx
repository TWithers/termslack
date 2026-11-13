import { Box } from "ink";
import { Text } from "../SafeText";
import type { ListingHealth } from "../../session/workspaceSession";
import type { SocketStatus } from "../../slack/socket";
import { theme } from "../theme";

const statusColors = (): Record<SocketStatus, string> => ({
  connecting: theme.connecting,
  connected: theme.connected,
  reconnecting: theme.connecting,
  disconnected: theme.disconnected,
});

/** What the status bar says about listings that failed to load, if any. */
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

/** What the status bar says about configured section channels that match nothing, if any. */
export function sectionsWarning(unknownChannels: string[]): string | undefined {
  return unknownChannels.length > 0
    ? `not found in sections: ${unknownChannels.join(", ")}`
    : undefined;
}

/** Everything the status bar warns about, joined, or undefined when there is nothing to say. */
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
  const muted = hideMuted ? "M show (muted hidden)" : "M hide muted";

  return `j/k move · Enter open · m channel menu · ${muted} · x leave · a all DMs · ? help`;
}

/**
 * The keys that act on the selected message, shown while the message pane has
 * focus. Only keys that do something yet; later features add theirs.
 */
export const messageKeyHints =
  "j/k select · PgUp/PgDn page · g/G oldest/newest · Enter/t open or start thread · r react · e edit · d delete · i write · ? help";

/** The keys of the thread pane, which selects messages like the message pane. */
export const threadKeyHints =
  "j/k select · PgUp/PgDn page · g/G first/newest · r react · e edit · d delete · i reply · Esc close thread · ? help";

/** The keys of the reply box under the thread. */
export const threadInputKeyHints =
  "Enter send · Ctrl+T also send to channel · Alt+Enter/Ctrl+J newline · Esc back";

/** The keys of an input that is editing a message. */
export const editKeyHints =
  "Enter save · Alt+Enter/Ctrl+J newline · Esc cancel";

/** The keys that work while the input has focus, where letters type instead of acting. */
export const inputKeyHints = "Enter send · Alt+Enter/Ctrl+J newline · Esc back";

/** One line: workspace, user, connection state, a warning when something failed to load, and key hints for the focused pane. */
export function StatusBar({
  workspaceName,
  userName,
  status,
  warning,
  unreadProgress,
  message,
  prompt,
  hints,
}: {
  workspaceName: string;
  userName: string;
  status: SocketStatus;
  warning?: string;
  /** How far the startup unread check is, while it runs. */
  unreadProgress?: { done: number; total: number };
  /** Why the last action failed, a hint or a one-time note. Shown in red in place of the hints, until the next action. */
  message?: string;
  /** A question the next key answers, e.g. to confirm a delete. Shown in place of the hints. */
  prompt?: string;
  hints?: string;
}) {
  return (
    <Box
      flexShrink={0}
      height={1}
      overflow="hidden"
      backgroundColor={theme.statusBarBackground}
    >
      <Text wrap="truncate" color={theme.statusBarText}>
        {` ${workspaceName} · ${userName} · `}
        <Text color={statusColors()[status]}>{status}</Text>
        {warning ? <Text color={theme.warning}>{` · ${warning}`}</Text> : null}
        {unreadProgress ? (
          <Text
            color={theme.statusBarSecondaryText}
          >{` · Checking for unreads… ${unreadProgress.done}/${unreadProgress.total}`}</Text>
        ) : null}
        {message ? <Text color={theme.error}>{` · ${message}`}</Text> : null}
        {prompt ? (
          <Text color={theme.prompt} bold>{` · ${prompt}`}</Text>
        ) : null}
        {hints && !message && !prompt ? (
          <Text color={theme.statusBarSecondaryText}>{` · ${hints}`}</Text>
        ) : null}
      </Text>
    </Box>
  );
}
