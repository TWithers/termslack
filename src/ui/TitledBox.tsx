import { Box, type BoxProps } from "ink";
import type { ReactNode } from "react";
import { Text } from "./SafeText";
import {
  fitBorderLabels,
  type BorderLabel,
  type BorderLabels,
} from "./borderLabels";

/** What a label on the border says and how it is drawn. */
export type TitledLabel = {
  text: BorderLabel;
  color: string;
  bold?: boolean;
};

export type TitledBoxLabels = {
  topLeft?: TitledLabel;
  topRight?: TitledLabel;
  bottomLeft?: TitledLabel;
  bottomRight?: TitledLabel;
};

type Place = keyof TitledBoxLabels;

const places: Record<
  Place,
  Pick<BoxProps, "top" | "bottom" | "left" | "right">
> = {
  topLeft: { top: -1, left: 1 },
  topRight: { top: -1, right: 1 },
  bottomLeft: { bottom: -1, left: 1 },
  bottomRight: { bottom: -1, right: 1 },
};

/**
 * A rounded box with labels drawn over its border: up to four, one at each
 * end of the top and bottom borders, with one dash kept beside each corner.
 * `width` and `height` include the border. What fits is decided by
 * `fitBorderLabels`, so a narrow box loses its right-hand labels first, then
 * shortens its keys, and always keeps its corners. `background` fills the
 * inside and the border. `frame` places or sizes the box further (an
 * absolute position, `flexShrink`). The box does not clip, since the labels
 * sit on the border; wrap the content in a box that does if it can overflow.
 *
 * Ink paints children after borders, so a label drawn as an absolute child at
 * row -1 (or +1 from the bottom) overwrites the border cells under it.
 */
export function TitledBox({
  width,
  height,
  borderColor,
  background,
  labels = {},
  frame,
  children,
}: {
  width: number;
  height: number;
  borderColor: string;
  background: string;
  labels?: TitledBoxLabels;
  frame?: Pick<BoxProps, "position" | "top" | "left" | "flexShrink">;
  children?: ReactNode;
}) {
  const fitted = fitBorderLabels(
    Math.max(0, width - 2),
    Object.fromEntries(
      Object.entries(labels).map(([place, label]) => [place, label.text]),
    ) as BorderLabels,
  );

  return (
    <Box
      flexDirection="column"
      {...frame}
      width={width}
      height={height}
      borderStyle="round"
      borderColor={borderColor}
      borderBackgroundColor={background}
      backgroundColor={background}
    >
      {children}
      {(Object.keys(places) as Place[]).map((place) => {
        const label = labels[place];
        const text = fitted[place];

        if (!label || text === undefined) {
          return null;
        }

        return (
          <Box key={place} position="absolute" {...places[place]}>
            <Text
              color={label.color}
              bold={label.bold}
              backgroundColor={background}
            >
              {` ${text} `}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
