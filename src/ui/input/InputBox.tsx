import { Box } from "ink";
import { Text } from "../SafeText";
import { theme } from "../theme";
import type { InputLayout } from "./textInput";

/** Rows an input box takes besides its text: the top and bottom border. */
export const inputBoxChrome = 2;

/** Cells the box takes beside its text: border and padding on both sides. */
export const inputBoxSideChrome = 4;

/**
 * A bordered box showing what is being typed, with the cursor drawn as an
 * highlighted character while the box has focus. `layout` is already wrapped and
 * cut to the lines to show (see `layoutInput`), so the box is
 * `layout.lines.length + inputBoxChrome` rows tall; the owner needs that
 * number to lay out the rest of the screen. An empty box that isn't focused
 * shows `placeholder`.
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
    <Box
      flexDirection="column"
      width={width}
      flexShrink={0}
      borderStyle="round"
      borderColor={focused ? theme.focus : theme.border}
      borderBackgroundColor={theme.inputBoxBackground}
      backgroundColor={theme.inputBoxBackground}
      paddingX={1}
    >
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
