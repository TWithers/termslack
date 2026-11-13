import { Text } from "../SafeText";
import { theme } from "../theme";
import type { OverlayFrame } from "./Overlay";
import { PromptPopup } from "./PromptPopup";
import type { SectionPrompt as SectionPromptState } from "./useSectionPrompt";

/** What the keys do while the prompt is open, drawn on its bottom border. */
export const sectionKeyHints = "Enter create · Esc cancel";

/**
 * The "New section" popup: the typed name, then why Enter was refused, if it
 * was.
 */
export function SectionPrompt({
  prompt,
  frame,
}: {
  prompt: SectionPromptState;
  frame: OverlayFrame;
}) {
  const { input, refusal } = prompt;

  return (
    <PromptPopup
      frame={frame}
      title="New section"
      keys={sectionKeyHints}
      input={input}
    >
      {refusal ? (
        <Text wrap="truncate" color={theme.error}>
          {refusal}
        </Text>
      ) : (
        <Text color={theme.secondaryText}>{"name the section"}</Text>
      )}
    </PromptPopup>
  );
}
