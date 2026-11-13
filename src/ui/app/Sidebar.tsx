import { Box } from "ink";
import { theme } from "../theme";
import { RunsText } from "./RunsText";
import {
  headingRow,
  lineKey,
  type SidebarLine,
  sidebarRow,
  visibleSidebarLines,
} from "./sidebarEntries";

/**
 * The conversation list, in a box of exactly `width` by `height` cells,
 * drawing `lines` from `start`. The selected line (an entry or a section heading) is highlighted (in the theme's selection colours while the sidebar has focus, a quieter background when not) and marked
 * `›`; the one under the mouse pointer has the hover background; the open one is bold and marked `▌`. Read conversations are in secondary text,
 * ones with new messages bold bright, and ones that mention the user
 * add a red count badge at the right edge (see `sidebarRow`); the name is cut
 * short before the badge is.
 */
export function Sidebar({
  lines,
  start,
  selectedId,
  openId,
  hoveredId,
  width,
  height,
  focused,
}: {
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
  const shown = visibleSidebarLines(lines, start, height);

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      flexShrink={0}
      overflow="hidden"
      backgroundColor={theme.sidebarBackground}
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
                width,
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
              width,
            })}
          />
        );
      })}
    </Box>
  );
}
