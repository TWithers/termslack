import type { ChannelRef } from "./useConfirmPrompt";

/**
 * One thing the channel menu offers. `letter` chooses it straight away (a
 * lowercase letter other than the list keys `j`, `k` and `g`, and unique in
 * its list). `run` does it: returning a list opens that list in the same
 * popup (Esc then goes back), returning nothing closes the menu.
 */
export type MenuChoice = {
  id: string;
  letter: string;
  label: string;
  run(): MenuList | void;
};

/** A titled list of choices: the channel menu itself, or a second list it opens. */
export type MenuList = { title: string; choices: MenuChoice[] };

/** What the menu's choices act through; later items add theirs here. */
export type ChannelMenuActions = {
  details(channel: ChannelRef): void;
  leave(channel: ChannelRef): void;
  isMuted(channel: ChannelRef): boolean;
  setMuted(channel: ChannelRef, muted: boolean): void;
  /** The user's section names in order, and the one the channel is in (none: it is under Channels). */
  sections(channel: ChannelRef): { names: string[]; current?: string };
  moveToSection(channel: ChannelRef, sectionName: string): void;
  removeFromSections(channel: ChannelRef): void;
  /** Asks for the name of a new section to put the channel in. */
  askNewSection(channel: ChannelRef): void;
};

/** Numbers 1 to 9 choose the first nine sections; any further ones have no letter (keys and clicks reach them). */
const sectionLetters = "123456789";

/**
 * The second list of Move to section: the user's sections in order (the
 * channel's own marked with a check), Channels (no section), and a new one.
 */
function sectionList(
  channel: ChannelRef,
  actions: ChannelMenuActions,
): MenuList {
  const { names, current } = actions.sections(channel);

  return {
    title: "Move to section",
    choices: [
      ...names.map((name, index) => ({
        id: `section:${name}`,
        letter: sectionLetters[index] ?? "",
        label: `${name === current ? "✓" : " "} ${name}`,
        run: () => actions.moveToSection(channel, name),
      })),
      {
        id: "channels",
        letter: "c",
        label: `${current === undefined ? "✓" : " "} Channels (no section)`,
        run: () => actions.removeFromSections(channel),
      },
      {
        id: "newSection",
        letter: "n",
        label: "  New section…",
        run: () => actions.askNewSection(channel),
      },
    ],
  };
}

/**
 * The channel menu's choices for `channel`, in the order shown. Adding an
 * item is adding an entry here (conditionally, for one that depends on the
 * channel); a choice that needs a second list returns it from `run`.
 */
export function channelMenuChoices(
  channel: ChannelRef,
  actions: ChannelMenuActions,
): MenuChoice[] {
  const muted = actions.isMuted(channel);

  return [
    {
      id: "mute",
      letter: "m",
      label: muted ? "Unmute channel" : "Mute channel",
      run: () => actions.setMuted(channel, !muted),
    },
    {
      id: "details",
      letter: "d",
      label: "Channel details",
      run: () => actions.details(channel),
    },
    {
      id: "moveToSection",
      letter: "s",
      label: "Move to section…",
      run: () => sectionList(channel, actions),
    },
    {
      id: "leave",
      letter: "l",
      label: "Leave channel",
      run: () => actions.leave(channel),
    },
  ];
}
