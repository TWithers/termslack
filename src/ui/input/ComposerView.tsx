import { Box } from "ink";
import { Text } from "../SafeText";
import { theme } from "../theme";
import { CompletionList } from "./CompletionList";
import { InputBox } from "./InputBox";
import type { Composer } from "./useComposer";

/**
 * An input box with its completion list above it (while focused and open) and
 * an optional one-line notice, such as "also send to #general". The height it
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
  /** The pane's width. */
  width: number;
  notice?: string;
  /** Why the box takes no text; it then shows this instead of the placeholder. */
  disabledReason?: string;
}) {
  const { completion } = composer;

  return (
    <Box paddingLeft={1} flexShrink={0} flexDirection="column">
      {focused && completion.entries.length > 0 ? (
        <CompletionList
          entries={completion.entries}
          selected={completion.selected}
          width={Math.min(width - 1, 48)}
        />
      ) : null}
      {notice ? (
        <Text color={theme.warning} wrap="truncate">
          {notice}
        </Text>
      ) : null}
      <InputBox
        layout={composer.layout}
        focused={focused}
        placeholder={disabledReason ?? placeholder}
        disabled={disabledReason !== undefined}
        width={width - 1}
      />
    </Box>
  );
}
