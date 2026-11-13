import { Box } from "ink";
import type { ReactNode } from "react";
import { Text } from "../SafeText";
import { theme } from "../theme";

/**
 * The bottom prompt's one line, shared by the reaction and section prompts:
 * a title, what is typed with the cursor drawn under its character, then
 * `children` (what Enter will do, a refusal, hints). `above` is drawn over
 * the line, inside the same popup block.
 */
export function BottomPromptLine({
  title,
  input,
  above,
  children,
}: {
  title: string;
  input: { text: string; cursor: number };
  above?: ReactNode;
  children?: ReactNode;
}) {
  const under = input.text.slice(input.cursor, input.cursor + 1);

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      paddingLeft={1}
      backgroundColor={theme.popupBackground}
    >
      {above}
      <Text wrap="truncate" color={theme.text}>
        <Text color={theme.popupTitle}>{title}</Text>
        {input.text.slice(0, input.cursor)}
        <Text color={theme.cursorText} backgroundColor={theme.cursorBackground}>
          {under === "" ? " " : under}
        </Text>
        {input.text.slice(input.cursor + 1)}
        {children}
      </Text>
    </Box>
  );
}
