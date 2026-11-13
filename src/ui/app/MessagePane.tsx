import { Box } from "ink";
import { Text } from "../SafeText";
import type { Presence } from "../../session/events";
import type { PaneRow } from "./paneRows";
import { RunsText } from "./RunsText";
import { theme } from "../theme";
import { presenceRun } from "./sidebarEntries";

function RowLine({ row }: { row: PaneRow }) {
  return (
    <Box flexShrink={0} height={1}>
      <RunsText runs={row.runs} />
    </Box>
  );
}

/**
 * The open conversation: its title (marked when the pane has focus, with a
 * hint when messages arrived below the view), then the `rows` in view with the
 * newest at the bottom, in a box of exactly `width` by `height` cells. The
 * rows are already wrapped to fit and already cut to the window: each is one
 * line.
 */
export function MessagePane({
  title,
  presence,
  focused,
  hasNewBelow,
  status,
  rows,
  width,
  height,
}: {
  title: string;
  /** Whether the person of an open DM is active or away; drawn before the title, nothing while unknown. */
  presence?: Presence;
  focused: boolean;
  hasNewBelow: boolean;
  /** A line about fetching older messages, shown beside the title; takes the place of the new-messages hint. */
  status?: { text: string; color?: string };
  rows: PaneRow[];
  width: number;
  height: number;
}) {
  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      flexShrink={0}
      overflow="hidden"
      paddingLeft={1}
      backgroundColor={theme.paneBackground}
    >
      <Box flexShrink={0} height={1}>
        <Box flexShrink={1}>
          <Text
            bold
            color={focused ? theme.focus : theme.brightText}
            wrap="truncate"
          >
            {focused ? "▌ " : ""}
            {presence ? (
              <>
                <Text bold={false} color={presenceRun(presence).color}>
                  {presenceRun(presence).text}
                </Text>{" "}
              </>
            ) : null}
            {title}
          </Text>
        </Box>
        {status ? (
          <Box flexShrink={0} marginLeft={2}>
            <Text color={status.color ?? theme.secondaryText} wrap="truncate">
              {status.text}
            </Text>
          </Box>
        ) : hasNewBelow ? (
          <Box flexShrink={0} marginLeft={2}>
            <Text color={theme.newMessages} wrap="truncate">
              ↓ new messages below
            </Text>
          </Box>
        ) : null}
      </Box>
      <Box
        flexDirection="column"
        flexGrow={1}
        justifyContent="flex-end"
        overflow="hidden"
      >
        {rows.map((row) => (
          <RowLine key={row.key} row={row} />
        ))}
      </Box>
    </Box>
  );
}
