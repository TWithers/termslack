import { Box } from "ink";
import type { PaneRow } from "./paneRows";
import { RunsText } from "./RunsText";
import { theme } from "../theme";

function RowLine({ row }: { row: PaneRow }) {
  return (
    <Box flexShrink={0} height={1}>
      <RunsText runs={row.runs} />
    </Box>
  );
}

/**
 * The messages of the open conversation (or thread): the `rows` in view with
 * the newest at the bottom, in a box of exactly `width` by `height` cells. The
 * rows are already wrapped to fit and already cut to the window: each is one
 * line. The pane's border, title and padding are drawn around it by
 * `ComposedPane`.
 */
export function MessagePane({
  rows,
  width,
  height,
}: {
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
      justifyContent="flex-end"
      backgroundColor={theme.paneBackground}
    >
      {rows.map((row) => (
        <RowLine key={row.key} row={row} />
      ))}
    </Box>
  );
}
