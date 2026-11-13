import { Box } from "ink";
import { conversationTitle } from "../../session/people";
import type {
  SearchResult,
  WorkspaceSession,
} from "../../session/workspaceSession";
import { authorColour } from "../authorColour";
import { messageAuthor } from "../messageFormat";
import { theme } from "../theme";
import type { OverlayItem } from "./Overlay";
import { bodyLines, clock, dayKey } from "./paneRows";
import { RunsText } from "./RunsText";
import { sidebarEntry } from "./sidebarEntries";
import type { Run } from "./wrap";

/** What the keys do while the search overlay is open; drawn on its bottom border. */
export const searchKeyHints =
  "type a query · Enter search or open · ↑/↓ choose · PgUp/PgDn page · Esc close";

/** The most lines of a message's text a result shows. */
const textLines = 3;

/** Rows every result takes: its header, the text lines, and a blank line between results. */
export const searchResultHeight = textLines + 2;

/** The conversation as the sidebar names it; for one termslack doesn't know, the name Slack gave, else its ID. */
function conversationText(
  { message, channelName }: SearchResult,
  session: WorkspaceSession,
): string {
  const conversation = session.conversation(message.channelId);

  if (conversation) {
    return sidebarEntry(conversation, session).label;
  }

  return channelName
    ? conversationTitle("channel", channelName)
    : message.channelId;
}

function whenText(ts: string): string {
  return `${dayKey(new Date(Number.parseFloat(ts) * 1000))} ${clock(ts)}`;
}

/** The lines of a result in `width` columns: its header, then the start of its text as the message pane renders it. */
export function searchResultLines(
  result: SearchResult,
  session: WorkspaceSession,
  width: number,
): Run[][] {
  const { message } = result;
  const header: Run[] = [
    {
      text: conversationText(result, session),
      color: theme.popupTitle,
      bold: true,
    },
    { text: " · ", color: theme.secondaryText },
    {
      text: messageAuthor(message, session),
      color: authorColour(message, session, theme.popupBackground),
      bold: true,
    },
    { text: " · ", color: theme.secondaryText },
    { text: whenText(message.ts), color: theme.timestampText },
    ...(message.threadTs !== undefined && message.threadTs !== message.ts
      ? [{ text: " · reply in thread", color: theme.secondaryText }]
      : []),
  ];
  const body = bodyLines(message, session, width);
  const shown = body.slice(0, textLines);

  if (body.length > textLines) {
    shown[textLines - 1] = [
      ...shown[textLines - 1]!,
      { text: " …", color: theme.secondaryText },
    ];
  }

  return [header, ...shown];
}

/** One result as an overlay item of `searchResultHeight` rows. */
export function searchItem(
  result: SearchResult,
  session: WorkspaceSession,
  width: number,
): OverlayItem {
  return {
    key: `${result.message.channelId}:${result.message.ts}`,
    node: (
      <Box flexDirection="column" flexShrink={1} overflow="hidden">
        {searchResultLines(result, session, width).map((runs, index) => (
          <Box key={index} flexShrink={0} height={1}>
            <RunsText runs={runs} />
          </Box>
        ))}
      </Box>
    ),
  };
}
