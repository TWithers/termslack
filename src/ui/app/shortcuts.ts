import type { Key } from "ink";

/** Where a shortcut works; the help screen lists them in this order. */
export const shortcutGroups = [
  { id: "global", title: "Everywhere" },
  { id: "sidebar", title: "Sidebar" },
  { id: "messages", title: "Message pane" },
  { id: "thread", title: "Thread pane" },
  { id: "input", title: "Input box" },
  { id: "prompts", title: "Prompts and lists" },
  { id: "switcher", title: "Quick switcher" },
  { id: "themes", title: "Theme picker" },
  { id: "menu", title: "Channel menu" },
  { id: "search", title: "Message search" },
  { id: "overlay", title: "Overlays" },
] as const;

export type ShortcutGroup = (typeof shortcutGroups)[number]["id"];

/**
 * One key, written as Ink reports it: a character (`j`, `?`, `G`), a named
 * key (`enter`, `esc`, `tab`, `space`, `up`, `down`, `left`, `right`,
 * `pageUp`, `pageDown`), or `ctrl+` and a character (`ctrl+c`).
 */
export type Chord = string;

export type Shortcut = {
  /** What the code dispatches on, as `pressed("sidebar.down", ...)`. Unique. */
  id: string;
  group: ShortcutGroup;
  /** The keys that do it. Empty when the binding is only listed here for the help screen, because its handler isn't driven by the table (yet). */
  keys: readonly Chord[];
  /** What the help screen shows for the keys. Default: the `keys`, spelled out. */
  label?: string;
  description: string;
};

/** The part of Ink's `Key` that chords are matched against. */
export type KeyPress = Partial<Key>;

const namedKeys: Record<string, (key: KeyPress) => boolean | undefined> = {
  enter: (key) => key.return,
  esc: (key) => key.escape,
  tab: (key) => key.tab,
  up: (key) => key.upArrow,
  down: (key) => key.downArrow,
  left: (key) => key.leftArrow,
  right: (key) => key.rightArrow,
  pageUp: (key) => key.pageUp,
  pageDown: (key) => key.pageDown,
};

/** Whether this key press is `chord`. A character chord must be typed plain, without Ctrl or Alt. */
export function matchesChord(
  chord: Chord,
  input: string,
  key: KeyPress,
): boolean {
  const named = namedKeys[chord];

  if (named) {
    return named(key) === true;
  }

  if (chord === "space") {
    return input === " " && !key.ctrl && !key.meta;
  }

  if (chord.startsWith("ctrl+")) {
    return key.ctrl === true && input === chord.slice("ctrl+".length);
  }

  return input === chord && !key.ctrl && !key.meta && !key.return;
}

const spelledOut: Record<string, string> = {
  enter: "Enter",
  esc: "Esc",
  tab: "Tab",
  space: "Space",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  pageUp: "PgUp",
  pageDown: "PgDn",
};

function spell(chord: Chord): string {
  if (chord.startsWith("ctrl+")) {
    return `Ctrl+${chord.slice("ctrl+".length).toUpperCase()}`;
  }

  return spelledOut[chord] ?? chord;
}

/** The keys of a shortcut as the help screen shows them: `j / ↓`. */
export function shortcutLabel(shortcut: Shortcut): string {
  return shortcut.label ?? shortcut.keys.map(spell).join(" / ");
}

const listKeys = <Group extends "messages" | "thread">(
  group: Group,
  first: string,
  verb: string,
) =>
  [
    {
      id: `${group}.down`,
      group,
      keys: ["down", "j"],
      description: "Select the next message",
    },
    {
      id: `${group}.up`,
      group,
      keys: ["up", "k"],
      description: "Select the previous message",
    },
    {
      id: `${group}.pageUp`,
      group,
      keys: ["pageUp"],
      description: "Page up",
    },
    {
      id: `${group}.pageDown`,
      group,
      keys: ["pageDown"],
      description: "Page down",
    },
    {
      id: `${group}.oldest`,
      group,
      keys: ["g"],
      description: `Select the ${first} message`,
    },
    {
      id: `${group}.newest`,
      group,
      keys: ["G"],
      description: "Select the newest message",
    },
    {
      id: `${group}.react`,
      group,
      keys: ["r"],
      description: "React to the selected message (asks for an emoji)",
    },
    {
      id: `${group}.edit`,
      group,
      keys: ["e"],
      description: "Edit the selected message (your own)",
    },
    {
      id: `${group}.delete`,
      group,
      keys: ["d"],
      description: "Delete the selected message (your own; asks first)",
    },
    {
      id: `${group}.copy`,
      group,
      keys: ["y"],
      description: "Copy the selected message's text to the clipboard",
    },
    {
      id: `${group}.write`,
      group,
      keys: ["i"],
      description: `Write ${verb}`,
    },
  ] as const satisfies readonly Shortcut[];

/**
 * Every keyboard shortcut termslack has, defined once. The handlers dispatch on it
 * (`pressed`), and the help screen is built from it, so the two cannot
 * drift. Shortcuts aren't customizable yet; this table is the one place a
 * key is changed. Later features add their shortcuts here.
 */
export const shortcuts = [
  {
    id: "global.quit",
    group: "global",
    keys: ["q"],
    description: "Quit (not while typing in an input box)",
  },
  {
    id: "global.interrupt",
    group: "global",
    keys: ["ctrl+c"],
    description: "Quit, from anywhere, even while typing or in an overlay",
  },
  {
    id: "global.nextPane",
    group: "global",
    keys: ["tab"],
    description: "Move to the next pane (also while typing)",
  },
  {
    id: "global.switcher",
    group: "global",
    keys: ["ctrl+k"],
    description:
      "Quick switcher: jump to a channel or DM by typing a few letters (also while typing, and from help, search or the reaction prompt, which it closes; closes it again)",
  },
  {
    id: "global.search",
    group: "global",
    keys: ["/"],
    description:
      "Search messages across the workspace (an input box types a / instead)",
  },
  {
    id: "global.theme",
    group: "global",
    keys: ["T"],
    description:
      "Choose the theme: the screen previews each one, Enter keeps and saves it, Esc restores (an input box types a T instead)",
  },
  {
    id: "global.help",
    group: "global",
    keys: ["?"],
    description: "Show this help (an input box types a ? instead)",
  },

  {
    id: "sidebar.down",
    group: "sidebar",
    keys: ["down", "j"],
    description: "Select the next conversation or section heading",
  },
  {
    id: "sidebar.up",
    group: "sidebar",
    keys: ["up", "k"],
    description: "Select the previous conversation or section heading",
  },
  {
    id: "sidebar.open",
    group: "sidebar",
    keys: ["enter"],
    description: "Open the conversation; on a heading, collapse or expand it",
  },
  {
    id: "sidebar.toggle",
    group: "sidebar",
    keys: ["space"],
    description: "On a heading, collapse or expand the section",
  },
  {
    id: "sidebar.collapse",
    group: "sidebar",
    keys: ["left", "h"],
    description: "On a heading, collapse the section",
  },
  {
    id: "sidebar.expand",
    group: "sidebar",
    keys: ["right", "l"],
    description: "On a heading, expand the section",
  },
  {
    id: "sidebar.leave",
    group: "sidebar",
    keys: ["x"],
    description:
      "Leave the selected channel or private channel (asks first; not for DMs)",
  },
  {
    id: "sidebar.menu",
    group: "sidebar",
    keys: ["m"],
    description:
      "Open the channel menu for the selected channel or private channel (right-click a channel does too; not for DMs)",
  },
  {
    id: "sidebar.hideMuted",
    group: "sidebar",
    keys: ["M"],
    description:
      "Hide muted channels, or show them again (one with an unread mention shows until it's read)",
  },
  {
    id: "sidebar.allDms",
    group: "sidebar",
    keys: ["a"],
    description: "Show all DMs, or only the most recent",
  },

  ...listKeys("messages", "oldest loaded", "in the conversation"),
  {
    id: "messages.openThread",
    group: "messages",
    keys: ["enter", "t"],
    description: "Open the selected message's thread",
  },

  ...listKeys("thread", "first", "a reply"),
  {
    id: "thread.close",
    group: "thread",
    keys: ["esc"],
    description: "Close the thread",
  },

  {
    id: "input.send",
    group: "input",
    keys: [],
    label: "Enter",
    description: "Send the message (save, while editing)",
  },
  {
    id: "input.newline",
    group: "input",
    keys: [],
    label: "Alt+Enter / Ctrl+J / Shift+Enter",
    description:
      "Insert a newline (Shift+Enter needs the kitty keyboard protocol)",
  },
  {
    id: "input.leave",
    group: "input",
    keys: [],
    label: "Esc",
    description: "Leave the input (cancel, while editing)",
  },
  {
    id: "input.alsoToChannel",
    group: "input",
    keys: [],
    label: "Ctrl+T",
    description: "In the reply box, also send the reply to the channel",
  },
  {
    id: "input.move",
    group: "input",
    keys: [],
    label: "← / → / ↑ / ↓",
    description: "Move the cursor",
  },
  {
    id: "input.moveWord",
    group: "input",
    keys: [],
    label: "Alt+← / Alt+→ / Alt+B / Alt+F",
    description: "Move by word",
  },
  {
    id: "input.moveLine",
    group: "input",
    keys: [],
    label: "Home / End / Ctrl+A / Ctrl+E",
    description: "Move to the start or end of the line",
  },
  {
    id: "input.moveChar",
    group: "input",
    keys: [],
    label: "Ctrl+B / Ctrl+F",
    description: "Move left or right",
  },
  {
    id: "input.delete",
    group: "input",
    keys: [],
    label: "Backspace / Delete / Ctrl+D",
    description: "Delete the character before or after the cursor",
  },
  {
    id: "input.deleteWord",
    group: "input",
    keys: [],
    label: "Ctrl+W / Alt+Backspace",
    description: "Delete the word before the cursor",
  },

  {
    id: "completion.choose",
    group: "prompts",
    keys: [],
    label: "↑ / ↓",
    description: "Completion list (after @ or #): choose an entry",
  },
  {
    id: "completion.accept",
    group: "prompts",
    keys: [],
    label: "Tab / Enter",
    description: "Completion list: complete with the chosen entry",
  },
  {
    id: "completion.close",
    group: "prompts",
    keys: [],
    label: "Esc",
    description: "Completion list: close it",
  },
  {
    id: "reaction.choose",
    group: "prompts",
    keys: ["up", "down"],
    label: "↑ / ↓",
    description: "Reaction prompt: choose an emoji",
  },
  {
    id: "reaction.fill",
    group: "prompts",
    keys: ["tab"],
    label: "Tab",
    description: "Reaction prompt: copy the chosen emoji into the input",
  },
  {
    id: "reaction.submit",
    group: "prompts",
    keys: ["enter"],
    label: "Enter",
    description: "Reaction prompt: add the reaction (or remove yours)",
  },
  {
    id: "reaction.cancel",
    group: "prompts",
    keys: ["esc"],
    label: "Esc",
    description: "Reaction prompt: cancel",
  },
  {
    id: "section.submit",
    group: "prompts",
    keys: ["enter"],
    description:
      "New section prompt: create the section and move the channel in (an empty or repeated name is refused)",
  },
  {
    id: "section.cancel",
    group: "prompts",
    keys: ["esc"],
    description: "New section prompt: cancel",
  },
  {
    id: "delete.confirm",
    group: "prompts",
    keys: ["y"],
    description: "Delete prompt: delete the message (any other key cancels)",
  },
  {
    id: "join.confirm",
    group: "prompts",
    keys: ["y"],
    description:
      "Join prompt: join the channel picked in the switcher (any other key cancels)",
  },

  {
    id: "leave.confirm",
    group: "prompts",
    keys: ["y"],
    description:
      "Leave prompt: leave the channel selected in the sidebar (any other key cancels)",
  },

  {
    id: "switcher.filter",
    group: "switcher",
    keys: [],
    label: "type / Backspace",
    description:
      "Narrow the list to names with your letters in order; Backspace widens it",
  },
  {
    id: "switcher.next",
    group: "switcher",
    keys: ["down", "ctrl+n"],
    description: "Highlight the next result",
  },
  {
    id: "switcher.previous",
    group: "switcher",
    keys: ["up", "ctrl+p"],
    description: "Highlight the previous result",
  },
  {
    id: "switcher.choose",
    group: "switcher",
    keys: ["enter"],
    description:
      "Open the highlighted conversation and move to its messages; on a channel you're not in, ask to join it first (Esc closes, changing nothing)",
  },

  {
    id: "themes.filter",
    group: "themes",
    keys: [],
    label: "type / Backspace",
    description: "Narrow the list to names with your letters in order",
  },
  {
    id: "themes.next",
    group: "themes",
    keys: ["down", "ctrl+n"],
    description: "Highlight the next theme and paint the screen with it",
  },
  {
    id: "themes.previous",
    group: "themes",
    keys: ["up", "ctrl+p"],
    description: "Highlight the previous theme and paint the screen with it",
  },
  {
    id: "themes.choose",
    group: "themes",
    keys: ["enter"],
    description:
      "Keep the highlighted theme and save it as theme in config.toml (Esc closes, restoring the one you had)",
  },

  {
    id: "menu.letter",
    group: "menu",
    keys: [],
    label: "the item's letter",
    description: "Choose that item straight away (shown before each item)",
  },
  {
    id: "menu.choose",
    group: "menu",
    keys: ["enter"],
    description:
      "Choose the highlighted item (Esc goes back from a second list, or closes the menu)",
  },

  {
    id: "search.query",
    group: "search",
    keys: [],
    label: "type / Backspace",
    description:
      'Edit the query; Slack\'s syntax works (from:@name, in:#channel, "exact phrase")',
  },
  {
    id: "search.run",
    group: "search",
    keys: ["enter"],
    description:
      "Search for the query (after changing it, or if the search failed); results are newest first",
  },
  {
    id: "search.open",
    group: "search",
    keys: ["enter"],
    label: "Enter (query already run)",
    description:
      "Open the highlighted result where it was posted; the results stay for / to bring back",
  },
  {
    id: "search.next",
    group: "search",
    keys: ["down", "ctrl+n"],
    description:
      "Highlight the next result; at the last one, the next page loads",
  },
  {
    id: "search.previous",
    group: "search",
    keys: ["up", "ctrl+p"],
    description: "Highlight the previous result",
  },
  {
    id: "search.page",
    group: "search",
    keys: [],
    label: "PgUp / PgDn",
    description: "Move by a page of results (Esc closes; the query is kept)",
  },

  {
    id: "overlay.close",
    group: "overlay",
    keys: ["esc"],
    description: "Close the overlay and go back to where you were",
  },
  {
    id: "list.down",
    group: "overlay",
    keys: ["down", "j"],
    description: "Scroll or move down",
  },
  {
    id: "list.up",
    group: "overlay",
    keys: ["up", "k"],
    description: "Scroll or move up",
  },
  {
    id: "list.pageUp",
    group: "overlay",
    keys: ["pageUp"],
    description: "Page up",
  },
  {
    id: "list.pageDown",
    group: "overlay",
    keys: ["pageDown"],
    description: "Page down",
  },
  {
    id: "list.top",
    group: "overlay",
    keys: ["g"],
    description: "Jump to the top",
  },
  {
    id: "list.bottom",
    group: "overlay",
    keys: ["G"],
    description: "Jump to the bottom",
  },
] as const satisfies readonly Shortcut[];

/** The id of a shortcut in the table, so a typo is a compile error. */
export type ShortcutId = (typeof shortcuts)[number]["id"];

const byId = new Map<string, Shortcut>(
  shortcuts.map((shortcut) => [shortcut.id, shortcut]),
);

/** The keys of shortcut `id` as the help screen shows them, for messages that name a key. */
export function shortcutKeys(id: ShortcutId): string {
  return shortcutLabel(byId.get(id)!);
}

/**
 * Whether this key press is any of the keys of shortcut `id`. With
 * `letters: false` single characters don't count, for lists that share the
 * screen with a filter line where letters type.
 */
export function pressed(
  id: ShortcutId,
  input: string,
  key: KeyPress,
  { letters = true }: { letters?: boolean } = {},
): boolean {
  const shortcut = byId.get(id);

  if (!shortcut) {
    throw new Error(`Unknown shortcut: ${id}`);
  }

  return shortcut.keys.some(
    (chord) => (letters || chord.length > 1) && matchesChord(chord, input, key),
  );
}
