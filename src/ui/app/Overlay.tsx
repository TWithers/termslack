import { Box } from "ink";
import { Text } from "../SafeText";
import type { ReactNode } from "react";
import type { InputState } from "../input/textInput";
import { theme } from "../theme";

/** One item of an overlay's list: one row, or `itemHeight` rows when the overlay says so. */
export type OverlayItem = {
  key: string;
  /** What the item shows, within its rows: one line each, nothing wraps. */
  node: ReactNode;
};

/** A line standing in for the list while it has no items ("No messages match", a refusal). */
export type OverlayMessage = { text: string; color?: string };

/** The columns a selectable row spends before its content: the padding and the `› ` marker. */
export const selectableRowIndent = 3;

/** Columns an overlay pads its list on the left. */
export const overlayPadding = 1;

/** Rows an overlay spends on its title, and on its filter line when it has one. */
export function overlayChrome(hasFilter: boolean): number {
  return hasFilter ? 2 : 1;
}

/** How big a popup is: `compact` for the quick switcher, `large` for the help and search results. */
export type OverlaySize = "compact" | "large";

const borderRows = 2;
const compactWidth = 60;
const compactListRows = 10;
const minLargeWidth = 50;
const minLargeHeight = 12;

export type OverlayFrame = {
  top: number;
  left: number;
  /** Border included. */
  width: number;
  height: number;
};

/**
 * Where a popup of `size` sits in an area of `areaWidth` by `areaHeight`.
 * Compact is about 60 columns wide with room for ten results, a fifth of the
 * way down; large is 80% of the area, centred. A small area makes either
 * grow to fill it rather than shrink below a usable size.
 */
export function overlayFrame(
  size: OverlaySize,
  areaWidth: number,
  areaHeight: number,
): OverlayFrame {
  const width = Math.min(
    areaWidth,
    size === "compact"
      ? compactWidth
      : Math.max(minLargeWidth, Math.floor(areaWidth * 0.8)),
  );
  const height = Math.min(
    areaHeight,
    size === "compact"
      ? borderRows + overlayChrome(true) + compactListRows
      : Math.max(minLargeHeight, Math.floor(areaHeight * 0.8)),
  );
  const left = Math.floor((areaWidth - width) / 2);
  const top =
    size === "compact"
      ? Math.min(Math.floor(areaHeight / 5), areaHeight - height)
      : Math.floor((areaHeight - height) / 2);

  return { top, left, width, height };
}

/** Where a compact popup's top left corner would like to be, in the area's own rows and columns. */
export type OverlayAnchor = { top: number; left: number };

/**
 * The rectangle a popup is drawn in: `overlayFrame`, except that a compact
 * popup shrinks to its rows (keeping at least one), from the same top.
 * `remainingItems` is how many items are left from the first one shown. With
 * an `anchor`, a compact popup starts there instead of at its usual place,
 * moved up and left only as far as keeps it on the screen.
 */
export function overlayBox(
  size: OverlaySize,
  areaWidth: number,
  areaHeight: number,
  {
    hasFilter,
    remainingItems,
    anchor,
  }: { hasFilter: boolean; remainingItems: number; anchor?: OverlayAnchor },
): OverlayFrame {
  const frame = overlayFrame(size, areaWidth, areaHeight);

  if (size === "large") {
    return frame;
  }

  const height = Math.min(
    frame.height,
    borderRows + overlayChrome(hasFilter) + Math.max(1, remainingItems),
  );

  if (!anchor) {
    return { ...frame, height };
  }

  return {
    ...frame,
    height,
    top: Math.max(0, Math.min(anchor.top, areaHeight - height)),
    left: Math.max(0, Math.min(anchor.left, areaWidth - frame.width)),
  };
}

/** How many whole items of `itemHeight` rows a popup `height` tall (border included) shows. */
export function overlayShownItems(
  height: number,
  hasFilter: boolean,
  itemHeight = 1,
): number {
  const listHeight = Math.max(
    0,
    height - borderRows - overlayChrome(hasFilter),
  );

  return Math.floor(listHeight / itemHeight);
}

/**
 * The item drawn at `column`, `row` of a popup, both counted from its top
 * left corner (border included), or undefined for the border, title, filter
 * line and blank space. It uses the same numbers `Overlay` draws with:
 * `height` is the popup's height, `start` the first item shown, `count` how
 * many items there are. An item of several rows owns all of them.
 */
export function overlayItemAt(
  { width, height }: { width: number; height: number },
  {
    hasFilter,
    itemHeight = 1,
    start,
    count,
  }: { hasFilter: boolean; itemHeight?: number; start: number; count: number },
  column: number,
  row: number,
): number | undefined {
  if (column < 1 || column > width - 2) {
    return undefined;
  }

  const listRow = row - 1 - overlayChrome(hasFilter);

  if (listRow < 0) {
    return undefined;
  }

  const offset = Math.floor(listRow / itemHeight);
  const shown = Math.min(
    overlayShownItems(height, hasFilter, itemHeight),
    count - start,
  );

  return offset < shown ? start + offset : undefined;
}

/** Columns inside a popup's border. */
export function overlayInnerWidth(
  size: OverlaySize,
  areaWidth: number,
  areaHeight: number,
): number {
  return Math.max(
    0,
    overlayFrame(size, areaWidth, areaHeight).width - borderRows,
  );
}

/** Rows inside a popup's border: what the title, filter line and list share. */
export function overlayInnerHeight(
  size: OverlaySize,
  areaWidth: number,
  areaHeight: number,
): number {
  return Math.max(
    0,
    overlayFrame(size, areaWidth, areaHeight).height - borderRows,
  );
}

/**
 * A popup drawn over the panes, in an area of `areaWidth` by `areaHeight`:
 * a bordered box with a title, an optional filter line, and a list showing
 * the rows from `start`, with the item at `selected` highlighted when
 * `selected` is given. The help screen is just the list; the quick switcher
 * and search add the filter line and the selection. The caller owns the
 * state and the keys.
 *
 * Ink paints onto one grid and does not clear what is under a box, so the
 * box paints the popup background over everything inside its border, blank
 * rows and padding included, and the rows are drawn on top.
 */
export function Overlay({
  size,
  title,
  filter,
  items,
  start,
  selected,
  itemHeight = 1,
  message,
  anchor,
  areaWidth,
  areaHeight,
}: {
  size: OverlaySize;
  title: string;
  /** The filter line's text and cursor. Omitted: no filter line. */
  filter?: InputState;
  items: OverlayItem[];
  start: number;
  /** Index of the highlighted item. Omitted: nothing is highlighted. */
  selected?: number;
  /** Rows every item takes, for items of several lines (search results). Only whole items are shown. Default 1. */
  itemHeight?: number;
  /** Shown in place of the list when there are no items. */
  message?: OverlayMessage;
  /** Where a compact popup starts, instead of its usual place. */
  anchor?: OverlayAnchor;
  areaWidth: number;
  areaHeight: number;
}) {
  const { top, left, width, height } = overlayBox(size, areaWidth, areaHeight, {
    hasFilter: filter !== undefined,
    remainingItems: items.length - start,
    anchor,
  });
  const innerWidth = Math.max(0, width - borderRows);
  const innerHeight = Math.max(0, height - borderRows);
  const shown = items.slice(
    start,
    start + overlayShownItems(height, filter !== undefined, itemHeight),
  );
  const under = filter?.text.slice(filter.cursor, filter.cursor + 1) ?? "";

  return (
    <Box
      position="absolute"
      top={top}
      left={left}
      width={width}
      height={height}
      borderStyle="round"
      borderColor={theme.popupBorder}
      borderBackgroundColor={theme.popupBackground}
      flexDirection="column"
      overflow="hidden"
      backgroundColor={theme.popupBackground}
    >
      <Box
        flexDirection="column"
        width={innerWidth}
        height={innerHeight}
        flexShrink={0}
        overflow="hidden"
        paddingLeft={overlayPadding}
      >
        <Text wrap="truncate" bold color={theme.popupTitle}>
          {title}
        </Text>
        {filter ? (
          <Text wrap="truncate" color={theme.text}>
            <Text color={theme.popupTitle}>{"> "}</Text>
            {filter.text.slice(0, filter.cursor)}
            <Text
              color={theme.cursorText}
              backgroundColor={theme.cursorBackground}
            >
              {under === "" ? " " : under}
            </Text>
            {filter.text.slice(filter.cursor + 1)}
          </Text>
        ) : null}
        {shown.map((item, offset) => (
          <Box
            key={item.key}
            flexShrink={0}
            height={itemHeight}
            overflow="hidden"
          >
            {selected === undefined ? null : (
              <Text color={theme.highlightedRowMarker}>
                {start + offset === selected ? "› " : "  "}
              </Text>
            )}
            {item.node}
          </Box>
        ))}
        {items.length === 0 && message ? (
          <Text wrap="truncate" color={message.color ?? theme.secondaryText}>
            {message.text}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}
