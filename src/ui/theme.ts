import { themeFromPalette } from "./omarchyTheme";
import { omarchyPalettes } from "./omarchyPalettes";

/**
 * Every colour termslack draws with, named for what it colours (ADR 0001). All are
 * exact `#rrggbb`; terminals with fewer colours get the nearest match from
 * Ink's colour library. Another theme only supplies different values.
 */
export type Theme = {
  /** Behind the message pane, the thread pane and the area beside them. */
  paneBackground: string;
  sidebarBackground: string;
  /** A small step from the sidebar's background: what a sidebar entry or section heading shows under the mouse. */
  sidebarHoverBackground: string;
  inputBoxBackground: string;
  statusBarBackground: string;
  popupBackground: string;

  /** Ordinary text on every background. */
  text: string;
  /** Hints, notes, read sidebar entries, placeholders. */
  secondaryText: string;
  /** Muted channels in the sidebar and the quick switcher: quieter than read ones. */
  mutedChannelText: string;
  /** Unread sidebar entries and the text that should stand out. */
  brightText: string;
  sidebarHeadingText: string;
  statusBarText: string;
  statusBarSecondaryText: string;

  /** The focused sidebar's selected row, and a popup's highlighted row. */
  selectionBackground: string;
  selectionText: string;
  /** The selected row while the sidebar does not have focus. */
  unfocusedSelectionBackground: string;
  /** The `›` before the highlighted row of a popup. */
  highlightedRowMarker: string;

  /** The focused pane's title and bar, and the focused input box's border. */
  focus: string;
  /** The border of an input box without focus, and of the completion list. */
  border: string;
  popupBorder: string;
  popupTitle: string;
  /** The help's key column. */
  helpKeyText: string;
  /** The `▌` bar beside the selected message. */
  selectedMessageBar: string;

  cursorBackground: string;
  cursorText: string;

  mentionBadgeBackground: string;
  mentionBadgeText: string;
  presenceActive: string;
  presenceAway: string;

  connected: string;
  connecting: string;
  disconnected: string;
  /** Warnings, and y/n questions and notices that ask for attention. */
  warning: string;
  prompt: string;
  error: string;
  /** New messages below the view. */
  newMessages: string;

  /** A person's name when Slack gives none and termslack knows nothing to tell them apart by. */
  defaultNameColour: string;
  /** What people without a Slack colour, and bots, are told apart by: each gets one, stable by ID. */
  fallbackNameColours: string[];
  linkText: string;
  /** The address after a link whose label differs from it. */
  linkAddressText: string;
  inlineCodeText: string;
  inlineCodeBackground: string;
  codeBlockText: string;
  codeBlockBackground: string;
  /** `@you` in a message. */
  mentionOfYouText: string;
  mentionOfYouBackground: string;
  /** Other people and user groups. */
  mentionText: string;
  mentionBackground: string;
  /** `@here`, `@channel` and `@everyone`. */
  broadcastText: string;
  broadcastBackground: string;
  channelLinkText: string;
  quoteBar: string;
  /** The `▌` before an attachment with no colour of its own. */
  attachmentBar: string;
  /** What Slack's `good`, `warning` and `danger` attachment colours mean. */
  attachmentGoodBar: string;
  attachmentWarningBar: string;
  attachmentDangerBar: string;
  daySeparatorText: string;
  timestampText: string;
  /** `(edited)`. */
  editedText: string;
  /** `(not sent)`. */
  notSentText: string;
  /** A message that is still sending. */
  pendingMessageText: string;
  replyCountText: string;
  fileText: string;
  /** Block Kit context lines and dividers. */
  blockKitContextText: string;
  reactionText: string;
  reactionBackground: string;
  /** A reaction you have added. */
  ownReactionText: string;
  ownReactionBackground: string;
};

/** Slack's dark mode, near enough. */
export const slackDark: Theme = {
  paneBackground: "#1a1d21",
  sidebarBackground: "#19171d",
  sidebarHoverBackground: "#27242c",
  inputBoxBackground: "#222529",
  statusBarBackground: "#121016",
  popupBackground: "#222529",

  text: "#d1d2d3",
  secondaryText: "#9a9b9e",
  mutedChannelText: "#8a8b8f",
  brightText: "#ffffff",
  sidebarHeadingText: "#b9bbbe",
  statusBarText: "#d1d2d3",
  statusBarSecondaryText: "#9a9b9e",

  selectionBackground: "#1164a3",
  selectionText: "#ffffff",
  unfocusedSelectionBackground: "#35373b",
  highlightedRowMarker: "#36c5f0",

  focus: "#36c5f0",
  border: "#565856",
  popupBorder: "#868686",
  popupTitle: "#36c5f0",
  helpKeyText: "#ecb22e",
  selectedMessageBar: "#36c5f0",

  cursorBackground: "#d1d2d3",
  cursorText: "#1a1d21",

  mentionBadgeBackground: "#cd2553",
  mentionBadgeText: "#ffffff",
  presenceActive: "#2bac76",
  presenceAway: "#7c7d80",

  connected: "#2bac76",
  connecting: "#ecb22e",
  disconnected: "#e01e5a",
  warning: "#ecb22e",
  prompt: "#ecb22e",
  error: "#e01e5a",
  newMessages: "#2bac76",

  defaultNameColour: "#d1d2d3",
  fallbackNameColours: [
    "#e8912d",
    "#2eb67d",
    "#36c5f0",
    "#e0617d",
    "#9f69e7",
    "#d9c43a",
    "#4a9eff",
    "#e06fd8",
    "#58c4a8",
    "#ee8a5c",
  ],
  linkText: "#1d9bd1",
  linkAddressText: "#9a9b9e",
  inlineCodeText: "#e8912d",
  inlineCodeBackground: "#2b2e33",
  codeBlockText: "#d1d2d3",
  codeBlockBackground: "#2b2e33",
  mentionOfYouText: "#f2c744",
  mentionOfYouBackground: "#4a3d14",
  mentionText: "#5db7e8",
  mentionBackground: "#1b3347",
  broadcastText: "#f2c744",
  broadcastBackground: "#4a3d14",
  channelLinkText: "#5db7e8",
  quoteBar: "#565856",
  attachmentBar: "#565856",
  attachmentGoodBar: "#2bac76",
  attachmentWarningBar: "#ecb22e",
  attachmentDangerBar: "#e01e5a",
  daySeparatorText: "#9a9b9e",
  timestampText: "#9a9b9e",
  editedText: "#9a9b9e",
  notSentText: "#e01e5a",
  pendingMessageText: "#9a9b9e",
  replyCountText: "#36c5f0",
  fileText: "#9a9b9e",
  blockKitContextText: "#9a9b9e",
  reactionText: "#d1d2d3",
  reactionBackground: "#2b2e33",
  ownReactionText: "#ffffff",
  ownReactionBackground: "#1164a3",
};

export const defaultThemeName = "slack-dark";

/** What `theme` can be set to in the config: the built-in theme and Omarchy's, by their folder names. */
export const themeNames: string[] = [
  defaultThemeName,
  ...Object.keys(omarchyPalettes),
];

/** The theme called `name`, or nothing when there is none. */
export function themeNamed(name: string): Theme | undefined {
  if (name === defaultThemeName) {
    return slackDark;
  }

  return Object.hasOwn(omarchyPalettes, name)
    ? themeFromPalette(omarchyPalettes[name]!)
    : undefined;
}

/** Whether the theme called `name` is a light one (the Omarchy palettes say). */
export function isLightTheme(name: string): boolean {
  return (
    Object.hasOwn(omarchyPalettes, name) &&
    omarchyPalettes[name]!.mode === "light"
  );
}

/**
 * The theme termslack paints with. A live binding: importers see `applyTheme`'s
 * choice, so read it when drawing (not into a module-level constant), and
 * choose before the first frame.
 */
export let theme: Theme = slackDark;

/** The name of `theme`, a live binding like it. */
export let currentThemeName: string = defaultThemeName;

/** Paints with the theme called `name` from now on; false, and nothing changes, when there is none. */
export function applyTheme(name: string): boolean {
  const named = themeNamed(name);

  if (!named) {
    return false;
  }

  theme = named;
  currentThemeName = name;

  return true;
}
