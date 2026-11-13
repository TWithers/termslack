import { Text } from "../SafeText";
import { emojify } from "../../session/emoji";
import type { EmojiLookup } from "../../session/emoji";
import { theme } from "../theme";
import { CompletionRows } from "../input/CompletionList";
import type { OverlayFrame } from "./Overlay";
import { PromptPopup } from "./PromptPopup";
import type { ReactionPrompt as ReactionPromptState } from "./useReactionPrompt";

/** What the keys do while the prompt is open, drawn on its bottom border. */
export const reactionKeyHints =
  "Enter add · ↑/↓ choose · Tab complete · Esc cancel";

/**
 * The "Add reaction" popup `r` opens: the typed emoji name, the matches
 * under it, then what Enter will do (`adds` a reaction, or `removes` one the
 * user already has).
 */
export function ReactionPrompt({
  prompt,
  lookup,
  frame,
}: {
  prompt: ReactionPromptState;
  lookup: EmojiLookup;
  frame: OverlayFrame;
}) {
  const { input, entries, selected, choice } = prompt;
  const shortcode = choice ? `:${choice.name}:` : "";
  const glyph = emojify(shortcode, lookup);

  return (
    <PromptPopup
      frame={frame}
      title="Add reaction"
      keys={reactionKeyHints}
      input={input}
    >
      <CompletionRows entries={entries} selected={selected} />
      {choice ? (
        <Text wrap="truncate" color={theme.prompt}>
          {`Enter ${choice.removes ? "removes" : "adds"} ${shortcode}${glyph === shortcode ? "" : ` ${glyph}`}`}
        </Text>
      ) : (
        <Text color={theme.secondaryText}>{"type an emoji name"}</Text>
      )}
    </PromptPopup>
  );
}
