import { Box } from "ink";
import { Text } from "../SafeText";
import type { CompletionEntry } from "../../session/mentions";
import { theme } from "../theme";

/** Rows the list takes besides its entries: the top and bottom border. */
export const completionListChrome = 2;

/**
 * The completion list, drawn just above the input: one entry per row with
 * the chosen one highlighted, and the person's real name (or the group's
 * name) dimmed after the handle.
 */
export function CompletionList({
  entries,
  selected,
  width,
}: {
  entries: CompletionEntry[];
  selected: number;
  width: number;
}) {
  return (
    <Box
      flexDirection="column"
      width={width}
      flexShrink={0}
      borderStyle="round"
      borderColor={theme.border}
      borderBackgroundColor={theme.popupBackground}
      backgroundColor={theme.popupBackground}
      paddingX={1}
    >
      {entries.map((entry, row) => (
        <Text
          key={entry.slack}
          wrap="truncate"
          color={row === selected ? theme.selectionText : theme.text}
          backgroundColor={
            row === selected ? theme.selectionBackground : undefined
          }
        >
          {entry.label}
          {entry.detail ? (
            <Text
              color={
                row === selected ? theme.selectionText : theme.secondaryText
              }
            >
              {" "}
              {entry.detail}
            </Text>
          ) : null}
        </Text>
      ))}
    </Box>
  );
}
