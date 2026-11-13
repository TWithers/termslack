import { useState } from "react";
import { channelMenuItem } from "./ChannelMenu";
import {
  channelMenuChoices,
  type ChannelMenuActions,
  type MenuList,
} from "./channelMenuChoices";
import { overlayChrome, type OverlayAnchor } from "./Overlay";
import { matchesChord, pressed, type KeyPress } from "./shortcuts";
import type { ChannelRef } from "./useConfirmPrompt";
import { handleListKey, useListView } from "./useListView";

/**
 * The channel menu `m` (or a right-click) opens on a sidebar channel: a list
 * of what can be done to it, titled with its name. Enter or a letter chooses
 * (see `MenuChoice`); a choice may open a second list, and Esc goes back one
 * list or closes. It opens at `anchor` (beside the channel's sidebar row). `height` is the rows the popup may take; `actions` is what
 * the choices do.
 */
export function useChannelMenu({
  height,
  actions,
}: {
  height: number;
  actions: ChannelMenuActions;
}) {
  const [shown, setShown] = useState<{
    lists: MenuList[];
    anchor: OverlayAnchor;
  }>();
  const current = shown?.lists.at(-1);
  const choices = current?.choices ?? [];
  const view = useListView({
    count: choices.length,
    height: height - overlayChrome(false),
    selectable: true,
  });

  function close() {
    setShown(undefined);
  }

  function chooseAt(index: number) {
    const choice = choices[index];

    if (!shown || !choice) {
      return;
    }

    const next = choice.run();

    if (next) {
      setShown({ ...shown, lists: [...shown.lists, next] });
      view.reset();
      return;
    }

    close();
  }

  function back() {
    if (!shown || shown.lists.length === 1) {
      close();
      return;
    }

    setShown({ ...shown, lists: shown.lists.slice(0, -1) });
    view.reset();
  }

  return {
    isOpen: shown !== undefined,
    title: current?.title ?? "",
    anchor: shown?.anchor,
    start: view.start,
    selected: view.selected,
    items: choices.map((choice, index) =>
      channelMenuItem(choice, index === view.selected),
    ),
    open(channel: ChannelRef, anchor: OverlayAnchor) {
      view.reset();
      setShown({
        lists: [
          {
            title: channel.label,
            choices: channelMenuChoices(channel, actions),
          },
        ],
        anchor,
      });
    },
    /** Closes the menu, whichever list it is showing. */
    close,
    /** Chooses the item at `index`, as Enter does with the highlighted one. */
    chooseAt,
    /** Moves the highlight `delta` rows, as the arrows do. */
    scroll: view.move,
    /** Handles a key while the menu is open. */
    onKey(input: string, key: KeyPress) {
      if (pressed("overlay.close", input, key)) {
        back();
        return;
      }

      if (pressed("menu.choose", input, key)) {
        chooseAt(view.selected);
        return;
      }

      const lettered = choices.findIndex(
        ({ letter }) => letter !== "" && matchesChord(letter, input, key),
      );

      if (lettered >= 0) {
        chooseAt(lettered);
        return;
      }

      handleListKey(view, input, key);
    },
  };
}

export type ChannelMenu = ReturnType<typeof useChannelMenu>;
