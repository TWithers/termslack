import type { Key } from "ink";
import type { RefObject } from "react";
import type {
  SearchResult,
  WorkspaceSession,
} from "../../session/workspaceSession";
import { channelDetailsKeyHints } from "./ChannelDetails";
import { channelMenuKeyHints } from "./ChannelMenu";
import { helpKeyHints } from "./Help";
import type { PopupRegion } from "./hitTest";
import {
  overlayBox,
  overlayInnerHeight,
  overlayItemAt,
  overlayInnerWidth,
  selectableRowIndent,
} from "./Overlay";
import { reactionKeyHints } from "./ReactionPrompt";
import { sectionKeyHints } from "./SectionPrompt";
import { searchKeyHints, searchResultHeight } from "./SearchResults";
import { switcherKeyHints } from "./Switcher";
import { themeKeyHints } from "./ThemePicker";
import { pressed } from "./shortcuts";
import type { SwitcherCandidate } from "./switcherRanking";
import { useChannelDetails } from "./useChannelDetails";
import { useChannelMenu } from "./useChannelMenu";
import { useHelp } from "./useHelp";
import { useJoinPrompt } from "./useJoinPrompt";
import { useLeavePrompt } from "./useLeavePrompt";
import { useReactionPrompt } from "./useReactionPrompt";
import { useSectionPrompt } from "./useSectionPrompt";
import { useSearch } from "./useSearch";
import { useSwitcher } from "./useSwitcher";
import { useThemePicker } from "./useThemePicker";

/**
 * Everything that pops up over the panes and takes the keys while it is
 * open: the help screen, the quick switcher, the search, the reaction
 * prompt, the theme picker, the channel menu, the channel details, and the join and leave questions. `handleKey` is where the order
 * between them is decided. The app says what choosing something in the
 * switcher or the search does (`chooseConversation`, `openSearchResult`) and
 * what a joined channel does (`openJoined`); `report` is the status bar's
 * message line, `opens` counts conversation opens (see `useJoinPrompt`).
 */
export function usePopups({
  session,
  columns,
  rows,
  opens,
  chooseConversation,
  openSearchResult,
  openJoined,
  sectionName,
  userSectionOf,
  saveTheme,
  report,
}: {
  session: WorkspaceSession;
  columns: number;
  rows: number;
  opens: RefObject<number>;
  chooseConversation(candidate: SwitcherCandidate): void;
  openSearchResult(result: SearchResult): void;
  openJoined(conversationId: string): void;
  /** The name of the sidebar section a conversation is in, if it is in one. */
  sectionName(conversationId: string): string | undefined;
  /** The name of the user's section a conversation is in; undefined under Channels (or anywhere else). */
  userSectionOf(conversationId: string): string | undefined;
  saveTheme(name: string): Promise<void>;
  report(message: string | undefined): void;
}) {
  const reactionPrompt = useReactionPrompt({ session, report });
  const sectionPrompt = useSectionPrompt({ session });
  const bodyHeight = Math.max(
    0,
    rows - 1 - reactionPrompt.height - sectionPrompt.height,
  );
  const help = useHelp(
    overlayInnerHeight("large", columns, bodyHeight),
    overlayInnerWidth("large", columns, bodyHeight),
  );
  const joinPrompt = useJoinPrompt({
    session,
    opens,
    join: openJoined,
    report,
  });
  const leavePrompt = useLeavePrompt({ session, report });
  const channelDetails = useChannelDetails({
    session,
    height: overlayInnerHeight("compact", columns, bodyHeight),
    width: overlayInnerWidth("compact", columns, bodyHeight),
  });
  const channelMenu = useChannelMenu({
    height: overlayInnerHeight("compact", columns, bodyHeight),
    actions: {
      leave: leavePrompt.ask,
      isMuted: (channel) => session.isMuted(channel.id),
      setMuted: (channel, muted) => session.setMuted(channel.id, muted),
      details: (channel) =>
        channelDetails.open(channel, sectionName(channel.id)),
      sections: (channel) => ({
        names: session.sections().map(({ name }) => name),
        current: userSectionOf(channel.id),
      }),
      moveToSection(channel, name) {
        const moved = session.moveToSection(channel.id, name);

        if (!moved.ok) {
          report(moved.reason);
        }
      },
      removeFromSections: (channel) => session.removeFromSections(channel.id),
      askNewSection: sectionPrompt.open,
    },
  });
  const switcher = useSwitcher({
    session,
    height: overlayInnerHeight("compact", columns, bodyHeight),
    choose: chooseConversation,
  });
  const themePicker = useThemePicker({
    height: overlayInnerHeight("compact", columns, bodyHeight),
    save: saveTheme,
    report,
  });
  const search = useSearch({
    session,
    height: overlayInnerHeight("large", columns, bodyHeight),
    width: Math.max(
      1,
      overlayInnerWidth("large", columns, bodyHeight) - selectableRowIndent,
    ),
    choose: openSearchResult,
  });

  const region = (): PopupRegion | undefined => {
    if (help.isOpen) {
      return {
        kind: "help",
        frame: overlayBox("large", columns, bodyHeight, {
          hasFilter: false,
          remainingItems: 0,
        }),
      };
    }

    if (switcher.isOpen || themePicker.isOpen) {
      const list = switcher.isOpen ? switcher : themePicker;

      return {
        kind: switcher.isOpen ? "switcher" : "themePicker",
        frame: overlayBox("compact", columns, bodyHeight, {
          hasFilter: true,
          remainingItems: list.items.length - list.start,
        }),
      };
    }

    if (channelMenu.isOpen) {
      return {
        kind: "channelMenu",
        frame: overlayBox("compact", columns, bodyHeight, {
          hasFilter: false,
          remainingItems: channelMenu.items.length - channelMenu.start,
          anchor: channelMenu.anchor,
        }),
      };
    }

    if (channelDetails.isOpen) {
      return {
        kind: "channelDetails",
        frame: overlayBox("compact", columns, bodyHeight, {
          hasFilter: false,
          remainingItems: channelDetails.items.length - channelDetails.start,
        }),
      };
    }

    if (search.isOpen) {
      return {
        kind: "search",
        frame: overlayBox("large", columns, bodyHeight, {
          hasFilter: true,
          remainingItems: 0,
        }),
      };
    }

    if (reactionPrompt.isOpen) {
      return {
        kind: "reaction",
        frame: {
          top: bodyHeight,
          left: 0,
          width: columns,
          height: reactionPrompt.height,
        },
      };
    }

    if (sectionPrompt.isOpen) {
      return {
        kind: "sectionName",
        frame: {
          top: bodyHeight,
          left: 0,
          width: columns,
          height: sectionPrompt.height,
        },
      };
    }

    return undefined;
  };

  return {
    /** Where the open popup is drawn, or undefined when none is. */
    region,

    /**
     * A click at `column`, `row` of the open popup (from its top left
     * corner): chooses the row of the switcher, theme picker or search under
     * it, as Enter would on the highlighted row. Anywhere else does nothing.
     */
    clickRow(column: number, row: number) {
      const frame = region()?.frame;

      if (!frame) {
        return;
      }

      if (switcher.isOpen || themePicker.isOpen) {
        const list = switcher.isOpen ? switcher : themePicker;
        const index = overlayItemAt(
          frame,
          { hasFilter: true, start: list.start, count: list.items.length },
          column,
          row,
        );

        if (index !== undefined) {
          list.chooseAt(index);
        }

        return;
      }

      if (channelMenu.isOpen) {
        const index = overlayItemAt(
          frame,
          {
            hasFilter: false,
            start: channelMenu.start,
            count: channelMenu.items.length,
          },
          column,
          row,
        );

        if (index !== undefined) {
          channelMenu.chooseAt(index);
        }

        return;
      }

      if (search.isOpen) {
        const index = overlayItemAt(
          frame,
          {
            hasFilter: true,
            itemHeight: searchResultHeight,
            start: search.start,
            count: search.items.length,
          },
          column,
          row,
        );

        if (index !== undefined) {
          search.chooseAt(index);
        }
      }
    },

    /** Moves the open list popup's highlighted row, or scrolls the help, `delta` rows (negative is up). */
    wheel(delta: number) {
      for (const popup of [
        help,
        switcher,
        themePicker,
        channelMenu,
        channelDetails,
        search,
      ]) {
        if (popup.isOpen) {
          popup.scroll(delta);
          return;
        }
      }
    },

    /** Closes the open popup as Esc does (the theme picker puts its theme back). */
    dismiss() {
      if (help.isOpen) {
        help.close();
      } else if (switcher.isOpen) {
        switcher.close();
      } else if (themePicker.isOpen) {
        themePicker.close();
      } else if (channelMenu.isOpen) {
        channelMenu.close();
      } else if (channelDetails.isOpen) {
        channelDetails.close();
      } else if (search.isOpen) {
        search.close();
      } else if (reactionPrompt.isOpen) {
        reactionPrompt.close();
      } else if (sectionPrompt.isOpen) {
        sectionPrompt.close();
      }
    },

    /** Cancels a pending join or leave question, as `n` does. */
    cancelPrompt() {
      joinPrompt.cancel();
      leavePrompt.cancel();
    },

    /** The rows left for the panes: the screen less the status bar and the reaction prompt. */
    bodyHeight,
    help,
    switcher,
    themePicker,
    channelMenu,
    channelDetails,
    search,
    reactionPrompt,
    sectionPrompt,
    joinPrompt,
    leavePrompt,

    /** Whether a popup covers the panes with a full-size overlay, so the panes aren't on screen. */
    isLargeOpen: help.isOpen || search.isOpen,

    /** The question the status bar asks, if a join or leave is pending. */
    prompt: joinPrompt.prompt ?? leavePrompt.prompt,

    /** The key hints of the open popup, or undefined when none is open. */
    hints: help.isOpen
      ? helpKeyHints
      : switcher.isOpen
        ? switcherKeyHints
        : themePicker.isOpen
          ? themeKeyHints
          : channelMenu.isOpen
            ? channelMenuKeyHints
            : channelDetails.isOpen
              ? channelDetailsKeyHints
              : search.isOpen
                ? searchKeyHints
                : reactionPrompt.isOpen
                  ? reactionKeyHints
                  : sectionPrompt.isOpen
                    ? sectionKeyHints
                    : undefined,

    /** Opens the search, or says in the status bar why it can't be. */
    openSearch() {
      const problem = session.scopeProblem("search");

      if (problem) {
        report(problem);
        return;
      }

      search.open();
    },

    /**
     * Gives a key to the popup that wants it, in this order: the answer to a
     * join or leave question; Ctrl+K from the help, search or reaction
     * prompt, which closes it and opens the switcher; the open popup;
     * Ctrl+K from the panes (unless `questionPending`, a question of the
     * panes' own, which Ctrl+K cancels like any key). Returns whether the key
     * was used.
     */
    handleKey(input: string, key: Key, questionPending: boolean): boolean {
      if (
        joinPrompt.handleKey(input, key) ||
        leavePrompt.handleKey(input, key)
      ) {
        return true;
      }

      if (
        pressed("global.switcher", input, key) &&
        !switcher.isOpen &&
        (help.isOpen || search.isOpen || reactionPrompt.isOpen)
      ) {
        help.close();
        search.close();
        reactionPrompt.close();
        switcher.open();
        return true;
      }

      if (help.isOpen) {
        help.onKey(input, key);
        return true;
      }

      if (switcher.isOpen) {
        switcher.onKey(input, key);
        return true;
      }

      if (themePicker.isOpen) {
        themePicker.onKey(input, key);
        return true;
      }

      if (channelMenu.isOpen) {
        channelMenu.onKey(input, key);
        return true;
      }

      if (channelDetails.isOpen) {
        channelDetails.onKey(input, key);
        return true;
      }

      if (search.isOpen) {
        search.onKey(input, key);
        return true;
      }

      if (reactionPrompt.isOpen) {
        reactionPrompt.onKey(input, key);
        return true;
      }

      if (sectionPrompt.isOpen) {
        sectionPrompt.onKey(input, key);
        return true;
      }

      if (pressed("global.switcher", input, key) && !questionPending) {
        switcher.open();
        return true;
      }

      return false;
    },
  };
}

export type Popups = ReturnType<typeof usePopups>;
