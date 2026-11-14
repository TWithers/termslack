import { Box } from "ink";
import { Text } from "../SafeText";
import { theme } from "../theme";
import { CompletionList } from "./CompletionList";
import { InputBox, inputDividerRows } from "./InputBox";
import type { Composer } from "./useComposer";

/**
 * The input lines with the completion list above (while focused and open),
 * an optional one-line notice, such as "also send to #general", then a blank row
 * the pane draws its divider over, then the lines. The height it
 * takes is `composer.height`.
 */
export function ComposerView({
  composer,
  focused,
  placeholder,
  width,
  notice,
  disabledReason,
}: {
  composer: Composer;
  focused: boolean;
  placeholder: string;
  /** The width of the pane's content (inside its border and padding). */
  width: number;
  notice?: string;
  /** Why the box takes no text; it then shows this instead of the placeholder. */
  disabledReason?: string;
}) {
  const { completion } = composer;

  return (
    <Box flexShrink={0} flexDirection="column">
      {focused && completion.entries.length > 0 ? (
        <CompletionList
          entries={completion.entries}
          selected={completion.selected}
          width={Math.min(width, 48)}
        />
      ) : null}
      {notice ? (
        <Text color={theme.warning} wrap="truncate">
          {notice}
        </Text>
      ) : null}
      <Box height={inputDividerRows} />
      <InputBox
        layout={composer.layout}
        focused={focused}
        placeholder={disabledReason ?? placeholder}
        disabled={disabledReason !== undefined}
        width={width}
      />
    </Box>
  );
}
