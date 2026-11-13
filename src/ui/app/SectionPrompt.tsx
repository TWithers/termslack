import { Text } from "../SafeText";
import { theme } from "../theme";
import { BottomPromptLine } from "./BottomPromptLine";
import type { SectionPrompt as SectionPromptState } from "./useSectionPrompt";

/** What the keys do while the prompt is open; also shown by the status bar. */
export const sectionKeyHints = "Enter create · Esc cancel";

/**
 * The new section's name prompt, drawn across the bottom above the status
 * bar: one line with what is typed, then why Enter was refused, if it was.
 */
export function SectionPrompt({ prompt }: { prompt: SectionPromptState }) {
  const { input, refusal } = prompt;

  return (
    <BottomPromptLine title="New section: " input={input}>
      {refusal ? (
        <Text color={theme.error}>{`  ${refusal}`}</Text>
      ) : (
        <Text color={theme.secondaryText}>{"  Enter creates"}</Text>
      )}
      <Text color={theme.secondaryText}>{"  · Esc cancels"}</Text>
    </BottomPromptLine>
  );
}
