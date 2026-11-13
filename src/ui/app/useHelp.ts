import { useMemo, useState } from "react";
import { theme } from "../theme";
import { helpItems } from "./Help";
import { overlayChrome, overlayPadding } from "./Overlay";
import { pressed, type KeyPress } from "./shortcuts";
import { handleListKey, useListView } from "./useListView";

/**
 * The help screen `?` opens: the shortcut table as a list that scrolls. `?`
 * and Esc close it. `height` and `width` are the rows and columns the overlay
 * may take; the help wraps to the width, one item per line.
 */
export function useHelp(height: number, width: number) {
  const [isOpen, setOpen] = useState(false);
  const items = useMemo(
    () => helpItems(width - overlayPadding),
    [theme, width],
  );
  const view = useListView({
    count: items.length,
    height: height - overlayChrome(false),
    selectable: false,
  });

  return {
    isOpen,
    items,
    start: view.start,
    open() {
      view.reset();
      setOpen(true);
    },
    close() {
      setOpen(false);
    },
    /** Moves the highlight (or scrolls the help) `delta` rows, as the arrows do. */
    scroll: view.move,
    /** Handles a key while the help screen is open. */
    onKey(input: string, key: KeyPress) {
      if (
        pressed("overlay.close", input, key) ||
        pressed("global.help", input, key)
      ) {
        setOpen(false);
        return;
      }

      handleListKey(view, input, key);
    },
  };
}

export type Help = ReturnType<typeof useHelp>;
