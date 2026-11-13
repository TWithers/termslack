import { Text } from "../SafeText";
import { emojify } from "../../session/emoji";
import type { EmojiLookup } from "../../session/emoji";
import { theme } from "../theme";
import { CompletionList } from "../input/CompletionList";
import { BottomPromptLine } from "./BottomPromptLine";
import type { ReactionPrompt as ReactionPromptState } from "./useReactionPrompt";

/** What the keys do while the prompt is open; also shown by the status bar. */
export const reactionKeyHints =
  "Enter react · Up/Down choose · Tab fill in · Esc cancel";

/**
 * The emoji prompt `r` opens, drawn across the bottom above the status bar:
 * the completion list, then one line with what is typed and what Enter will
 * do (`adds` a reaction, or `removes` one the user already has).
 */
export function ReactionPrompt({
  prompt,
  lookup,
  width,
}: {
  prompt: ReactionPromptState;
  lookup: EmojiLookup;
  width: number;
}) {
  const { input, entries, selected, choice } = prompt;
  const shortcode = choice ? `:${choice.name}:` : "";
  const glyph = emojify(shortcode, lookup);

  return (
    <BottomPromptLine
      title="React with: "
      input={input}
      above={
        entries.length > 0 ? (
          <CompletionList
            entries={entries}
            selected={selected}
            width={Math.min(width - 1, 48)}
          />
        ) : null
      }
    >
      {choice ? (
        <Text color={theme.prompt}>
          {`  Enter ${choice.removes ? "removes" : "adds"} ${shortcode}${glyph === shortcode ? "" : ` ${glyph}`}`}
        </Text>
      ) : (
        <Text color={theme.secondaryText}>{"  type an emoji name"}</Text>
      )}
      <Text color={theme.secondaryText}>{"  · Esc cancels"}</Text>
    </BottomPromptLine>
  );
}
