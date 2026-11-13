import { Box } from "ink";
import type { ReactNode } from "react";
import { Text } from "../SafeText";
import { keyVariants } from "../borderLabels";
import { theme } from "../theme";
import { TitledBox } from "../TitledBox";
import type { OverlayFrame } from "./Overlay";

const borderRows = 2;
const promptWidth = 56;

/**
 * Where a prompt popup with `contentRows` rows inside its border sits in an
 * area of `areaWidth` by `areaHeight`: centred across, a fifth of the way
 * down (moved up only as far as keeps it in the area).
 */
export function promptFrame(
  areaWidth: number,
  areaHeight: number,
  contentRows: number,
): OverlayFrame {
  const width = Math.min(areaWidth, promptWidth);
  const height = Math.min(areaHeight, contentRows + borderRows);

  return {
    top: Math.max(0, Math.min(Math.floor(areaHeight / 5), areaHeight - height)),
    left: Math.floor((areaWidth - width) / 2),
    width,
    height,
  };
}

/**
 * A small centred popup holding a one-line input: `title` on the top border,
 * `keys` on the bottom border, the typed text with the cursor drawn under its
 * character, then `children` (completion rows, a message) under it.
 */
export function PromptPopup({
  frame,
  title,
  keys,
  input,
  children,
}: {
  frame: OverlayFrame;
  title: string;
  keys: string;
  input: { text: string; cursor: number };
  children?: ReactNode;
}) {
  const under = input.text.slice(input.cursor, input.cursor + 1);

  return (
    <TitledBox
      frame={{ position: "absolute", top: frame.top, left: frame.left }}
      width={frame.width}
      height={frame.height}
      borderColor={theme.popupBorder}
      background={theme.popupBackground}
      labels={{
        topLeft: { text: title, color: theme.popupTitle, bold: true },
        bottomLeft: { text: keyVariants(keys), color: theme.secondaryText },
      }}
    >
      <Box
        flexDirection="column"
        width={Math.max(0, frame.width - borderRows)}
        height={Math.max(0, frame.height - borderRows)}
        flexShrink={0}
        overflow="hidden"
        paddingLeft={1}
      >
        <Text wrap="truncate" color={theme.text}>
          <Text color={theme.popupTitle}>{"> "}</Text>
          {input.text.slice(0, input.cursor)}
          <Text
            color={theme.cursorText}
            backgroundColor={theme.cursorBackground}
          >
            {under === "" ? " " : under}
          </Text>
          {input.text.slice(input.cursor + 1)}
        </Text>
        {children}
      </Box>
    </TitledBox>
  );
}
