import { useRef, useState } from "react";
import { emptyInput } from "../input/textInput";
import { applyTheme, currentThemeName } from "../theme";
import { overlayChrome } from "./Overlay";
import { pressed, type KeyPress } from "./shortcuts";
import { themeChoices } from "./themeChoices";
import { themeItem } from "./ThemePicker";
import { handleFilteredListKey, useListView } from "./useListView";

/**
 * The theme picker `T` opens: a filter line over the themes. The highlighted
 * row is applied as it changes, before the render that shows the change
 * (moving it, or a filter that changes it, previews that theme on the whole
 * screen in one frame); Enter keeps it and calls `save`
 * with its name, and if that fails `report` says so, the theme stays for this
 * run. Esc puts back the theme in use when the picker opened. `height` is the
 * rows the popup may take.
 */
export function useThemePicker({
  height,
  save,
  report,
}: {
  height: number;
  save(name: string): Promise<void>;
  report(message: string | undefined): void;
}) {
  const [isOpen, setOpen] = useState(false);
  const [filter, setFilter] = useState(emptyInput);
  /** The theme in use when the picker opened. */
  const opened = useRef(currentThemeName);
  const choices = isOpen ? themeChoices(filter.text) : [];
  const view = useListView({
    count: choices.length,
    height: height - overlayChrome(true),
    selectable: true,
    onHighlight: (index) => preview(choices[index]?.name),
  });

  function preview(name: string | undefined) {
    if (name !== undefined && name !== currentThemeName) {
      applyTheme(name);
    }
  }

  function close() {
    applyTheme(opened.current);
    setOpen(false);
  }

  function chooseAt(index: number) {
    const chosen = choices[index];

    setOpen(false);

    if (!chosen) {
      applyTheme(opened.current);
      return;
    }

    applyTheme(chosen.name);
    save(chosen.name).catch((error: unknown) =>
      report(
        `Couldn't save the theme to the config (${error instanceof Error ? error.message : String(error)}). It is kept until termslack quits.`,
      ),
    );
  }

  return {
    isOpen,
    title: "Theme",
    filter,
    start: view.start,
    selected: view.selected,
    items: choices.map((choice, index) =>
      themeItem(choice, {
        selected: index === view.selected,
        inUse: choice.name === opened.current,
      }),
    ),
    open() {
      opened.current = currentThemeName;
      setFilter(emptyInput);
      view.reset(
        themeChoices("").findIndex(({ name }) => name === currentThemeName),
      );
      setOpen(true);
    },
    /** Closes the picker, putting back the theme in use when it opened. */
    close,
    /** Keeps and saves the theme at `index`, as Enter does with the highlighted one. */
    chooseAt,
    /** Moves the highlight `delta` rows, as the arrows do. */
    scroll: view.move,
    /** Handles a key while the picker is open. */
    onKey(input: string, key: KeyPress) {
      if (pressed("overlay.close", input, key)) {
        close();
        return;
      }

      if (pressed("themes.choose", input, key)) {
        chooseAt(view.selected);
        return;
      }

      const edited = handleFilteredListKey(view, filter, input, key, {
        next: "themes.next",
        previous: "themes.previous",
      });

      if (!edited) {
        return;
      }

      if (edited.text !== filter.text) {
        view.reset();
        preview(themeChoices(edited.text)[0]?.name);
      }

      setFilter(edited);
    },
  };
}

export type ThemePicker = ReturnType<typeof useThemePicker>;
