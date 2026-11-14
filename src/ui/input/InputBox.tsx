import { Box } from "ink";
import { Text } from "../SafeText";
import { theme } from "../theme";
import type { InputLayout } from "./textInput";

/** Rows an input takes besides its text: the divider above it (drawn by the pane). */
export const inputDividerRows = 1;

/**
 * The lines of what is being typed, with the cursor drawn as a highlighted
 * character while the input has focus. It has no border of its own: the pane
 * draws the divider above it. `layout` is already wrapped and cut to the
 * lines to show (see `layoutInput`), so it is `layout.lines.length` rows tall.
 * An empty input that isn't focused shows `placeholder`.
 */
export function InputBox({
  layout,
  focused,
  placeholder,
  width,
  disabled = false,
}: {
  layout: InputLayout;
  focused: boolean;
  placeholder: string;
  width: number;
  /** Shows `placeholder` whatever the focus, with no cursor: the box takes no text. */
  disabled?: boolean;
}) {
  const { lines, cursor } = layout;
  const isEmpty = lines.length === 1 && lines[0] === "";

  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      {lines.map((line, row) => {
        if (isEmpty && (!focused || disabled)) {
          return (
            <Text key={row} color={theme.secondaryText} wrap="truncate">
              {placeholder}
            </Text>
          );
        }

        if (!focused || row !== cursor.row) {
          return (
            <Text key={row} color={theme.text} wrap="truncate">
              {line === "" ? " " : line}
            </Text>
          );
        }

        const under =
          [...new Intl.Segmenter().segment(line.slice(cursor.offset))][0]
            ?.segment ?? "";

        return (
          <Text key={row} color={theme.text} wrap="truncate">
            {line.slice(0, cursor.offset)}
            <Text
              color={theme.cursorText}
              backgroundColor={theme.cursorBackground}
            >
              {under === "" ? " " : under}
            </Text>
            {line.slice(cursor.offset + under.length)}
          </Text>
        );
      })}
    </Box>
  );
}
