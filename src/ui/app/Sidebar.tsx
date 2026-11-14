import { Box } from "ink";
import type { SocketStatus } from "../../slack/socket";
import { theme } from "../theme";
import { TitledBox } from "../TitledBox";
import { insideBorder, sidebarListHeight } from "./paneLayout";
import { RunsText } from "./RunsText";
import { sidebarStatusLabel } from "./statusLine";
import {
  headingRow,
  lineKey,
  type SidebarLine,
  sidebarRow,
  visibleSidebarLines,
} from "./sidebarEntries";

/**
 * The conversation list, in a titled box (the workspace's name on the top
 * border) of exactly `width` by `height` cells, border included, drawing
 * `lines` from `start` in the rows inside the border, each as wide as the
 * inside. The bottom border shows the connection, the unread check and "muted hidden" (see `sidebarStatusLabel`). The selected line (an entry or a section heading) is highlighted (in the theme's selection colours while the sidebar has focus, a quieter background when not) and marked
 * `›`; the one under the mouse pointer has the hover background; the open one is bold and marked `▌`. Read conversations are in secondary text,
 * ones with new messages bold bright, and ones that mention the user
 * add a red count badge at the right edge (see `sidebarRow`); the name is cut
 * short before the badge is.
 */
export function Sidebar({
  workspaceName,
  connection,
  hideMuted,
  unreadProgress,
  lines,
  start,
  selectedId,
  openId,
  hoveredId,
  width,
  height,
  focused,
}: {
  workspaceName: string;
  /** Drawn on the bottom border in the connection's colour. */
  connection: SocketStatus;
  /** Muted channels are hidden: the bottom border says so. */
  hideMuted: boolean;
  /** How far the startup unread check is, while it runs. */
  unreadProgress?: { done: number; total: number };
  lines: SidebarLine[];
  start: number;
  selectedId?: string;
  openId?: string;
  /** The line under the mouse pointer, drawn in the hover background (the selected line keeps its own). */
  hoveredId?: string;
  width: number;
  height: number;
  focused: boolean;
}) {
  const shown = visibleSidebarLines(lines, start, sidebarListHeight(height));
  const rowWidth = insideBorder(width);
  const color = focused ? theme.focus : theme.border;

  return (
    <TitledBox
      width={width}
      height={height}
      borderColor={color}
      background={theme.sidebarBackground}
      frame={{ flexShrink: 0 }}
      labels={{
        topLeft: { text: workspaceName, color, bold: true },
        bottomLeft: sidebarStatusLabel({
          status: connection,
          unreadProgress,
          hideMuted,
        }),
      }}
    >
      <Box
        flexDirection="column"
        width={rowWidth}
        height={sidebarListHeight(height)}
        overflow="hidden"
      >
        {shown.map((line) => {
          if (line.kind === "heading") {
            return (
              <RunsText
                key={lineKey(line)}
                runs={headingRow(line, {
                  selected: lineKey(line) === selectedId,
                  hovered: lineKey(line) === hoveredId,
                  focused,
                  width: rowWidth,
                })}
              />
            );
          }

          const { conversation } = line.entry;

          return (
            <RunsText
              key={conversation.id}
              runs={sidebarRow(line.entry, {
                selected: conversation.id === selectedId,
                open: conversation.id === openId,
                hovered: conversation.id === hoveredId,
                focused,
                width: rowWidth,
              })}
            />
          );
        })}
      </Box>
    </TitledBox>
  );
}
