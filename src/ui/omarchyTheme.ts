import { legibleOn, mixColours } from "./colour";
import type { OmarchyPalette } from "./omarchyPalettes";
import type { Theme } from "./theme";

/**
 * Turns an Omarchy palette into termslack's full theme, the way Omarchy's own app
 * templates do: most values come straight from a palette key, the in-between
 * shades are mixes of two palette colours. Themes repurpose colour names on
 * purpose, so the palette's colours are used as they are, except that text
 * which would not read on its background is made to (`legibleOn`).
 */
export function themeFromPalette(palette: OmarchyPalette): Theme {
  const { mode, background, foreground, accent, selection, muted } = palette;
  const { red, yellow, green, cyan, blue, magenta } = palette;
  const isLight = mode === "light";

  const paneBackground = background;
  const sidebarBackground = palette.darkBackground;
  const popupBackground = palette.lighterBackground;

  /** Tints for highlights: faint on dark backgrounds, a little stronger on light ones where the same amount hardly shows. */
  const tint = (colour: string) =>
    mixColours(background, colour, isLight ? 0.3 : 0.2);
  const faint = mixColours(background, foreground, isLight ? 0.1 : 0.08);

  /** Text sits on every background, so it must read on the hardest of them. */
  const onEveryBackground = (colour: string) =>
    [paneBackground, sidebarBackground, popupBackground].reduce(
      legibleOn,
      colour,
    );

  const text = onEveryBackground(foreground);
  const brightText = onEveryBackground(palette.brightForeground);
  const secondaryText = onEveryBackground(
    mixColours(foreground, background, 0.4),
  );
  const mutedChannelText = onEveryBackground(
    mixColours(foreground, background, 0.5),
  );
  const selectionText = legibleOn(palette.brightForeground, selection);
  const mentionOfYouBackground = tint(yellow);
  const mentionBackground = tint(blue);
  const ownReactionBackground = selection;

  return {
    paneBackground,
    sidebarBackground,
    sidebarHoverBackground: mixColours(sidebarBackground, foreground, 0.1),
    popupBackground,

    text,
    secondaryText,
    mutedChannelText,
    brightText,
    sidebarHeadingText: legibleOn(palette.lightForeground, sidebarBackground),

    selectionBackground: selection,
    selectionText,
    unfocusedSelectionBackground: mixColours(sidebarBackground, selection, 0.5),
    highlightedRowMarker: accent,

    focus: accent,
    border: muted,
    popupBorder: mixColours(muted, foreground, 0.35),
    popupTitle: accent,
    helpKeyText: yellow,
    keyHintText: onEveryBackground(accent),
    selectedMessageBar: accent,

    cursorBackground: foreground,
    cursorText: legibleOn(background, foreground),

    mentionBadgeBackground: red,
    mentionBadgeText: legibleOn(palette.brightForeground, red),
    presenceActive: green,
    presenceAway: mixColours(foreground, background, 0.5),

    connected: green,
    connecting: yellow,
    disconnected: red,
    warning: yellow,
    prompt: yellow,
    error: red,
    newMessages: green,

    defaultNameColour: foreground,
    fallbackNameColours: fallbackNameColours(palette),
    linkText: blue,
    linkAddressText: secondaryText,
    inlineCodeText: legibleOn(magenta, faint),
    inlineCodeBackground: faint,
    codeBlockText: legibleOn(foreground, faint),
    codeBlockBackground: faint,
    mentionOfYouText: legibleOn(yellow, mentionOfYouBackground),
    mentionOfYouBackground,
    mentionText: legibleOn(blue, mentionBackground),
    mentionBackground,
    broadcastText: legibleOn(yellow, mentionOfYouBackground),
    broadcastBackground: mentionOfYouBackground,
    channelLinkText: cyan,
    quoteBar: muted,
    attachmentBar: muted,
    attachmentGoodBar: green,
    attachmentWarningBar: yellow,
    attachmentDangerBar: red,
    daySeparatorText: secondaryText,
    timestampText: secondaryText,
    editedText: secondaryText,
    notSentText: red,
    pendingMessageText: secondaryText,
    replyCountText: accent,
    fileText: secondaryText,
    blockKitContextText: secondaryText,
    reactionText: legibleOn(foreground, faint),
    reactionBackground: faint,
    ownReactionText: selectionText,
    ownReactionBackground,
    buttonHoverBackground: mixColours(
      paneBackground,
      foreground,
      isLight ? 0.2 : 0.18,
    ),
  };
}

/** The palette's accent colours, each once, for people with no Slack colour. */
function fallbackNameColours(palette: OmarchyPalette): string[] {
  const colours = [
    palette.accent,
    palette.red,
    palette.orange,
    palette.yellow,
    palette.green,
    palette.cyan,
    palette.blue,
    palette.magenta,
    palette.brightRed,
    palette.brightYellow,
    palette.brightGreen,
    palette.brightCyan,
    palette.brightBlue,
    palette.brightMagenta,
  ];

  return [
    ...new Set(
      colours.filter((colour): colour is string => colour !== undefined),
    ),
  ];
}
